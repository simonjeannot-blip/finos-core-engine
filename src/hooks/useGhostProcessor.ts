import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ProcessorResult {
  status: "processed" | "flagged_for_human_audit";
  extraction: {
    supplier_name: string | null;
    total_amount: number | null;
    tax_amount: number | null;
    invoice_date: string | null;
    due_date: string | null;
    invoice_reference_number: string | null;
    confidence_percent: number;
    extraction_notes: string;
  };
  amount_detected: number;
  accrual_id: string | null;
  invoice_id: string | null;
  flagged: boolean;
}

interface ProcessingState {
  /** Map of dedupKey → processing state */
  processing: Record<string, boolean>;
  /** Map of dedupKey → result */
  results: Record<string, ProcessorResult>;
  /** Map of dedupKey → error */
  errors: Record<string, string>;
}

export function useGhostProcessor() {
  const [state, setState] = useState<ProcessingState>({
    processing: {},
    results: {},
    errors: {},
  });

  const processInvoice = useCallback(
    async (params: {
      invoice_id?: string;
      message_id: string;
      attachment_id: string;
      sender?: string;
      subject?: string;
      filename?: string;
    }): Promise<ProcessorResult | null> => {
      const dedupKey = `${params.message_id}::${params.attachment_id}`;

      setState((prev) => ({
        ...prev,
        processing: { ...prev.processing, [dedupKey]: true },
        errors: { ...prev.errors, [dedupKey]: "" },
      }));

      try {
        const { data, error } = await supabase.functions.invoke("ghost-processor", {
          method: "POST",
          body: params,
        });

        if (error) {
          const errMsg = error.message || "Processor invocation failed";
          setState((prev) => ({
            ...prev,
            processing: { ...prev.processing, [dedupKey]: false },
            errors: { ...prev.errors, [dedupKey]: errMsg },
          }));
          return null;
        }

        const result = data as ProcessorResult;
        setState((prev) => ({
          ...prev,
          processing: { ...prev.processing, [dedupKey]: false },
          results: { ...prev.results, [dedupKey]: result },
        }));

        return result;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setState((prev) => ({
          ...prev,
          processing: { ...prev.processing, [dedupKey]: false },
          errors: { ...prev.errors, [dedupKey]: errMsg },
        }));
        return null;
      }
    },
    []
  );

  const isProcessing = useCallback(
    (dedupKey: string) => !!state.processing[dedupKey],
    [state.processing]
  );

  const getResult = useCallback(
    (dedupKey: string) => state.results[dedupKey] || null,
    [state.results]
  );

  const getError = useCallback(
    (dedupKey: string) => state.errors[dedupKey] || null,
    [state.errors]
  );

  return {
    processInvoice,
    isProcessing,
    getResult,
    getError,
    processingCount: Object.values(state.processing).filter(Boolean).length,
  };
}
