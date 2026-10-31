import type { ReviewSnapshot } from "./github";

export interface ReviewCache {
  load(accountId: string): Promise<ReviewSnapshot | undefined>;
  save(snapshot: ReviewSnapshot, signal: AbortSignal): Promise<void>;
}

/** Private GitHub snapshots are account-scoped, independent of Buzz communities.
 * Artifact storage owns relay revisions and insert-only imports, not mutable GitHub queues. */
export function reviewCache(): ReviewCache {
  async function open() {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("buzz-reviews-v1", 1);
      let blocked = false;
      request.onupgradeneeded = () =>
        request.result.createObjectStore("accounts", { keyPath: "account.id" });
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        blocked = true;
        reject(
          new Error(
            "Close other Buzz windows and refresh to open saved reviews.",
          ),
        );
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        if (blocked) db.close();
        else resolve(db);
      };
    });
  }
  return {
    async load(accountId) {
      const db = await open();
      try {
        return await new Promise<ReviewSnapshot | undefined>(
          (resolve, reject) => {
            const tx = db.transaction("accounts");
            const request = tx.objectStore("accounts").get(accountId);
            tx.oncomplete = () => resolve(request.result);
            tx.onabort = () =>
              reject(tx.error ?? new Error("Could not read saved reviews."));
          },
        );
      } finally {
        db.close();
      }
    },
    async save(snapshot, signal) {
      const db = await open();
      try {
        signal.throwIfAborted();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("accounts", "readwrite");
          const abort = () => tx.abort();
          signal.addEventListener("abort", abort, { once: true });
          // One transaction replaces rows and freshness together, never a partial page.
          tx.objectStore("accounts").put(snapshot);
          tx.oncomplete = () => {
            signal.removeEventListener("abort", abort);
            resolve();
          };
          tx.onabort = () => {
            signal.removeEventListener("abort", abort);
            reject(tx.error ?? new Error("Saving reviews was cancelled."));
          };
        });
      } finally {
        db.close();
      }
    },
  };
}
