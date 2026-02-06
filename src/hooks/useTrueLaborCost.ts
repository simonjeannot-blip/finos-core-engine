import { useMemo } from "react";
import {
  NLW_2026,
  EMPLOYER_NI_RATE,
  NI_THRESHOLD_WEEKLY,
  PENSION_RATE,
  HOLIDAY_ACCRUAL_RATE,
  FULLY_LOADED_COEFFICIENT,
} from "@/constants/economics";

export interface LaborCostBreakdown {
  baseWage: number;
  employerNI: number;
  pensionContribution: number;
  holidayAccrual: number;
  trueTotalCost: number;
  hourlyRate: number;
  fullyLoadedRate: number;
}

/**
 * Calculate the TRUE labor cost including all employer burdens
 * 
 * Formula: (Hours × NLW) + ((Hours × NLW - NI_THRESHOLD) × NI_RATE) + (Wage × PENSION) + (Wage × HOLIDAY)
 * 
 * @param hours - Number of hours worked
 * @param customHourlyRate - Optional custom hourly rate (defaults to NLW_2026)
 * @returns Full breakdown of true labor costs
 */
export function calculateTrueLaborCost(
  hours: number,
  customHourlyRate?: number
): LaborCostBreakdown {
  const hourlyRate = customHourlyRate ?? NLW_2026;
  const baseWage = hours * hourlyRate;
  
  // Employer's NI: (Gross - Threshold) × Rate
  // Only applies if wage exceeds threshold
  const niableAmount = Math.max(0, baseWage - NI_THRESHOLD_WEEKLY);
  const employerNI = niableAmount * EMPLOYER_NI_RATE;
  
  // Pension: 3% of total wage
  const pensionContribution = baseWage * PENSION_RATE;
  
  // Holiday Accrual: 12.07% of total wage
  const holidayAccrual = baseWage * HOLIDAY_ACCRUAL_RATE;
  
  // True Total = Base + NI + Pension + Holiday
  const trueTotalCost = baseWage + employerNI + pensionContribution + holidayAccrual;
  
  // Fully-loaded rate per hour (what it ACTUALLY costs)
  const fullyLoadedRate = hours > 0 ? trueTotalCost / hours : FULLY_LOADED_COEFFICIENT;

  return {
    baseWage: Math.round(baseWage * 100) / 100,
    employerNI: Math.round(employerNI * 100) / 100,
    pensionContribution: Math.round(pensionContribution * 100) / 100,
    holidayAccrual: Math.round(holidayAccrual * 100) / 100,
    trueTotalCost: Math.round(trueTotalCost * 100) / 100,
    hourlyRate,
    fullyLoadedRate: Math.round(fullyLoadedRate * 100) / 100,
  };
}

/**
 * Quick calculation using the fully-loaded coefficient
 * Use when you just need a fast estimate without breakdown
 */
export function calculateQuickLaborCost(hours: number): number {
  return Math.round(hours * FULLY_LOADED_COEFFICIENT * 100) / 100;
}

/**
 * Hook for reactive labor cost calculations
 */
export function useTrueLaborCost(hours: number, customHourlyRate?: number) {
  return useMemo(
    () => calculateTrueLaborCost(hours, customHourlyRate),
    [hours, customHourlyRate]
  );
}

/**
 * Calculate labor cost as percentage of revenue
 * Critical metric for hospitality profitability
 */
export function calculateLaborPercentage(
  laborCost: number,
  revenue: number
): number {
  if (revenue <= 0) return 0;
  return Math.round((laborCost / revenue) * 10000) / 100; // Returns percentage with 2 decimals
}
