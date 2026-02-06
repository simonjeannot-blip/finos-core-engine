/**
 * 2026 Survival Wall Economics Constants
 * Post-Squeeze Compliant Math Engine
 * 
 * These constants represent the TRUE cost of labor after all statutory obligations.
 * Updated for UK 2026 financial year regulations.
 */

// National Living Wage 2026 (21+ years)
export const NLW_2026 = 12.71;

// Employer's National Insurance Rate (15% from April 2025)
export const EMPLOYER_NI_RATE = 0.15;

// NI Secondary Threshold (weekly) - reduced to £96/week from April 2025
export const NI_THRESHOLD_WEEKLY = 96.00;

// Workplace Pension Contribution Rate (minimum employer contribution)
export const PENSION_RATE = 0.03;

// Holiday Accrual Rate (12.07% = 5.6 weeks / 46.4 working weeks)
export const HOLIDAY_ACCRUAL_RATE = 0.1207;

// Fully-Loaded Hourly Coefficient (default floor when no specific wage provided)
// This is the TRUE cost per hour including all employer burdens
export const FULLY_LOADED_COEFFICIENT = 16.53;

// VAT Standard Rate
export const VAT_STANDARD_RATE = 0.20;

// MTD Phase 3 Quarterly Filing Deadlines (2025-2026)
export const MTD_QUARTERLY_DEADLINES = [
  { quarter: 'Q1', deadline: '2025-08-07', period: 'Apr - Jun 2025' },
  { quarter: 'Q2', deadline: '2025-11-07', period: 'Jul - Sep 2025' },
  { quarter: 'Q3', deadline: '2026-02-07', period: 'Oct - Dec 2025' },
  { quarter: 'Q4', deadline: '2026-05-07', period: 'Jan - Mar 2026' },
] as const;

// COGS Estimate Rate (typical hospitality - 30% of revenue)
export const ESTIMATED_COGS_RATE = 0.30;
