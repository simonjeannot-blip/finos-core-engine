import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface DiscoveredInvoice {
  message_id: string;
  sender_name: string;
  sender_address: string;
  sender_domain: string;
  subject: string;
  filename: string;
  file_size: number;
  received_at: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  confidence_reason: string;
  is_known_supplier: boolean;
  is_already_siphoned: boolean;
}

export interface SupplierProfile {
  domain: string;
  sender_names: string[];
  total_pdfs: number;
  cadence: string;
  is_known: boolean;
  highest_confidence: "HIGH" | "MEDIUM" | "LOW";
}

export interface NewSupplierAlert {
  domain: string;
  sender_names: string[];
  total_pdfs: number;
  cadence: string;
  flag: string;
  action: string;
}

export interface RawLogSummary {
  total_attachments_seen: number;
  pdfs_accepted: number;
  non_pdfs_rejected: number;
  consumer_domain_skipped: number;
}

export interface DiscoveryScanResult {
  status: string;
  siphon_state: string;
  version?: string;
  scan_id?: string;
  scan_window_days: number;
  messages_scanned: number;
  total_pdfs_found: number;
  raw_log?: RawLogSummary;
  summary: {
    high_confidence: number;
    medium_confidence: number;
    low_confidence: number;
    already_siphoned: number;
  };
  discoveries: DiscoveredInvoice[];
  suppliers: SupplierProfile[];
  new_suppliers: NewSupplierAlert[];
  scan_timestamp: string;
}

interface DiscoveryScanState {
  scanning: boolean;
  result: DiscoveryScanResult | null;
  error: string | null;
  polledCount: number | null;
  diagnosticTimeout: boolean;
}

const POLL_INTERVAL_MS = 5000;
const DIAGNOSTIC_TIMEOUT_MS = 30000;

export function useDiscoveryScan() {
  const { user } = useAuth();
  const [state, setState] = useState<DiscoveryScanState>({
    scanning: false,
    result: null,
    error: null,
    polledCount: null,
    diagnosticTimeout: false,
  });

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanStartRef = useRef<number>(0);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const startPolling = useCallback(() => {
    if (!user) return;

    // Clear any existing
    if (pollRef.current) clearInterval(pollRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    scanStartRef.current = Date.now();
    setState((prev) => ({ ...prev, polledCount: null, diagnosticTimeout: false }));

    // Poll discovered_invoices every 5 seconds
    pollRef.current = setInterval(async () => {
      try {
        const { count, error } = await supabase
          .from("discovered_invoices")
          .select("*", { count: "exact", head: true })
          .eq("user_id", user.id);

        if (!error && count !== null) {
          setState((prev) => ({ ...prev, polledCount: count }));
        }
      } catch {
        // Silent fail on polling
      }
    }, POLL_INTERVAL_MS);

    // Diagnostic timeout after 30 seconds
    timeoutRef.current = setTimeout(() => {
      setState((prev) => {
        // Only trigger if still scanning and no results
        if (prev.scanning && (prev.polledCount === null || prev.polledCount === 0)) {
          return { ...prev, diagnosticTimeout: true };
        }
        return prev;
      });
    }, DIAGNOSTIC_TIMEOUT_MS);
  }, [user]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const triggerDiscovery = useCallback(async (): Promise<DiscoveryScanResult | null> => {
    if (!user) return null;

    setState((prev) => ({ ...prev, scanning: true, error: null, diagnosticTimeout: false, polledCount: null }));
    startPolling();

    try {
      const { data, error } = await supabase.functions.invoke("ghost-discovery-scan", {
        method: "POST",
        body: {},
      });

      stopPolling();

      if (error) {
        const errMsg = error.message || "Discovery scan invocation failed";
        console.error("[Discovery] ❌", errMsg);
        setState((prev) => ({ ...prev, scanning: false, error: errMsg }));
        return null;
      }

      const result = data as DiscoveryScanResult;
      setState({
        scanning: false,
        result,
        error: result.siphon_state === "error" ? (data as any).message || "Token error" : null,
        polledCount: result.total_pdfs_found,
        diagnosticTimeout: false,
      });

      return result;
    } catch (err) {
      stopPolling();
      const errMsg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, scanning: false, error: errMsg }));
      return null;
    }
  }, [user, startPolling, stopPolling]);

  const clearResults = useCallback(() => {
    stopPolling();
    setState({ scanning: false, result: null, error: null, polledCount: null, diagnosticTimeout: false });
  }, [stopPolling]);

  return {
    ...state,
    triggerDiscovery,
    clearResults,
  };
}
