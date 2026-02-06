import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { Shield, Scale, Zap } from "lucide-react";
import { StrategyMode, STRATEGY_CONFIG } from "@/constants/strategy";
import { cn } from "@/lib/utils";

interface StrategyToggleProps {
  value: StrategyMode;
  onChange: (value: StrategyMode) => void;
  compact?: boolean;
}

const STRATEGY_ICONS = {
  defensive: Shield,
  neutral: Scale,
  aggressive: Zap,
} as const;

export function StrategyToggle({ value, onChange, compact = false }: StrategyToggleProps) {
  const handleChange = (newValue: string) => {
    if (newValue) {
      onChange(newValue as StrategyMode);
    }
  };

  if (compact) {
    return (
      <ToggleGroup type="single" value={value} onValueChange={handleChange} className="gap-1">
        {(Object.keys(STRATEGY_CONFIG) as StrategyMode[]).map((mode) => {
          const Icon = STRATEGY_ICONS[mode];
          const config = STRATEGY_CONFIG[mode];
          const isActive = value === mode;
          
          return (
            <ToggleGroupItem
              key={mode}
              value={mode}
              aria-label={config.label}
              className={cn(
                "gap-1 px-3",
                isActive && mode === "defensive" && "bg-destructive/20 text-destructive border-destructive",
                isActive && mode === "neutral" && "bg-secondary text-secondary-foreground",
                isActive && mode === "aggressive" && "bg-category-r/20 text-category-r border-category-r"
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="text-xs font-medium">{config.label}</span>
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    );
  }

  return (
    <div className="space-y-3">
      <ToggleGroup 
        type="single" 
        value={value} 
        onValueChange={handleChange}
        className="grid grid-cols-3 gap-2"
      >
        {(Object.keys(STRATEGY_CONFIG) as StrategyMode[]).map((mode) => {
          const Icon = STRATEGY_ICONS[mode];
          const config = STRATEGY_CONFIG[mode];
          const isActive = value === mode;
          
          return (
            <ToggleGroupItem
              key={mode}
              value={mode}
              aria-label={config.label}
              className={cn(
                "flex flex-col items-center gap-2 h-auto py-3 px-2",
                isActive && mode === "defensive" && "bg-destructive/20 text-destructive border-destructive",
                isActive && mode === "neutral" && "bg-secondary text-secondary-foreground",
                isActive && mode === "aggressive" && "bg-category-r/20 text-category-r border-category-r"
              )}
            >
              <Icon className={cn("h-5 w-5", isActive && "animate-pulse")} />
              <span className="text-sm font-semibold">{config.label}</span>
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>

      {/* Active strategy details */}
      <div className="rounded-lg bg-muted/50 p-3 space-y-2">
        <div className="flex items-center gap-2">
          {(() => {
            const Icon = STRATEGY_ICONS[value];
            return <Icon className="h-4 w-4" />;
          })()}
          <span className="font-medium text-sm">{STRATEGY_CONFIG[value].label} Mode</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {STRATEGY_CONFIG[value].description}
        </p>
        
        {/* Multiplier badges */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Badge variant="outline" className="text-xs">
            Labor ×{STRATEGY_CONFIG[value].laborMultiplier.toFixed(2)}
          </Badge>
          <Badge variant="outline" className="text-xs">
            Product ×{STRATEGY_CONFIG[value].productMultiplier.toFixed(3)}
          </Badge>
          <Badge variant="outline" className="text-xs">
            VAT @{(STRATEGY_CONFIG[value].vatRate * 100).toFixed(0)}%
          </Badge>
          <Badge variant="outline" className="text-xs">
            Energy ×{STRATEGY_CONFIG[value].energyMultiplier.toFixed(2)}
          </Badge>
        </div>
      </div>
    </div>
  );
}
