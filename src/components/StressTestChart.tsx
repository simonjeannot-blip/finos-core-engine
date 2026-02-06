import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, Scale, Zap } from "lucide-react";
import { SNumberResult, StrategyMode, STRATEGY_CONFIG } from "@/constants/strategy";
import { cn } from "@/lib/utils";

interface StressTestChartProps {
  results: Record<StrategyMode, SNumberResult>;
  activeStrategy: StrategyMode;
}

const STRATEGY_ICONS = {
  defensive: Shield,
  neutral: Scale,
  aggressive: Zap,
} as const;

const STRATEGY_ORDER: StrategyMode[] = ["defensive", "neutral", "aggressive"];

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    signDisplay: "always",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function StressTestChart({ results, activeStrategy }: StressTestChartProps) {
  // Calculate bar dimensions
  const chartData = useMemo(() => {
    const values = STRATEGY_ORDER.map((mode) => results[mode].sValue);
    const maxValue = Math.max(...values.map(Math.abs), 1); // Avoid division by zero
    
    return STRATEGY_ORDER.map((mode) => {
      const sValue = results[mode].sValue;
      const percentage = (Math.abs(sValue) / maxValue) * 100;
      const isPositive = sValue >= 0;
      
      return {
        mode,
        sValue,
        percentage: Math.min(percentage, 100),
        isPositive,
        config: STRATEGY_CONFIG[mode],
        Icon: STRATEGY_ICONS[mode],
      };
    });
  }, [results]);

  // Find the range for the zero line position
  const allValues = chartData.map((d) => d.sValue);
  const minValue = Math.min(...allValues);
  const maxValue = Math.max(...allValues);
  const range = maxValue - minValue || 1;
  const zeroPosition = maxValue > 0 && minValue < 0 
    ? (maxValue / range) * 100 
    : maxValue <= 0 ? 100 : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            📊
          </span>
          Stress Test Comparison
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Chart Area */}
        <div className="relative space-y-3">
          {/* Zero line indicator (if range crosses zero) */}
          {minValue < 0 && maxValue > 0 && (
            <div 
              className="absolute top-0 bottom-0 w-px bg-border z-10"
              style={{ left: `${zeroPosition}%` }}
            >
              <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs text-muted-foreground">
                £0
              </span>
            </div>
          )}
          
          {chartData.map((data, index) => {
            const isActive = data.mode === activeStrategy;
            
            return (
              <div 
                key={data.mode}
                className={cn(
                  "relative rounded-lg p-3 transition-all duration-300",
                  isActive ? "bg-muted ring-2 ring-primary" : "bg-muted/50 hover:bg-muted/70"
                )}
              >
                {/* Header Row */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <data.Icon className={cn(
                      "h-4 w-4",
                      data.mode === "defensive" && "text-destructive",
                      data.mode === "neutral" && "text-muted-foreground",
                      data.mode === "aggressive" && "text-category-r"
                    )} />
                    <span className="font-medium text-sm">{data.config.label}</span>
                    {isActive && (
                      <Badge variant="outline" className="text-xs">Active</Badge>
                    )}
                  </div>
                  <span className={cn(
                    "font-mono font-bold text-sm",
                    data.isPositive ? "text-category-r" : "text-destructive"
                  )}>
                    {formatCurrency(data.sValue)}
                  </span>
                </div>
                
                {/* Bar */}
                <div className="h-6 bg-background rounded-md overflow-hidden relative">
                  {/* The bar grows from left for positive, from right for negative */}
                  <div
                    className={cn(
                      "absolute top-0 bottom-0 rounded-md transition-all duration-500 ease-out",
                      data.isPositive 
                        ? "left-0 bg-gradient-to-r from-category-r/80 to-category-r" 
                        : "right-0 bg-gradient-to-l from-destructive/80 to-destructive"
                    )}
                    style={{ width: `${data.percentage}%` }}
                  />
                  
                  {/* Value label inside bar */}
                  <div className={cn(
                    "absolute inset-0 flex items-center px-2",
                    data.isPositive ? "justify-start" : "justify-end"
                  )}>
                    {data.percentage > 20 && (
                      <span className="text-xs font-medium text-white/90">
                        {data.percentage.toFixed(0)}%
                      </span>
                    )}
                  </div>
                </div>
                
                {/* Multiplier summary */}
                <div className="flex gap-2 mt-2 text-xs text-muted-foreground">
                  <span>O×{data.config.laborMultiplier}</span>
                  <span>•</span>
                  <span>P×{data.config.productMultiplier}</span>
                  <span>•</span>
                  <span>VAT@{(data.config.vatRate * 100).toFixed(0)}%</span>
                </div>
              </div>
            );
          })}
        </div>
        
        {/* Legend / Summary */}
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
          <span>← Worst Case</span>
          <span className="font-medium">Reality Mirror™</span>
          <span>Best Case →</span>
        </div>
      </CardContent>
    </Card>
  );
}
