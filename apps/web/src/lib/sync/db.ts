import { openDB, type DBSchema, type IDBPDatabase } from "idb";

interface KnowdexDB extends DBSchema {
  documents: {
    key: string;
    value: {
      docId: string;
      state: Uint8Array;
      stateVector: Uint8Array;
      updatedAt: number;
    };
  };
  pendingUpdates: {
    key: number;
    value: {
      id?: number;
      docId: string;
      update: Uint8Array;
      createdAt: number;
    };
    indexes: { "by-docId": string };
  };
}

// Singleton DB connection — do not open multiple connections
let dbPromise: Promise<IDBPDatabase<KnowdexDB>> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<KnowdexDB>("knowdex-v1", 1, {
      upgrade(db) {
        db.createObjectStore("documents", { keyPath: "docId" });
        const pendingStore = db.createObjectStore("pendingUpdates", {
          keyPath: "id",
          autoIncrement: true,
        });
        pendingStore.createIndex("by-docId", "docId");
      },
      blocked() {
        // Another tab has an older DB version open
        console.warn("IndexedDB upgrade blocked by another tab");
      },
    });
  }
  return dbPromise;
}

// Max pending updates before falling back to full sync on reconnect
const MAX_PENDING = 1000;

export const db = {
  async getDocument(docId: string) {
    try {
      return await (await getDB()).get("documents", docId);
    } catch (err) {
      console.error("Failed to get document from IDB:", err);
      return null;
    }
  },

  async saveDocument(
    docId: string,
    state: Uint8Array,
    stateVector: Uint8Array,
  ) {
    try {
      await (
        await getDB()
      ).put("documents", {
        docId,
        state,
        stateVector,
        updatedAt: Date.now(),
      });
    } catch (err) {
      // Quota exceeded or private browsing — log and continue
      console.warn("IndexedDB save failed:", err);
    }
  },

  async addPendingUpdate(docId: string, update: Uint8Array) {
    try {
      const database = await getDB();
      const count = await database.countFromIndex(
        "pendingUpdates",
        "by-docId",
        docId,
      );
      if (count >= MAX_PENDING) {
        // Too many pending — wipe them, full sync will recover on reconnect
        await db.clearPendingUpdates(docId);
        return;
      }
      await database.add("pendingUpdates", {
        docId,
        update,
        createdAt: Date.now(),
      });
    } catch (err) {
      console.warn("Failed to queue pending update:", err);
    }
  },

  async countPendingUpdates(docId: string): Promise<number> {
    try {
      return await (
        await getDB()
      ).countFromIndex("pendingUpdates", "by-docId", docId);
    } catch {
      return 0;
    }
  },

  async getPendingUpdates(docId: string) {
    try {
      return await (
        await getDB()
      ).getAllFromIndex("pendingUpdates", "by-docId", docId);
    } catch (err) {
      console.error("Failed to get pending updates:", err);
      return [];
    }
  },

  async deletePendingUpdate(id: number) {
    try {
      await (await getDB()).delete("pendingUpdates", id);
    } catch (err) {
      console.warn("Failed to delete pending update:", err);
    }
  },

  async clearPendingUpdates(docId: string) {
    try {
      const database = await getDB();
      const keys = await database.getAllKeysFromIndex(
        "pendingUpdates",
        "by-docId",
        docId,
      );
      const tx = database.transaction("pendingUpdates", "readwrite");
      await Promise.all(keys.map((k) => tx.store.delete(k)));
      await tx.done;
    } catch (err) {
      console.warn("Failed to clear pending updates:", err);
    }
  },
};
