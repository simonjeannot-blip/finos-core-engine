import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AbsoluteTruthTotals } from "@/hooks/useLedger";
import { cn } from "@/lib/utils";

interface AbsoluteTruthDisplayProps {
  totals: AbsoluteTruthTotals | null;
}

export function AbsoluteTruthDisplay({ totals }: AbsoluteTruthDisplayProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      signDisplay: "always",
    }).format(amount);
  };

  const r = totals?.r_total ?? 0;
  const p = totals?.p_total ?? 0;
  const o = totals?.o_total ?? 0;
  const v = totals?.v_total ?? 0;
  const d = totals?.d_total ?? 0;
  const a = totals?.a_total ?? 0;
  const s = totals?.s_value ?? 0;

  return (
    <Card className="border-2 border-primary/20 bg-gradient-to-br from-card to-secondary/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-semibold">
          Absolute Truth Calculator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-1">
            S = (R - P) - (O + V + D + A)
          </p>
          <p
            className={cn(
              "text-4xl font-bold tracking-tight",
              s >= 0 ? "text-category-r" : "text-category-p"
            )}
          >
            {formatCurrency(s)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-md bg-muted/50 p-2">
            <span className="text-muted-foreground">R - P = </span>
            <span className="font-medium">{formatCurrency(r - p)}</span>
          </div>
          <div className="rounded-md bg-muted/50 p-2">
            <span className="text-muted-foreground">O + V + D + A = </span>
            <span className="font-medium">{formatCurrency(o + v + d + a)}</span>
          </div>
        </div>

        <div className="grid grid-cols-6 gap-1 text-xs">
          <div className="text-center">
            <p className="font-medium text-category-r">{formatCurrency(r)}</p>
            <p className="text-muted-foreground">R</p>
          </div>
          <div className="text-center">
            <p className="font-medium text-category-p">{formatCurrency(p)}</p>
            <p className="text-muted-foreground">P</p>
          </div>
          <div className="text-center">
            <p className="font-medium text-category-o">{formatCurrency(o)}</p>
            <p className="text-muted-foreground">O</p>
          </div>
          <div className="text-center">
            <p className="font-medium text-category-v">{formatCurrency(v)}</p>
            <p className="text-muted-foreground">V</p>
          </div>
          <div className="text-center">
            <p className="font-medium text-category-d">{formatCurrency(d)}</p>
            <p className="text-muted-foreground">D</p>
          </div>
          <div className="text-center">
            <p className="font-medium text-category-a">{formatCurrency(a)}</p>
            <p className="text-muted-foreground">A</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
