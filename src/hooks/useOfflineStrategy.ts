/**
 * Offline-Aware Strategy Hook
 * 
 * Extends useStrategy to fall back to cached data when Supabase is unreachable.
 * Integrates manual Z-Report entries into the S-Number calculation.
 */

import { useState, useMemo, useCallback, useEffect } from "react";
import { useAbsoluteTruth, AbsoluteTruthTotals, useLedger, LedgerEntry, HAGGERSTON_TENANT_ID } from "./useLedger";
import { useOnlineStatus } from "./useOnlineStatus";
import {
  StrategyMode,
  SNumberInputs,
  SNumberResult,
  calculateSNumber,
  calculateAllStrategies,
  STRATEGY_CONFIG,
} from "@/constants/strategy";
import {
  cacheLedgerEntries,
  cacheTotals,
  getCachedLedgerEntries,
  getCachedTotals,
  getAllManualReports,
  getCacheMetadata,
  ManualZReport,
} from "@/lib/offlineCache";

export interface UseOfflineStrategyReturn {
  // Strategy state
  strategy: StrategyMode;
  setStrategy: (mode: StrategyMode) => void;
  inputs: SNumberInputs;
  updateInputs: (partial: Partial<SNumberInputs>) => void;
  result: SNumberResult;
  allResults: Record<StrategyMode, SNumberResult>;
  config: typeof STRATEGY_CONFIG;
  
  // Offline state
  isOffline: boolean;
  isUsingCache: boolean;
  lastSyncTime: Date | null;
  latencyMs: number | null;
  manualReports: ManualZReport[];
  
  // Ledger data
  ledgerEntries: LedgerEntry[];
  isLoading: boolean;
  
  // Actions
  refreshData: () => Promise<void>;
}

/**
 * Hook for managing strategy state with offline resilience
 */
export function useOfflineStrategy(defaultStrategy: StrategyMode = "neutral"): UseOfflineStrategyReturn {
  const { isOnline, isSupabaseReachable, lastHeartbeat, latencyMs, checkNow } = useOnlineStatus();
  const { data: liveEntries, isLoading: entriesLoading, refetch: refetchEntries } = useLedger();
  const { data: liveTotals, isLoading: totalsLoading, refetch: refetchTotals } = useAbsoluteTruth();
  
  const [strategy, setStrategy] = useState<StrategyMode>(defaultStrategy);
  const [cachedEntries, setCachedEntries] = useState<LedgerEntry[]>([]);
  const [cachedTotalsData, setCachedTotalsData] = useState<AbsoluteTruthTotals | null>(null);
  const [manualReports, setManualReports] = useState<ManualZReport[]>([]);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [isUsingCache, setIsUsingCache] = useState(false);
  
  // Manual input overrides
  const [manualInputs, setManualInputs] = useState<Partial<SNumberInputs>>({
    laborHours: 0,
    energyCosts: 0,
    debtPayments: 0,
  });

  // Determine if we're effectively offline
  const isOffline = !isOnline || !isSupabaseReachable;

  // Load cached data on mount
  useEffect(() => {
    const loadCachedData = async () => {
      try {
        const [entries, totals, reports, ledgerMeta] = await Promise.all([
          getCachedLedgerEntries<LedgerEntry>(),
          getCachedTotals<AbsoluteTruthTotals>(),
          getAllManualReports(HAGGERSTON_TENANT_ID),
          getCacheMetadata("ledger"),
        ]);

        setCachedEntries(entries);
        setCachedTotalsData(totals);
        setManualReports(reports);
        
        if (ledgerMeta?.lastSync) {
          setLastSyncTime(new Date(ledgerMeta.lastSync));
        }

        console.log("[OfflineStrategy] Loaded cached data:", {
          entries: entries.length,
          hasTotals: !!totals,
          manualReports: reports.length,
        });
      } catch (error) {
        console.error("[OfflineStrategy] Failed to load cached data:", error);
      }
    };

    loadCachedData();
  }, []);

  // Cache live data when online
  useEffect(() => {
    if (!isOffline && liveEntries && liveEntries.length > 0) {
      cacheLedgerEntries(liveEntries).then(() => {
        setCachedEntries(liveEntries);
        setLastSyncTime(new Date());
        setIsUsingCache(false);
      }).catch(console.error);
    }
  }, [isOffline, liveEntries]);

  useEffect(() => {
    if (!isOffline && liveTotals) {
      cacheTotals(liveTotals).then(() => {
        setCachedTotalsData(liveTotals);
        setIsUsingCache(false);
      }).catch(console.error);
    }
  }, [isOffline, liveTotals]);

  // Switch to cache when going offline
  useEffect(() => {
    if (isOffline) {
      setIsUsingCache(true);
      console.log("[OfflineStrategy] Switched to cached data mode");
    }
  }, [isOffline]);

  // Reload manual reports periodically
  useEffect(() => {
    const loadManualReports = async () => {
      const reports = await getAllManualReports();
      setManualReports(reports);
    };

    loadManualReports();
    const interval = setInterval(loadManualReports, 5000);
    return () => clearInterval(interval);
  }, []);

  // Determine which data source to use
  const ledgerEntries = useMemo(() => {
    if (isOffline || (!liveEntries && cachedEntries.length > 0)) {
      return cachedEntries;
    }
    return liveEntries ?? [];
  }, [isOffline, liveEntries, cachedEntries]);

  const totals = useMemo(() => {
    if (isOffline || (!liveTotals && cachedTotalsData)) {
      return cachedTotalsData;
    }
    return liveTotals ?? null;
  }, [isOffline, liveTotals, cachedTotalsData]);

  // Calculate manual report adjustments
  const manualAdjustments = useMemo(() => {
    if (manualReports.length === 0) {
      return { revenue: 0, purchases: 0, laborHours: 0, energyCosts: 0 };
    }

    return manualReports.reduce(
      (acc, report) => ({
        revenue: acc.revenue + report.revenue,
        purchases: acc.purchases + report.purchases,
        laborHours: acc.laborHours + report.laborHours,
        energyCosts: acc.energyCosts + report.energyCosts,
      }),
      { revenue: 0, purchases: 0, laborHours: 0, energyCosts: 0 }
    );
  }, [manualReports]);

  // Combine database totals with manual inputs and Z-Reports
  const inputs: SNumberInputs = useMemo(() => {
    return {
      revenue: (totals?.r_total ?? 0) + manualAdjustments.revenue,
      purchases: (totals?.p_total ?? 0) + manualAdjustments.purchases,
      laborHours: (manualInputs.laborHours ?? 0) + manualAdjustments.laborHours,
      energyCosts: (totals?.o_total ?? 0) + manualAdjustments.energyCosts,
      debtPayments: totals?.d_total ?? 0,
      accruals: totals?.a_total ?? 0,
    };
  }, [totals, manualInputs, manualAdjustments]);

  const updateInputs = useCallback((partial: Partial<SNumberInputs>) => {
    setManualInputs((prev) => ({ ...prev, ...partial }));
  }, []);

  // Calculate current strategy result
  const result = useMemo(() => {
    return calculateSNumber(inputs, strategy);
  }, [inputs, strategy]);

  // Calculate all strategies for comparison
  const allResults = useMemo(() => {
    return calculateAllStrategies(inputs);
  }, [inputs]);

  // Force refresh data
  const refreshData = useCallback(async () => {
    await checkNow();
    if (!isOffline) {
      await Promise.all([refetchEntries(), refetchTotals()]);
    }
    const reports = await getAllManualReports();
    setManualReports(reports);
  }, [checkNow, isOffline, refetchEntries, refetchTotals]);

  return {
    strategy,
    setStrategy,
    inputs,
    updateInputs,
    result,
    allResults,
    config: STRATEGY_CONFIG,
    isOffline,
    isUsingCache,
    lastSyncTime,
    latencyMs,
    manualReports,
    ledgerEntries,
    isLoading: entriesLoading || totalsLoading,
    refreshData,
  };
}
