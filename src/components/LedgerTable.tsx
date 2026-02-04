import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  LedgerEntry,
  getCategoryColor,
  getCategoryLabel,
  checkVatSentinel,
} from "@/hooks/useLedger";
import { cn } from "@/lib/utils";

interface LedgerTableProps {
  entries: LedgerEntry[];
  isLoading: boolean;
}

export function LedgerTable({ entries, isLoading }: LedgerTableProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
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
          Upload a receipt to get started
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Vendor</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Pot ID</TableHead>
            <TableHead className="text-right">Net</TableHead>
            <TableHead className="text-right">VAT</TableHead>
            <TableHead className="text-right">Gross</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => {
            const hasSentinelWarning =
              entry.category === "R" &&
              checkVatSentinel(entry.net_amount, entry.vat_amount);

            return (
              <TableRow
                key={entry.id}
                className={cn(hasSentinelWarning && "bg-sentinel-warning/10")}
              >
                <TableCell className="font-medium">
                  {formatDate(entry.transaction_date)}
                </TableCell>
                <TableCell>{entry.vendor_name}</TableCell>
                <TableCell>
                  <Badge
                    variant="secondary"
                    className={cn(
                      "text-white",
                      getCategoryColor(entry.category)
                    )}
                  >
                    {entry.category} - {getCategoryLabel(entry.category)}
                  </Badge>
                </TableCell>
                <TableCell>
                  {entry.pot_id ? (
                    <Badge variant="outline">{entry.pot_id}</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatCurrency(entry.net_amount)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  <div className="flex items-center justify-end gap-1">
                    {formatCurrency(entry.vat_amount)}
                    {hasSentinelWarning && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <AlertTriangle className="h-4 w-4 text-sentinel-warning" />
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="font-medium">VAT Sentinel Warning</p>
                          <p className="text-xs">
                            VAT deviates from 1/6th rule (Net ÷ 6 ={" "}
                            {formatCurrency(entry.net_amount / 6)})
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatCurrency(entry.gross_amount)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
