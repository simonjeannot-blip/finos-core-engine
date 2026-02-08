import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface ScanResult {
  status: string;
  siphon_state: string;
  messages_scanned: number;
  new_invoices: number;
  duplicates_skipped: number;
  scan_timestamp: string;
  results: Array<{
    sender: string;
    subject: string;
    attachment: string;
    status: string;
  }>;
}

interface SiphonScannerState {
  scanning: boolean;
  lastScan: ScanResult | null;
  lastScanTime: Date | null;
  error: string | null;
  todayCount: number;
  todayCountLoading: boolean;
}

export function useSiphonScanner() {
  const { user } = useAuth();
  const [state, setState] = useState<SiphonScannerState>({
    scanning: false,
    lastScan: null,
    lastScanTime: null,
    error: null,
    todayCount: 0,
    todayCountLoading: true,
  });

  const fetchTodayCount = useCallback(async () => {
    if (!user) return;

    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { count, error } = await (supabase
        .from("siphoned_invoices" as any)
        .select("id", { count: "exact", head: true })
        .gte("created_at", todayStart.toISOString()) as any);

      if (!error) {
        setState((prev) => ({
          ...prev,
          todayCount: count || 0,
          todayCountLoading: false,
        }));
      }
    } catch {
      setState((prev) => ({ ...prev, todayCountLoading: false }));
    }
  }, [user]);

  const triggerScan = useCallback(async (): Promise<ScanResult | null> => {
    if (!user) return null;

    setState((prev) => ({ ...prev, scanning: true, error: null }));

    try {
      const { data, error } = await supabase.functions.invoke("ghost-siphon-scan", {
        method: "POST",
        body: {},
      });

      if (error) {
        const errMsg = error.message || "Scan invocation failed";
        console.error("[SiphonScanner] ❌", errMsg);
        setState((prev) => ({
          ...prev,
          scanning: false,
          error: errMsg,
        }));
        return null;
      }

      const result = data as ScanResult;
      setState((prev) => ({
        ...prev,
        scanning: false,
        lastScan: result,
        lastScanTime: new Date(),
        error: result.siphon_state === "error" ? (data as any).message || "Token error" : null,
        todayCount: prev.todayCount + (result.new_invoices || 0),
      }));

      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({
        ...prev,
        scanning: false,
        error: errMsg,
      }));
      return null;
    }
  }, [user]);

  return {
    ...state,
    triggerScan,
    fetchTodayCount,
  };
}
