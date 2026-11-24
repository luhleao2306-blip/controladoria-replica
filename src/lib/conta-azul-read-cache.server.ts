type SavedRead = {
  companyId: string;
  metadata: any[];
  catalog: any;
  financialTransactions: any[];
};

const initialized = new WeakMap<object, Promise<void>>();
async function tables(db: any) {
  let ready = initialized.get(db);
  if (!ready) {
    ready = (async () => {
      await db.prepare("CREATE TABLE IF NOT EXISTS integration_read_views (company_id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, source_revision TEXT, saved_at TEXT NOT NULL, fully_reconciled INTEGER NOT NULL, parts INTEGER NOT NULL, digest TEXT NOT NULL)").run();
      await db.prepare("CREATE TABLE IF NOT EXISTS integration_read_view_parts (snapshot_id TEXT NOT NULL, part INTEGER NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(snapshot_id,part))").run();
      await db.prepare("CREATE INDEX IF NOT EXISTS integration_read_parts_created_at ON integration_read_view_parts(created_at)").run();
    })().catch(error => { initialized.delete(db); throw error; });
    initialized.set(db, ready);
  }
  await ready;
}

async function digest(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
}

export async function saveContaAzulReadView(db: any, data: SavedRead, sourceRevision: string | null, fullyReconciled: boolean, expectedSnapshotId?: string) {
  await tables(db);
  if (data.financialTransactions.some(row => row.company_id !== data.companyId)) throw new Error("A leitura salva contem uma empresa diferente.");
  const payload = JSON.stringify(data);
  const snapshotId = crypto.randomUUID(), savedAt = new Date().toISOString();
  const fragments: string[] = [];
  for (let start = 0; start < payload.length;) {
    let end = Math.min(start + 120000, payload.length);
    // Keep UTF-16 surrogate pairs together when D1 encodes each fragment as UTF-8.
    if (end < payload.length && /[\uD800-\uDBFF]/.test(payload[end - 1])) end--;
    fragments.push(payload.slice(start, end));
    start = end;
  }
  const parts = fragments.length;
  // Publish the pointer only after every immutable fragment is durable.
  for (let start = 0; start < parts; start += 16) {
    const statements = fragments.slice(start, start + 16).map((fragment, index) =>
      db.prepare("INSERT INTO integration_read_view_parts VALUES (?,?,?,?)")
        .bind(snapshotId, start + index, fragment, Date.now()));
    await db.batch(statements);
  }
  const hash = await digest(payload);
  if (expectedSnapshotId) {
    const published = await db.prepare("UPDATE integration_read_views SET snapshot_id=?,source_revision=?,saved_at=?,fully_reconciled=?,parts=?,digest=? WHERE company_id=? AND snapshot_id=? AND (fully_reconciled=0 OR ?=1) RETURNING snapshot_id")
      .bind(snapshotId, sourceRevision, savedAt, fullyReconciled ? 1 : 0, parts, hash, data.companyId, expectedSnapshotId, fullyReconciled ? 1 : 0).first();
    if (!published) return { snapshotId, savedAt, fullyReconciled, published: false };
  } else {
    const published = await db.prepare("INSERT INTO integration_read_views VALUES (?,?,?,?,?,?,?) ON CONFLICT(company_id) DO UPDATE SET snapshot_id=excluded.snapshot_id,source_revision=excluded.source_revision,saved_at=excluded.saved_at,fully_reconciled=excluded.fully_reconciled,parts=excluded.parts,digest=excluded.digest WHERE integration_read_views.fully_reconciled=0 OR excluded.fully_reconciled=1 RETURNING snapshot_id")
      .bind(data.companyId, snapshotId, sourceRevision, savedAt, fullyReconciled ? 1 : 0, parts, hash).first();
    if (!published) return { snapshotId, savedAt, fullyReconciled, published: false };
  }
  // Bound housekeeping work and use the age index. A cleanup failure cannot undo
  // publication or turn a completed import into a failed source synchronization.
  await db.prepare("DELETE FROM integration_read_view_parts WHERE rowid IN (SELECT rowid FROM integration_read_view_parts WHERE created_at<? AND snapshot_id NOT IN (SELECT snapshot_id FROM integration_read_views) ORDER BY created_at LIMIT 128)")
    .bind(Date.now() - 24 * 60 * 60_000).run().catch(() => {
      console.warn(JSON.stringify({ component: "conta-azul-read-view", message: "Limpeza de leituras antigas adiada." }));
    });
  return { snapshotId, savedAt, fullyReconciled, published: true };
}

export async function contaAzulReadViewExists(db: any, companyId: string) {
  await tables(db);
  return Boolean(await db.prepare("SELECT company_id FROM integration_read_views WHERE company_id=? AND fully_reconciled=1").bind(companyId).first());
}

export async function readContaAzulReadView(db: any, companyId: string, knownRevision?: string) {
  await tables(db);
  const view = await db.prepare("SELECT * FROM integration_read_views WHERE company_id=?").bind(companyId).first();
  if (!view) return null;
  const info = { readRevision: String(view.snapshot_id), confirmedAt: view.fully_reconciled ? String(view.saved_at) : null,
    savedAt: String(view.saved_at), savedView: true as const, fullyReconciled: Boolean(view.fully_reconciled) };
  if (knownRevision === view.snapshot_id) return { ...info, unchanged: true as const, companyId, metadata: [], catalog: null };
  // Large companies have hundreds of fragments. Bound each D1 response instead
  // of making the database serialize tens of megabytes in one operation.
  const fragments: { part: number; payload: string }[] = [];
  for (let start = 0; start <= view.parts; start += 16) {
    const page = await db.prepare("SELECT part,payload FROM integration_read_view_parts WHERE snapshot_id=? AND part>=? ORDER BY part LIMIT 16")
      .bind(view.snapshot_id, start).all();
    fragments.push(...page.results);
    if (page.results.length < 16 || fragments.length > view.parts) break;
  }
  if (fragments.length !== view.parts || fragments.some((row, index) => row.part !== index)) throw new Error("Leitura salva incompleta. Nenhum valor foi substituido.");
  const payload = fragments.map(row => row.payload).join("");
  if (await digest(payload) !== view.digest) throw new Error("A leitura salva nao passou na verificacao de integridade.");
  const data = JSON.parse(payload) as SavedRead;
  if (data.companyId !== companyId || data.financialTransactions.some(row => row.company_id !== companyId)) throw new Error("A leitura salva nao pertence a esta empresa.");
  return { ...data, ...info };
}
