/**
 * Offline Cache Layer - IndexedDB Implementation
 * 
 * Provides persistent client-side storage for ledger data,
 * enabling the Absolute Truth Engine to function when Supabase is unreachable.
 */

const DB_NAME = "FinancialOS_Cache";
const DB_VERSION = 1;
const STORES = {
  ledger: "ledger_entries",
  totals: "absolute_truth_totals",
  manualEntries: "manual_z_reports",
  meta: "cache_metadata",
} as const;

interface CacheMetadata {
  key: string;
  lastSync: number;
  isStale: boolean;
}

interface ManualZReport {
  id: string;
  createdAt: number;
  revenue: number;
  purchases: number;
  laborHours: number;
  energyCosts: number;
  notes: string;
  synced: boolean;
  tenant_id: string;
}

/**
 * Open or create the IndexedDB database
 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error("[OfflineCache] Database open failed:", request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Ledger entries store
      if (!db.objectStoreNames.contains(STORES.ledger)) {
        const ledgerStore = db.createObjectStore(STORES.ledger, { keyPath: "id" });
        ledgerStore.createIndex("transaction_date", "transaction_date", { unique: false });
        ledgerStore.createIndex("category", "category", { unique: false });
      }

      // Absolute truth totals store
      if (!db.objectStoreNames.contains(STORES.totals)) {
        db.createObjectStore(STORES.totals, { keyPath: "user_id" });
      }

      // Manual Z-Report entries (local buffer)
      if (!db.objectStoreNames.contains(STORES.manualEntries)) {
        const manualStore = db.createObjectStore(STORES.manualEntries, { keyPath: "id" });
        manualStore.createIndex("createdAt", "createdAt", { unique: false });
        manualStore.createIndex("synced", "synced", { unique: false });
        manualStore.createIndex("tenant_id", "tenant_id", { unique: false });
      }

      // Cache metadata
      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: "key" });
      }

      console.log("[OfflineCache] Database schema created/upgraded to v" + DB_VERSION);
    };
  });
}

/**
 * Save ledger entries to cache
 */
export async function cacheLedgerEntries<T extends { id: string }>(entries: T[]): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction([STORES.ledger, STORES.meta], "readwrite");
    const store = tx.objectStore(STORES.ledger);
    const metaStore = tx.objectStore(STORES.meta);

    // Clear existing entries and add new ones
    await new Promise<void>((resolve, reject) => {
      const clearRequest = store.clear();
      clearRequest.onsuccess = () => resolve();
      clearRequest.onerror = () => reject(clearRequest.error);
    });

    for (const entry of entries) {
      store.put(entry);
    }

    // Update metadata
    metaStore.put({
      key: "ledger",
      lastSync: Date.now(),
      isStale: false,
    } as CacheMetadata);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    console.log(`[OfflineCache] Cached ${entries.length} ledger entries`);
    db.close();
  } catch (error) {
    console.error("[OfflineCache] Failed to cache ledger entries:", error);
    throw error;
  }
}

/**
 * Retrieve cached ledger entries
 */
export async function getCachedLedgerEntries<T>(): Promise<T[]> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORES.ledger, "readonly");
    const store = tx.objectStore(STORES.ledger);

    const entries = await new Promise<T[]>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });

    db.close();
    return entries;
  } catch (error) {
    console.error("[OfflineCache] Failed to get cached ledger entries:", error);
    return [];
  }
}

/**
 * Save absolute truth totals to cache
 */
export async function cacheTotals<T extends { user_id: string }>(totals: T): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction([STORES.totals, STORES.meta], "readwrite");
    const store = tx.objectStore(STORES.totals);
    const metaStore = tx.objectStore(STORES.meta);

    store.put(totals);

    metaStore.put({
      key: "totals",
      lastSync: Date.now(),
      isStale: false,
    } as CacheMetadata);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    console.log("[OfflineCache] Cached absolute truth totals");
    db.close();
  } catch (error) {
    console.error("[OfflineCache] Failed to cache totals:", error);
    throw error;
  }
}

/**
 * Retrieve cached totals
 */
export async function getCachedTotals<T>(): Promise<T | null> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORES.totals, "readonly");
    const store = tx.objectStore(STORES.totals);

    const totals = await new Promise<T[]>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });

    db.close();
    return totals.length > 0 ? totals[0] : null;
  } catch (error) {
    console.error("[OfflineCache] Failed to get cached totals:", error);
    return null;
  }
}

/**
 * Save a manual Z-Report entry to local buffer
 */
export async function saveManualZReport(report: Omit<ManualZReport, "id" | "createdAt" | "synced">): Promise<ManualZReport> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORES.manualEntries, "readwrite");
    const store = tx.objectStore(STORES.manualEntries);

    const entry: ManualZReport = {
      id: `manual_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      createdAt: Date.now(),
      synced: false,
      ...report,
    };

    await new Promise<void>((resolve, reject) => {
      const request = store.put(entry);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    console.log("[OfflineCache] Saved manual Z-Report:", entry.id);
    db.close();
    return entry;
  } catch (error) {
    console.error("[OfflineCache] Failed to save manual Z-Report:", error);
    throw error;
  }
}

/**
 * Get all unsynced manual Z-Reports
 */
export async function getUnsyncedManualReports(): Promise<ManualZReport[]> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORES.manualEntries, "readonly");
    const store = tx.objectStore(STORES.manualEntries);
    const index = store.index("synced");

    const reports = await new Promise<ManualZReport[]>((resolve, reject) => {
      const request = index.getAll(IDBKeyRange.only(false));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    db.close();
    return reports;
  } catch (error) {
    console.error("[OfflineCache] Failed to get unsynced reports:", error);
    return [];
  }
}

/**
 * Get all manual Z-Reports for a specific tenant (for calculating S-Number)
 */
export async function getAllManualReports(tenantId?: string): Promise<ManualZReport[]> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORES.manualEntries, "readonly");
    const store = tx.objectStore(STORES.manualEntries);

    const reports = await new Promise<ManualZReport[]>((resolve, reject) => {
      if (tenantId) {
        // Use tenant_id index if available, fallback to getAll + filter
        try {
          const index = store.index("tenant_id");
          const request = index.getAll(IDBKeyRange.only(tenantId));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        } catch {
          // Index may not exist on older DB versions — filter in JS
          const request = store.getAll();
          request.onsuccess = () => resolve(
            (request.result as ManualZReport[]).filter(r => r.tenant_id === tenantId)
          );
          request.onerror = () => reject(request.error);
        }
      } else {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }
    });

    db.close();
    return reports;
  } catch (error) {
    console.error("[OfflineCache] Failed to get all manual reports:", error);
    return [];
  }
}

/**
 * Mark manual reports as synced
 */
export async function markReportsSynced(reportIds: string[]): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORES.manualEntries, "readwrite");
    const store = tx.objectStore(STORES.manualEntries);

    for (const id of reportIds) {
      const request = store.get(id);
      request.onsuccess = () => {
        const report = request.result as ManualZReport;
        if (report) {
          report.synced = true;
          store.put(report);
        }
      };
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    console.log(`[OfflineCache] Marked ${reportIds.length} reports as synced`);
    db.close();
  } catch (error) {
    console.error("[OfflineCache] Failed to mark reports synced:", error);
    throw error;
  }
}

/**
 * Get cache metadata (last sync time, staleness)
 */
export async function getCacheMetadata(key: string): Promise<CacheMetadata | null> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORES.meta, "readonly");
    const store = tx.objectStore(STORES.meta);

    const meta = await new Promise<CacheMetadata | null>((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });

    db.close();
    return meta;
  } catch (error) {
    console.error("[OfflineCache] Failed to get cache metadata:", error);
    return null;
  }
}

/**
 * Check if IndexedDB is supported
 */
export function isIndexedDBSupported(): boolean {
  return typeof indexedDB !== "undefined";
}

/**
 * Clear all cached data
 */
export async function clearCache(): Promise<void> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(Object.values(STORES), "readwrite");

    for (const storeName of Object.values(STORES)) {
      tx.objectStore(storeName).clear();
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    console.log("[OfflineCache] Cache cleared");
    db.close();
  } catch (error) {
    console.error("[OfflineCache] Failed to clear cache:", error);
    throw error;
  }
}

export type { ManualZReport, CacheMetadata };
