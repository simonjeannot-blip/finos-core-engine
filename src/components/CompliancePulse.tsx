import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, Calendar, Clock, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MTD_QUARTERLY_DEADLINES,
  VAT_STANDARD_RATE,
  ESTIMATED_COGS_RATE,
} from "@/constants/economics";
import { AbsoluteTruthTotals } from "@/hooks/useLedger";

interface CompliancePulseProps {
  totals: AbsoluteTruthTotals | null;
}

interface DeadlineInfo {
  quarter: string;
  deadline: string;
  period: string;
  daysRemaining: number;
  isPast: boolean;
  isUrgent: boolean;
}

function getNextDeadline(): DeadlineInfo {
  const today = new Date();
  
  for (const deadline of MTD_QUARTERLY_DEADLINES) {
    const deadlineDate = new Date(deadline.deadline);
    const daysRemaining = Math.ceil(
      (deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );
    
    if (daysRemaining >= 0) {
      return {
        ...deadline,
        daysRemaining,
        isPast: false,
        isUrgent: daysRemaining <= 14,
      };
    }
  }
  
  // All deadlines passed - show next cycle Q1
  const nextQ1 = {
    quarter: 'Q1',
    deadline: '2026-08-07',
    period: 'Apr - Jun 2026',
  };
  const deadlineDate = new Date(nextQ1.deadline);
  const daysRemaining = Math.ceil(
    (deadlineDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  
  return {
    ...nextQ1,
    daysRemaining,
    isPast: false,
    isUrgent: daysRemaining <= 14,
  };
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(amount);
}

export function CompliancePulse({ totals }: CompliancePulseProps) {
  const nextDeadline = useMemo(() => getNextDeadline(), []);
  
  // VAT Vault Calculation: 20% of Revenue minus estimated COGS VAT reclaim
  const vatVault = useMemo(() => {
    if (!totals) return { outputVat: 0, inputVat: 0, netLiability: 0 };
    
    const revenue = totals.r_total ?? 0;
    const purchases = totals.p_total ?? 0;
    
    // Output VAT (what we owe): Revenue is gross, so VAT = Revenue × (20/120)
    const outputVat = revenue * (VAT_STANDARD_RATE / (1 + VAT_STANDARD_RATE));
    
    // Input VAT (what we can reclaim): Purchases VAT
    // Estimate COGS at 30% of revenue if purchases are lower
    const estimatedCogs = Math.max(purchases, revenue * ESTIMATED_COGS_RATE);
    const inputVat = estimatedCogs * (VAT_STANDARD_RATE / (1 + VAT_STANDARD_RATE));
    
    // Net VAT liability
    const netLiability = outputVat - inputVat;
    
    return {
      outputVat: Math.round(outputVat * 100) / 100,
      inputVat: Math.round(inputVat * 100) / 100,
      netLiability: Math.round(netLiability * 100) / 100,
    };
  }, [totals]);
  
  // Countdown progress (100 days = 0%, 0 days = 100%)
  const countdownProgress = useMemo(() => {
    const maxDays = 90; // Quarter length
    return Math.min(100, Math.max(0, ((maxDays - nextDeadline.daysRemaining) / maxDays) * 100));
  }, [nextDeadline.daysRemaining]);

  return (
    <Card className="border-2 border-category-v/30 bg-gradient-to-br from-card to-category-v/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-category-v/20">
            <Calendar className="h-4 w-4 text-category-v" />
          </div>
          MTD Compliance Pulse
          {nextDeadline.isUrgent && (
            <Badge variant="destructive" className="ml-auto animate-pulse">
              <AlertTriangle className="mr-1 h-3 w-3" />
              Urgent
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Countdown to Submission */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {nextDeadline.quarter} Deadline: {nextDeadline.period}
            </span>
            <span className="font-mono font-medium">
              {new Date(nextDeadline.deadline).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
          </div>
          
          <div className="flex items-center gap-3">
            <Progress 
              value={countdownProgress} 
              className={cn(
                "h-2 flex-1",
                nextDeadline.isUrgent && "[&>div]:bg-destructive"
              )}
            />
            <div className={cn(
              "flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold",
              nextDeadline.isUrgent 
                ? "bg-destructive/10 text-destructive" 
                : "bg-category-v/10 text-category-v"
            )}>
              <Clock className="h-3 w-3" />
              {nextDeadline.daysRemaining}d
            </div>
          </div>
        </div>

        {/* VAT Vault */}
        <div className="rounded-lg bg-muted/50 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-category-v" />
              VAT Vault Estimate
            </span>
            <Badge 
              variant="outline" 
              className={cn(
                "font-mono",
                vatVault.netLiability > 0 
                  ? "border-category-p text-category-p" 
                  : "border-category-r text-category-r"
              )}
            >
              {vatVault.netLiability > 0 ? "Owed" : "Reclaim"}
            </Badge>
          </div>
          
          <div className="text-2xl font-bold font-mono">
            {formatCurrency(Math.abs(vatVault.netLiability))}
          </div>
          
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Output VAT:</span>
              <span className="font-mono">{formatCurrency(vatVault.outputVat)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Input VAT:</span>
              <span className="font-mono text-category-r">-{formatCurrency(vatVault.inputVat)}</span>
            </div>
          </div>
        </div>

        {/* Quarterly Timeline */}
        <div className="flex justify-between text-xs">
          {MTD_QUARTERLY_DEADLINES.map((q) => {
            const isPast = new Date(q.deadline) < new Date();
            const isCurrent = q.quarter === nextDeadline.quarter;
            
            return (
              <div 
                key={q.quarter}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-md px-2 py-1",
                  isCurrent && "bg-category-v/20",
                  isPast && "opacity-50"
                )}
              >
                <span className={cn(
                  "font-semibold",
                  isCurrent && "text-category-v"
                )}>
                  {q.quarter}
                </span>
                <span className="text-muted-foreground">
                  {q.deadline.split("-")[1]}/{q.deadline.split("-")[0].slice(2)}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
