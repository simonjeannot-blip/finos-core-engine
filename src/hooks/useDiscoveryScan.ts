import { useState, useCallback } from "react";
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

export interface DiscoveryScanResult {
  status: string;
  siphon_state: string;
  scan_window_days: number;
  messages_scanned: number;
  total_pdfs_found: number;
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
}

export function useDiscoveryScan() {
  const { user } = useAuth();
  const [state, setState] = useState<DiscoveryScanState>({
    scanning: false,
    result: null,
    error: null,
  });

  const triggerDiscovery = useCallback(async (): Promise<DiscoveryScanResult | null> => {
    if (!user) return null;

    setState((prev) => ({ ...prev, scanning: true, error: null }));

    try {
      const { data, error } = await supabase.functions.invoke("ghost-discovery-scan", {
        method: "POST",
        body: {},
      });

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
      });

      return result;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, scanning: false, error: errMsg }));
      return null;
    }
  }, [user]);

  const clearResults = useCallback(() => {
    setState({ scanning: false, result: null, error: null });
  }, []);

  return {
    ...state,
    triggerDiscovery,
    clearResults,
  };
}
