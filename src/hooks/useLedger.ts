import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type LedgerCategory = "R" | "P" | "O" | "V" | "D" | "A";

export interface LedgerEntry {
  id: string;
  created_at: string;
  transaction_date: string;
  vendor_name: string;
  category: LedgerCategory;
  pot_id: string | null;
  net_amount: number;
  vat_amount: number;
  gross_amount: number;
  metadata: Record<string, unknown>;
  audit_id: string | null;
  user_id: string;
}

export interface AbsoluteTruthTotals {
  user_id: string;
  r_total: number;
  p_total: number;
  o_total: number;
  v_total: number;
  d_total: number;
  a_total: number;
  s_value: number;
}

export function useLedger() {
  return useQuery({
    queryKey: ["financial_ledger"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_ledger")
        .select("*")
        .order("transaction_date", { ascending: false });

      if (error) throw error;
      return data as LedgerEntry[];
    },
  });
}

export function useAbsoluteTruth() {
  return useQuery({
    queryKey: ["absolute_truth_calculator"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("absolute_truth_calculator")
        .select("*")
        .single();

      if (error && error.code !== "PGRST116") throw error; // PGRST116 = no rows
      return data as AbsoluteTruthTotals | null;
    },
  });
}

export function getCategoryLabel(category: LedgerCategory): string {
  const labels: Record<LedgerCategory, string> = {
    R: "Revenue",
    P: "Product",
    O: "Operations",
    V: "VAT",
    D: "Depreciation",
    A: "Admin",
  };
  return labels[category];
}

export function getCategoryColor(category: LedgerCategory): string {
  const colors: Record<LedgerCategory, string> = {
    R: "bg-category-r",
    P: "bg-category-p",
    O: "bg-category-o",
    V: "bg-category-v",
    D: "bg-category-d",
    A: "bg-category-a",
  };
  return colors[category];
}

export function getCategoryTextColor(category: LedgerCategory): string {
  const colors: Record<LedgerCategory, string> = {
    R: "text-category-r",
    P: "text-category-p",
    O: "text-category-o",
    V: "text-category-v",
    D: "text-category-d",
    A: "text-category-a",
  };
  return colors[category];
}

export function checkVatSentinel(grossAmount: number, vatAmount: number): boolean {
  // VAT Sentinel: Check if VAT = Gross / 6 (within £0.02 tolerance for rounding)
  const expectedVat = grossAmount / 6;
  const tolerance = 0.02; // £0.02 tolerance
  return Math.abs(vatAmount - expectedVat) > tolerance;
}
