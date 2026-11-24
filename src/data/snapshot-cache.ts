// Financial snapshots are isolated by authenticated user, never by company alone.
const DATABASE = "somus-finance-cache-v1";
const STORE = "snapshots";

async function access<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  if (typeof indexedDB === "undefined") return null;
  return new Promise<T | null>((resolve) => {
    let db: IDBDatabase | undefined;
    let result: T | null = null;
    let finished = false;
    const finish = (value: T | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      db?.close();
      resolve(value);
    };
    const timeout = setTimeout(() => finish(null), 1500);
    const open = indexedDB.open(DATABASE, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => finish(null);
    open.onblocked = () => finish(null);
    open.onsuccess = () => {
      db = open.result;
      if (finished) { db.close(); return; }
      try {
        const transaction = db.transaction(STORE, mode);
        transaction.oncomplete = () => finish(result);
        transaction.onerror = () => finish(null);
        transaction.onabort = () => finish(null);
        const request = operation(transaction.objectStore(STORE));
        request.onsuccess = () => { result = request.result; };
      } catch { finish(null); }
    };
  }).catch(() => null);
}

export function readSnapshot<T>(userId: string): Promise<T | null> {
  return access("readonly", (store) => store.get(userId));
}

export async function writeSnapshot(userId: string, value: unknown) {
  await access("readwrite", (store) => store.put(value, userId));
}

export async function deleteSnapshot(userId: string) {
  await access("readwrite", (store) => store.delete(userId));
}
