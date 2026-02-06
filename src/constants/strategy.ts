/**
 * 2026 Absolute Truth Engine - Strategy Constants
 * 
 * Three operational modes for stress-testing the business reality:
 * - DEFENSIVE: Pessimistic buffers for maximum safety
 * - NEUTRAL: Statutory compliance baseline
 * - AGGRESSIVE: Optimistic efficiency gains
 */

import { FULLY_LOADED_COEFFICIENT, VAT_STANDARD_RATE } from "./economics";

export type StrategyMode = "defensive" | "neutral" | "aggressive";

export interface StrategyMultipliers {
  laborMultiplier: number;      // Applied to O (Operations/Labor)
  productMultiplier: number;    // Applied to P (Product/COGS)
  vatRate: number;              // VAT rate to apply
  energyMultiplier: number;     // Applied to Energy costs
  label: string;
  description: string;
  color: string;
}

/**
 * Strategy Configurations
 * 
 * DEFENSIVE: 
 *   - O × 1.05 (5% inefficiency buffer for overtime, sick cover)
 *   - P × 1.07 (7% shock buffer for supply chain disruption)
 *   - V @ 21% (pessimistic VAT for potential rate rise)
 *   - E × 1.08 (8% energy buffer for standing charge rises)
 * 
 * NEUTRAL:
 *   - O @ £16.53 base (no multiplier)
 *   - P × 1.044 (4.4% PPI statutory buffer)
 *   - V @ 20% (current rate)
 *   - E × 1.00 (no buffer)
 * 
 * AGGRESSIVE:
 *   - O × 0.97 (3% efficiency gain from optimization)
 *   - P × 1.00 (waste recapture, no buffer)
 *   - V @ 20% (current rate)
 *   - E × 0.92 (8% wholesale drop benefit)
 */
export const STRATEGY_CONFIG: Record<StrategyMode, StrategyMultipliers> = {
  defensive: {
    laborMultiplier: 1.05,
    productMultiplier: 1.07,
    vatRate: 0.21,
    energyMultiplier: 1.08,
    label: "Defensive",
    description: "Maximum buffers for worst-case scenarios",
    color: "destructive",
  },
  neutral: {
    laborMultiplier: 1.00,
    productMultiplier: 1.044,
    vatRate: VAT_STANDARD_RATE,
    energyMultiplier: 1.00,
    label: "Neutral",
    description: "Statutory compliance baseline",
    color: "secondary",
  },
  aggressive: {
    laborMultiplier: 0.97,
    productMultiplier: 1.00,
    vatRate: VAT_STANDARD_RATE,
    energyMultiplier: 0.92,
    label: "Aggressive",
    description: "Efficiency gains and waste recapture",
    color: "default",
  },
};

/**
 * Base hourly labor rate (fully-loaded 2026)
 */
export const BASE_LABOR_RATE = FULLY_LOADED_COEFFICIENT;

/**
 * Calculate the "Safe-to-Invest" (S) number
 * 
 * Formula: S = (R - (P × P_Buffer)) - (Hours × O_Rate × O_Multiplier) - VAT - Energy - Debt
 * 
 * Where:
 * - R = Revenue (gross)
 * - P = Purchases/COGS (net)
 * - Hours = Labor hours worked
 * - O_Rate = Base labor rate (£16.53)
 * - VAT = Revenue × VAT_Rate (output VAT liability)
 * - Energy = Energy costs × Energy_Multiplier
 * - Debt = Outstanding debt/liabilities
 */
export interface SNumberInputs {
  revenue: number;           // R - Gross revenue
  purchases: number;         // P - Net COGS/purchases
  laborHours: number;        // Hours worked this period
  energyCosts: number;       // E - Energy/utility costs
  debtPayments: number;      // D - Debt service/DLA movements
  accruals: number;          // A - Committed accruals
}

export interface SNumberResult {
  sValue: number;
  breakdown: {
    grossRevenue: number;
    adjustedPurchases: number;
    laborCost: number;
    vatLiability: number;
    energyCost: number;
    debtPayments: number;
    accruals: number;
  };
  strategy: StrategyMode;
  multipliers: StrategyMultipliers;
}

export function calculateSNumber(
  inputs: SNumberInputs,
  strategy: StrategyMode
): SNumberResult {
  const multipliers = STRATEGY_CONFIG[strategy];
  
  // Apply strategy multipliers
  const adjustedPurchases = inputs.purchases * multipliers.productMultiplier;
  const laborCost = inputs.laborHours * BASE_LABOR_RATE * multipliers.laborMultiplier;
  const vatLiability = inputs.revenue * (multipliers.vatRate / (1 + multipliers.vatRate)); // VAT from gross
  const energyCost = inputs.energyCosts * multipliers.energyMultiplier;
  
  // Calculate S = (R - P_adjusted) - Labor - VAT - Energy - Debt - Accruals
  const grossProfit = inputs.revenue - adjustedPurchases;
  const sValue = grossProfit - laborCost - vatLiability - energyCost - inputs.debtPayments - inputs.accruals;
  
  return {
    sValue: Math.round(sValue * 100) / 100,
    breakdown: {
      grossRevenue: inputs.revenue,
      adjustedPurchases: Math.round(adjustedPurchases * 100) / 100,
      laborCost: Math.round(laborCost * 100) / 100,
      vatLiability: Math.round(vatLiability * 100) / 100,
      energyCost: Math.round(energyCost * 100) / 100,
      debtPayments: inputs.debtPayments,
      accruals: inputs.accruals,
    },
    strategy,
    multipliers,
  };
}

/**
 * Calculate S-Number for all three strategies (for stress test comparison)
 */
export function calculateAllStrategies(inputs: SNumberInputs): Record<StrategyMode, SNumberResult> {
  return {
    defensive: calculateSNumber(inputs, "defensive"),
    neutral: calculateSNumber(inputs, "neutral"),
    aggressive: calculateSNumber(inputs, "aggressive"),
  };
}
