import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import {
  LedgerEntry,
  getCategoryColor,
  checkVatSentinel,
} from "@/hooks/useLedger";
import { cn } from "@/lib/utils";

interface LedgerCardViewProps {
  entries: LedgerEntry[];
  isLoading: boolean;
}

export function LedgerCardView({ entries, isLoading }: LedgerCardViewProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
    }).format(amount);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-lg font-medium text-muted-foreground">
          No ledger entries yet
        </p>
        <p className="text-sm text-muted-foreground">
          Scan a receipt to get started
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => {
        const hasSentinelWarning =
          entry.category === "R" &&
          checkVatSentinel(entry.gross_amount, entry.vat_amount);

        return (
          <Card
            key={entry.id}
            className={cn(
              "relative overflow-hidden",
              hasSentinelWarning && "border-sentinel-warning"
            )}
          >
            {/* Category color bar */}
            <div
              className={cn(
                "absolute inset-y-0 left-0 w-1.5",
                getCategoryColor(entry.category)
              )}
            />
            <CardContent className="p-4 pl-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  {/* Vendor name - main focus */}
                  <p className="font-semibold text-base truncate">
                    {entry.vendor_name}
                  </p>
                  {/* Category badge */}
                  <div className="flex items-center gap-2 mt-1">
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-white text-xs",
                        getCategoryColor(entry.category)
                      )}
                    >
                      {entry.category}
                    </Badge>
                    {entry.pot_id && (
                      <Badge variant="outline" className="text-xs">
                        {entry.pot_id}
                      </Badge>
                    )}
                  </div>
                </div>
                {/* Amount - prominent on right */}
                <div className="text-right flex-shrink-0">
                  <p className="text-xl font-bold font-mono">
                    {formatCurrency(entry.gross_amount)}
                  </p>
                  {/* VAT Sentinel warning */}
                  {hasSentinelWarning && (
                    <div className="flex items-center justify-end gap-1 mt-1 text-sentinel-warning">
                      <AlertTriangle className="h-4 w-4" />
                      <span className="text-xs font-medium">VAT Alert</span>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
