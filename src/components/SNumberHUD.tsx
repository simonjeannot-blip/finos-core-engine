import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SNumberResult, StrategyMode } from "@/constants/strategy";
import { cn } from "@/lib/utils";

interface SNumberHUDProps {
  result: SNumberResult;
  allResults: Record<StrategyMode, SNumberResult>;
  showBreakdown?: boolean;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    signDisplay: "always",
  }).format(amount);
}

function formatCurrencyCompact(amount: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount);
}

export function SNumberHUD({ result, allResults, showBreakdown = true }: SNumberHUDProps) {
  const { sValue, breakdown, strategy, multipliers } = result;
  
  // Determine trend icon and color
  const isPositive = sValue > 0;
  const isNegative = sValue < 0;
  const TrendIcon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;
  
  // Compare to neutral baseline
  const neutralS = allResults.neutral.sValue;
  const deltaFromNeutral = sValue - neutralS;
  const percentDelta = neutralS !== 0 ? (deltaFromNeutral / Math.abs(neutralS)) * 100 : 0;

  return (
    <Card className={cn(
      "border-2 transition-colors duration-300",
      isPositive && "border-category-r/30 bg-gradient-to-br from-card to-category-r/5",
      isNegative && "border-destructive/30 bg-gradient-to-br from-card to-destructive/5",
      !isPositive && !isNegative && "border-muted"
    )}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            Safe-to-Invest (S)
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-xs">
                  <strong>S = (R - P×Buffer) - Labor - VAT - Energy - Debt - Accruals</strong>
                  <br /><br />
                  The money that's truly "safe" to reinvest after all 2026 liabilities are accounted for.
                </p>
              </TooltipContent>
            </Tooltip>
          </span>
          <Badge 
            variant={strategy === "defensive" ? "destructive" : strategy === "aggressive" ? "default" : "secondary"}
            className="uppercase text-xs"
          >
            {multipliers.label}
          </Badge>
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Main S-Number Display */}
        <div className="text-center py-4">
          <div className="flex items-center justify-center gap-3">
            <TrendIcon className={cn(
              "h-8 w-8",
              isPositive && "text-category-r",
              isNegative && "text-destructive",
              !isPositive && !isNegative && "text-muted-foreground"
            )} />
            <span className={cn(
              "text-5xl font-bold font-mono tracking-tight",
              isPositive && "text-category-r",
              isNegative && "text-destructive"
            )}>
              {formatCurrency(sValue)}
            </span>
          </div>
          
          {/* Delta from neutral */}
          {strategy !== "neutral" && (
            <p className={cn(
              "text-sm mt-2",
              deltaFromNeutral > 0 ? "text-category-r" : deltaFromNeutral < 0 ? "text-destructive" : "text-muted-foreground"
            )}>
              {deltaFromNeutral > 0 ? "+" : ""}{formatCurrency(deltaFromNeutral)} vs Neutral
              <span className="text-muted-foreground ml-1">
                ({percentDelta > 0 ? "+" : ""}{percentDelta.toFixed(1)}%)
              </span>
            </p>
          )}
        </div>

        {/* Breakdown Table */}
        {showBreakdown && (
          <div className="space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div className="flex justify-between rounded-md bg-category-r/10 px-3 py-2">
                <span className="text-muted-foreground">Revenue (R)</span>
                <span className="font-mono font-medium text-category-r">
                  {formatCurrencyCompact(breakdown.grossRevenue)}
                </span>
              </div>
              <div className="flex justify-between rounded-md bg-category-p/10 px-3 py-2">
                <span className="text-muted-foreground">Purchases (P×{multipliers.productMultiplier})</span>
                <span className="font-mono font-medium text-category-p">
                  -{formatCurrencyCompact(breakdown.adjustedPurchases)}
                </span>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              <div className="flex justify-between rounded-md bg-category-o/10 px-3 py-2">
                <span className="text-muted-foreground">Labor (O×{multipliers.laborMultiplier})</span>
                <span className="font-mono font-medium text-category-o">
                  -{formatCurrencyCompact(breakdown.laborCost)}
                </span>
              </div>
              <div className="flex justify-between rounded-md bg-category-v/10 px-3 py-2">
                <span className="text-muted-foreground">VAT ({(multipliers.vatRate * 100).toFixed(0)}%)</span>
                <span className="font-mono font-medium text-category-v">
                  -{formatCurrencyCompact(breakdown.vatLiability)}
                </span>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              <div className="flex justify-between rounded-md bg-category-d/10 px-3 py-2">
                <span className="text-muted-foreground">Energy (E×{multipliers.energyMultiplier})</span>
                <span className="font-mono font-medium text-category-d">
                  -{formatCurrencyCompact(breakdown.energyCost)}
                </span>
              </div>
              <div className="flex justify-between rounded-md bg-category-a/10 px-3 py-2">
                <span className="text-muted-foreground">Debt + Accruals</span>
                <span className="font-mono font-medium text-category-a">
                  -{formatCurrencyCompact(breakdown.debtPayments + breakdown.accruals)}
                </span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
