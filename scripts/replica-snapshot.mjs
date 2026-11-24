import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';

const folder = new URL('../dados/', import.meta.url);
const manifest = new URL('snapshot.json', folder);
if (!existsSync(manifest)) {
  throw new Error('A cópia local dos dados não foi encontrada. Consulte o README para colocar a pasta dados/ do pacote privado nesta pasta.');
}
export const snapshot = JSON.parse(readFileSync(manifest, 'utf8'));
export const tables = ['companies', 'financial_transactions', 'financial_transactions_raw'];

export async function* snapshotRows(table) {
  if (!tables.includes(table)) throw new Error('Tabela da cópia desconhecida.');
  const input = createReadStream(fileURLToPath(new URL(`${table}.jsonl.gz`, folder)));
  const gunzip = createGunzip();
  input.on('error', error => gunzip.destroy(error));
  const lines = createInterface({ input: input.pipe(gunzip), crlfDelay: Infinity });
  let count = 0;
  for await (const line of lines) { count++; yield JSON.parse(line); }
  if (count !== snapshot.counts[table]) throw new Error(`A cópia de ${table} está incompleta.`);
}

export async function* snapshotInserts() {
  for (const table of tables) {
    let rows = [];
    const insert = () => {
      const delimiter = `$data_${randomBytes(16).toString('hex')}$`;
      return `INSERT INTO public.${table} SELECT * FROM jsonb_populate_recordset(NULL::public.${table}, ${delimiter}${JSON.stringify(rows)}${delimiter}::jsonb);\n`;
    };
    for await (const row of snapshotRows(table)) {
      rows.push(row);
      if (rows.length === 250) { yield insert(); rows = []; }
    }
    if (rows.length) yield insert();
  }
}
