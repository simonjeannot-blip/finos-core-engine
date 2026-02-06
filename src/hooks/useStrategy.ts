import { useState, useMemo, useCallback } from "react";
import { useAbsoluteTruth } from "./useLedger";
import {
  StrategyMode,
  SNumberInputs,
  SNumberResult,
  calculateSNumber,
  calculateAllStrategies,
  STRATEGY_CONFIG,
} from "@/constants/strategy";

export interface UseStrategyReturn {
  strategy: StrategyMode;
  setStrategy: (mode: StrategyMode) => void;
  inputs: SNumberInputs;
  updateInputs: (partial: Partial<SNumberInputs>) => void;
  result: SNumberResult;
  allResults: Record<StrategyMode, SNumberResult>;
  config: typeof STRATEGY_CONFIG;
}

/**
 * Hook for managing strategy state and S-Number calculations
 * 
 * Integrates with the Absolute Truth totals from the database
 * and allows manual input overrides for stress testing.
 */
export function useStrategy(defaultStrategy: StrategyMode = "neutral"): UseStrategyReturn {
  const { data: totals } = useAbsoluteTruth();
  const [strategy, setStrategy] = useState<StrategyMode>(defaultStrategy);
  
  // Manual input overrides (for fields not in the database)
  const [manualInputs, setManualInputs] = useState<Partial<SNumberInputs>>({
    laborHours: 0,
    energyCosts: 0,
    debtPayments: 0,
  });

  // Combine database totals with manual inputs
  const inputs: SNumberInputs = useMemo(() => {
    return {
      revenue: totals?.r_total ?? 0,
      purchases: totals?.p_total ?? 0,
      laborHours: manualInputs.laborHours ?? 0,
      energyCosts: totals?.o_total ?? 0, // Operations costs as energy proxy
      debtPayments: totals?.d_total ?? 0,
      accruals: totals?.a_total ?? 0,
    };
  }, [totals, manualInputs]);

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

  return {
    strategy,
    setStrategy,
    inputs,
    updateInputs,
    result,
    allResults,
    config: STRATEGY_CONFIG,
  };
}
