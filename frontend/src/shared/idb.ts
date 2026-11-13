// Minimal IndexedDB helper shared by the scraper history and the probe history. Each caller
// passes its own database name, so the two histories never share storage.

export function createStore(dbName: string, storeNames: string[]) {
  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of storeNames) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open the history database'));
      // Another tab holding the database open must not make us wait forever.
      req.onblocked = () => reject(new Error('History database is blocked by another tab'));
    });
  }

  // Runs `work` in a transaction and resolves with its return value once the transaction has
  // committed. To read data, return the request from `work` and use `.result` on the value this
  // resolves with: by then the request has finished, so attaching onsuccess afterwards never fires.
  async function run<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => T): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      let result: T;
      try {
        const tx = db.transaction(stores, mode);
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error('IndexedDB transaction failed'));
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error('IndexedDB transaction aborted (storage may be full)'));
        };
        result = work(tx);
      } catch (e) {
        db.close();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  return { run };
}
