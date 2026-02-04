import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LedgerCategory, getCategoryLabel, getCategoryColor } from "@/hooks/useLedger";
import { cn } from "@/lib/utils";

interface CategoryCardProps {
  category: LedgerCategory;
  total: number;
}

export function CategoryCard({ category, total }: CategoryCardProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
    }).format(amount);
  };

  return (
    <Card className="relative overflow-hidden">
      <div
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          getCategoryColor(category)
        )}
      />
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <span
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white",
              getCategoryColor(category)
            )}
          >
            {category}
          </span>
          {getCategoryLabel(category)}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold">{formatCurrency(total)}</p>
      </CardContent>
    </Card>
  );
}
