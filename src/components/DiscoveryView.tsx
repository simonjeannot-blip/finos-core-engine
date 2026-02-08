import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  Loader2,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Building2,
  ArrowUpDown,
  X,
  Zap,
  Skull,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useDiscoveryScan,
  type DiscoveredInvoice,
  type SupplierProfile,
  type NewSupplierAlert,
} from "@/hooks/useDiscoveryScan";
import { useGhostProcessor, type ProcessorResult } from "@/hooks/useGhostProcessor";
import { useToast } from "@/hooks/use-toast";

type SortKey = "confidence" | "received_at" | "sender_name" | "filename";
type FilterConfidence = "ALL" | "HIGH" | "MEDIUM" | "LOW";

function ConfidenceBadge({ score }: { score: "HIGH" | "MEDIUM" | "LOW" }) {
  switch (score) {
    case "HIGH":
      return (
        <Badge className="bg-siphon-connected/15 text-siphon-connected border-siphon-connected/30 font-mono text-[10px]">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          HIGH
        </Badge>
      );
    case "MEDIUM":
      return (
        <Badge className="bg-siphon-scanning/15 text-siphon-scanning border-siphon-scanning/30 font-mono text-[10px]">
          <AlertTriangle className="mr-1 h-3 w-3" />
          MEDIUM
        </Badge>
      );
    case "LOW":
      return (
        <Badge className="bg-muted text-muted-foreground border-border font-mono text-[10px]">
          LOW
        </Badge>
      );
  }
}

function CadenceBadge({ cadence }: { cadence: string }) {
  const colorMap: Record<string, string> = {
    WEEKLY: "text-siphon-connected",
    BI_WEEKLY: "text-siphon-connected",
    MONTHLY: "text-siphon-scanning",
    IRREGULAR: "text-muted-foreground",
    INSUFFICIENT_DATA: "text-muted-foreground",
  };

  return (
    <span className={cn("font-mono text-[10px] uppercase", colorMap[cadence] || "text-muted-foreground")}>
      {cadence.replace(/_/g, " ")}
    </span>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ExtractionResultBadge({ result }: { result: ProcessorResult }) {
  if (result.flagged) {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <Badge className="bg-siphon-scanning/15 text-siphon-scanning border-siphon-scanning/30 font-mono text-[10px]">
          <Skull className="mr-1 h-3 w-3" />
          FLAGGED
        </Badge>
        <span className="text-[9px] font-mono text-siphon-charcoal-muted">
          {result.extraction.confidence_percent}% conf
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <Badge className="bg-siphon-connected/15 text-siphon-connected border-siphon-connected/30 font-mono text-[10px]">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        £{result.amount_detected.toFixed(2)}
      </Badge>
      <span className="text-[9px] font-mono text-siphon-charcoal-muted">
        {result.extraction.supplier_name || "—"} · {result.extraction.confidence_percent}%
      </span>
    </div>
  );
}

export function DiscoveryView() {
  const { scanning, result, error, triggerDiscovery, clearResults } = useDiscoveryScan();
  const { processInvoice, isProcessing, getResult, getError, processingCount } = useGhostProcessor();
  const { toast } = useToast();
  const [filter, setFilter] = useState<FilterConfidence>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("confidence");
  const [sortAsc, setSortAsc] = useState(false);

  const handleScan = async () => {
    const res = await triggerDiscovery();
    if (res) {
      toast({
        title: "Discovery Complete",
        description: `${res.total_pdfs_found} PDFs classified across ${res.suppliers.length} supplier(s).`,
      });
    } else if (error) {
      toast({ title: "Discovery Failed", description: error, variant: "destructive" });
    }
  };

  const handleProcess = async (d: DiscoveredInvoice) => {
    // Extract attachment_id from the message_id context
    // Discovery scan stores message_id as the Graph message ID
    // We need to construct the dedup pattern
    const res = await processInvoice({
      message_id: d.message_id,
      attachment_id: d.message_id, // The discovery scan uses message_id for the attachment context
      sender: d.sender_address,
      subject: d.subject,
      filename: d.filename,
    });

    if (res) {
      if (res.flagged) {
        toast({
          title: "⚠️ Flagged for Human Audit",
          description: `Confidence: ${res.extraction.confidence_percent}%. ${res.extraction.extraction_notes}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "✅ Extraction Complete",
          description: `£${res.amount_detected.toFixed(2)} from ${res.extraction.supplier_name || d.sender_name} → Committed to $A$`,
        });
      }
    } else {
      const errMsg = getError(`${d.message_id}::${d.message_id}`);
      toast({
        title: "Extraction Failed",
        description: errMsg || "Unknown error",
        variant: "destructive",
      });
    }
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const getFilteredAndSorted = (): DiscoveredInvoice[] => {
    if (!result) return [];
    let items = result.discoveries;

    if (filter !== "ALL") {
      items = items.filter((d) => d.confidence === filter);
    }

    const confidenceRank = { HIGH: 3, MEDIUM: 2, LOW: 1 };

    items = [...items].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "confidence":
          cmp = confidenceRank[a.confidence] - confidenceRank[b.confidence];
          break;
        case "received_at":
          cmp = new Date(a.received_at).getTime() - new Date(b.received_at).getTime();
          break;
        case "sender_name":
          cmp = a.sender_name.localeCompare(b.sender_name);
          break;
        case "filename":
          cmp = a.filename.localeCompare(b.filename);
          break;
      }
      return sortAsc ? cmp : -cmp;
    });

    return items;
  };

  const filteredItems = getFilteredAndSorted();

  const getDedupKey = (d: DiscoveredInvoice) => `${d.message_id}::${d.message_id}`;

  return (
    <Card className="bg-siphon-charcoal border-siphon-charcoal-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-siphon-charcoal-foreground">
              <Search className="h-5 w-5 text-siphon-scanning" />
              Deep Discovery Scanner
            </CardTitle>
            <CardDescription className="text-siphon-charcoal-muted">
              30-day forensic inbox audit — Supplier Intelligence Layer
              {processingCount > 0 && (
                <span className="ml-2 text-siphon-connected animate-pulse">
                  · {processingCount} extraction(s) active
                </span>
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {result && (
              <Button
                onClick={clearResults}
                variant="outline"
                size="sm"
                className="border-siphon-charcoal-border text-siphon-charcoal-foreground hover:bg-siphon-charcoal-deep font-mono text-xs"
              >
                <X className="mr-1 h-3 w-3" />
                Clear
              </Button>
            )}
            <Button
              onClick={handleScan}
              disabled={scanning}
              className="bg-siphon-scanning hover:bg-siphon-scanning/90 text-siphon-charcoal-deep font-mono uppercase tracking-wider text-xs"
            >
              {scanning ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              {scanning ? "Scanning 30 Days…" : "Run Discovery"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Summary Strip */}
        {result && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <SummaryCell label="MESSAGES" value={result.messages_scanned} />
            <SummaryCell
              label="HIGH CONF"
              value={result.summary.high_confidence}
              className="text-siphon-connected"
            />
            <SummaryCell
              label="MEDIUM CONF"
              value={result.summary.medium_confidence}
              className="text-siphon-scanning"
            />
            <SummaryCell
              label="LOW CONF"
              value={result.summary.low_confidence}
              className="text-muted-foreground"
            />
            <SummaryCell
              label="ALREADY SIPHONED"
              value={result.summary.already_siphoned}
              className="text-siphon-charcoal-muted"
            />
          </div>
        )}

        {/* New Supplier Alerts */}
        {result && result.new_suppliers.length > 0 && (
          <div className="rounded-md border border-siphon-scanning/30 bg-siphon-scanning/5 p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs font-mono text-siphon-scanning font-bold">
              <Building2 className="h-4 w-4" />
              NEW SUPPLIERS DETECTED — REQUESTING ACCRUAL MAPPING
            </div>
            <div className="space-y-1">
              {result.new_suppliers.map((ns: NewSupplierAlert) => (
                <div
                  key={ns.domain}
                  className="flex items-center justify-between text-xs font-mono rounded bg-siphon-charcoal-deep px-2 py-1"
                >
                  <span className="text-siphon-charcoal-foreground">
                    @{ns.domain}{" "}
                    <span className="text-siphon-charcoal-muted">
                      ({ns.sender_names.slice(0, 2).join(", ")}
                      {ns.sender_names.length > 2 && ` +${ns.sender_names.length - 2}`})
                    </span>
                  </span>
                  <div className="flex items-center gap-3">
                    <span className="text-siphon-charcoal-muted">{ns.total_pdfs} PDF(s)</span>
                    <CadenceBadge cadence={ns.cadence} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Supplier Intelligence Map */}
        {result && result.suppliers.length > 0 && (
          <div className="rounded-md border border-siphon-charcoal-border bg-siphon-charcoal-deep p-3 space-y-2">
            <div className="text-xs font-mono text-siphon-charcoal-muted font-bold mb-2">
              SUPPLIER INTELLIGENCE MAP ({result.suppliers.length})
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
              {result.suppliers.map((sp: SupplierProfile) => (
                <div
                  key={sp.domain}
                  className="flex items-center justify-between text-xs font-mono px-2 py-1.5 rounded border border-siphon-charcoal-border"
                >
                  <div className="flex items-center gap-2">
                    {sp.is_known ? (
                      <CheckCircle2 className="h-3 w-3 text-siphon-connected flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="h-3 w-3 text-siphon-scanning flex-shrink-0" />
                    )}
                    <span className="text-siphon-charcoal-foreground truncate max-w-[160px]">
                      @{sp.domain}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <ConfidenceBadge score={sp.highest_confidence} />
                    <span className="text-siphon-charcoal-muted">{sp.total_pdfs}</span>
                    <CadenceBadge cadence={sp.cadence} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filter Tabs */}
        {result && result.discoveries.length > 0 && (
          <div className="flex gap-1">
            {(["ALL", "HIGH", "MEDIUM", "LOW"] as FilterConfidence[]).map((f) => (
              <Button
                key={f}
                variant="outline"
                size="sm"
                onClick={() => setFilter(f)}
                className={cn(
                  "font-mono text-[10px] uppercase tracking-wider border-siphon-charcoal-border",
                  filter === f
                    ? "bg-siphon-charcoal-deep text-siphon-charcoal-foreground"
                    : "text-siphon-charcoal-muted hover:bg-siphon-charcoal-deep"
                )}
              >
                {f} {f !== "ALL" && result && `(${result.summary[`${f.toLowerCase()}_confidence` as keyof typeof result.summary]})`}
              </Button>
            ))}
          </div>
        )}

        {/* Discovery Table */}
        {result && filteredItems.length > 0 && (
          <div className="rounded-md border border-siphon-charcoal-border overflow-auto max-h-[400px]">
            <Table>
              <TableHeader>
                <TableRow className="border-siphon-charcoal-border hover:bg-transparent">
                  <TableHead
                    className="text-siphon-charcoal-muted font-mono text-[10px] cursor-pointer"
                    onClick={() => toggleSort("confidence")}
                  >
                    <div className="flex items-center gap-1">
                      CONF <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </TableHead>
                  <TableHead
                    className="text-siphon-charcoal-muted font-mono text-[10px] cursor-pointer"
                    onClick={() => toggleSort("sender_name")}
                  >
                    <div className="flex items-center gap-1">
                      SOURCE <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </TableHead>
                  <TableHead className="text-siphon-charcoal-muted font-mono text-[10px]">
                    SUBJECT
                  </TableHead>
                  <TableHead
                    className="text-siphon-charcoal-muted font-mono text-[10px] cursor-pointer"
                    onClick={() => toggleSort("filename")}
                  >
                    <div className="flex items-center gap-1">
                      FILENAME <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </TableHead>
                  <TableHead className="text-siphon-charcoal-muted font-mono text-[10px]">
                    SIZE
                  </TableHead>
                  <TableHead
                    className="text-siphon-charcoal-muted font-mono text-[10px] cursor-pointer"
                    onClick={() => toggleSort("received_at")}
                  >
                    <div className="flex items-center gap-1">
                      RECEIVED <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </TableHead>
                  <TableHead className="text-siphon-charcoal-muted font-mono text-[10px]">
                    STATUS
                  </TableHead>
                  <TableHead className="text-siphon-charcoal-muted font-mono text-[10px]">
                    EXTRACT
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((d, i) => {
                  const dedupKey = getDedupKey(d);
                  const processing = isProcessing(dedupKey);
                  const procResult = getResult(dedupKey);
                  const procError = getError(dedupKey);

                  return (
                    <TableRow
                      key={`${d.message_id}-${i}`}
                      className={cn(
                        "border-siphon-charcoal-border hover:bg-siphon-charcoal-deep/50 transition-all duration-300",
                        processing && "bg-siphon-connected/5 animate-pulse"
                      )}
                    >
                      <TableCell>
                        <ConfidenceBadge score={d.confidence} />
                      </TableCell>
                      <TableCell className="text-xs font-mono text-siphon-charcoal-foreground">
                        <div className="max-w-[140px] truncate" title={d.sender_address}>
                          {d.sender_name}
                        </div>
                        <div className="text-[10px] text-siphon-charcoal-muted truncate max-w-[140px]">
                          @{d.sender_domain}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs font-mono text-siphon-charcoal-foreground max-w-[180px] truncate" title={d.subject}>
                        {d.subject}
                      </TableCell>
                      <TableCell className="text-xs font-mono text-siphon-charcoal-foreground">
                        <div className="flex items-center gap-1 max-w-[150px]">
                          <FileText className="h-3 w-3 text-siphon-charcoal-muted flex-shrink-0" />
                          <span className="truncate" title={d.filename}>{d.filename}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-[10px] font-mono text-siphon-charcoal-muted">
                        {formatFileSize(d.file_size)}
                      </TableCell>
                      <TableCell className="text-[10px] font-mono text-siphon-charcoal-muted whitespace-nowrap">
                        {formatDate(d.received_at)}
                      </TableCell>
                      <TableCell>
                        {d.is_already_siphoned ? (
                          <Badge className="bg-siphon-connected/10 text-siphon-connected border-siphon-connected/20 font-mono text-[10px]">
                            SIPHONED
                          </Badge>
                        ) : d.is_known_supplier ? (
                          <Badge className="bg-primary/10 text-primary border-primary/20 font-mono text-[10px]">
                            KNOWN
                          </Badge>
                        ) : (
                          <Badge className="bg-siphon-scanning/10 text-siphon-scanning border-siphon-scanning/20 font-mono text-[10px]">
                            NEW
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {procResult ? (
                          <ExtractionResultBadge result={procResult} />
                        ) : procError ? (
                          <Badge className="bg-destructive/10 text-destructive border-destructive/20 font-mono text-[10px]">
                            ERROR
                          </Badge>
                        ) : processing ? (
                          <div className="flex items-center gap-1">
                            <Loader2 className="h-3 w-3 animate-spin text-siphon-connected" />
                            <span className="text-[10px] font-mono text-siphon-connected">
                              EXTRACTING…
                            </span>
                          </div>
                        ) : (
                          <Button
                            onClick={() => handleProcess(d)}
                            disabled={d.is_already_siphoned}
                            size="sm"
                            className="h-6 px-2 bg-siphon-connected/15 hover:bg-siphon-connected/25 text-siphon-connected border border-siphon-connected/30 font-mono text-[10px] uppercase tracking-wider"
                            variant="outline"
                          >
                            <Zap className="mr-1 h-3 w-3" />
                            Process
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Empty state */}
        {!result && !scanning && (
          <div className="text-center py-8 text-siphon-charcoal-muted font-mono text-sm">
            <Search className="mx-auto h-8 w-8 mb-3 opacity-40" />
            <p>No discovery scan executed.</p>
            <p className="text-[10px] mt-1">
              Run a 30-day forensic audit to map all incoming PDF invoices.
            </p>
          </div>
        )}

        {/* Error state */}
        {error && !scanning && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs font-mono text-destructive">
            <AlertTriangle className="inline-block mr-1 h-3 w-3" />
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="text-[10px] text-siphon-charcoal-muted font-mono">
          PROTOCOL: Deep Discovery Scan · WINDOW: 30 Days · ENGINE: Confidence Classifier v1.0 + Ghost Processor v1.0
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryCell({
  label,
  value,
  className,
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div className="rounded border border-siphon-charcoal-border bg-siphon-charcoal-deep p-2 text-center">
      <div className="text-[10px] font-mono text-siphon-charcoal-muted">{label}</div>
      <div className={cn("text-lg font-bold font-mono text-siphon-charcoal-foreground", className)}>
        {value}
      </div>
    </div>
  );
}
