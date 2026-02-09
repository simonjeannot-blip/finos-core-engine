import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Ghost, RefreshCw, AlertCircle } from "lucide-react";
import { format } from "date-fns";

interface DiscoveredInvoice {
  id: string;
  sender_name: string;
  filename: string;
  confidence: string;
  received_at: string;
  sender_domain: string;
  subject: string;
  is_known_supplier: boolean;
}

export function GhostAuditTable() {
  const [invoices, setInvoices] = useState<DiscoveredInvoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastPoll, setLastPoll] = useState<Date | null>(null);
  const [triggeringeScan, setTriggeringScan] = useState(false);

  const fetchInvoices = async () => {
    try {
      const { data, error: fetchError } = await supabase
        .from("discovered_invoices")
        .select("id, sender_name, filename, confidence, received_at, sender_domain, subject, is_known_supplier")
        .order("received_at", { ascending: false });

      if (fetchError) throw fetchError;

      setInvoices(data || []);
      setLastPoll(new Date());
      setError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const triggerScan = async () => {
    setTriggeringScan(true);
    try {
      // Fire-and-forget — don't wait for completion
      supabase.functions.invoke("ghost-discovery-scan", {
        method: "POST",
        body: {},
      });
      // Start polling immediately
      setTimeout(fetchInvoices, 3000);
    } catch {
      // Scan trigger is best-effort
    } finally {
      setTimeout(() => setTriggeringScan(false), 5000);
    }
  };

  // Initial fetch + 5-second polling
  useEffect(() => {
    fetchInvoices();
    const interval = setInterval(fetchInvoices, 5000);
    return () => clearInterval(interval);
  }, []);

  const confidenceBadge = (confidence: string) => {
    switch (confidence) {
      case "HIGH":
        return <Badge className="bg-primary text-primary-foreground">HIGH</Badge>;
      case "MEDIUM":
        return <Badge className="bg-accent text-accent-foreground">MEDIUM</Badge>;
      default:
        return <Badge variant="secondary">LOW</Badge>;
    }
  };

  return (
    <Card className="border-primary/20 bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Ghost className="h-5 w-5 text-primary" />
            <CardTitle className="text-base font-semibold">
              Ghost Audit — Q1 Forensic Discovery
            </CardTitle>
            {invoices.length > 0 && (
              <Badge variant="outline" className="ml-2">
                {invoices.length} found
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {lastPoll && (
              <span className="text-xs text-muted-foreground">
                Polled: {format(lastPoll, "HH:mm:ss")}
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={triggerScan}
              disabled={triggeringeScan}
              className="gap-1"
            >
              <RefreshCw className={`h-3 w-3 ${triggeringeScan ? "animate-spin" : ""}`} />
              {triggeringeScan ? "Scanning..." : "Trigger Scan"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm mb-3">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {isLoading && invoices.length === 0 ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Ghost className="h-4 w-4 animate-pulse" />
              Polling Database for January Siphon...
            </div>
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : invoices.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
            <Ghost className="h-8 w-8 animate-pulse" />
            <p className="text-sm font-medium">Polling Database for January Siphon...</p>
            <p className="text-xs">No discovered invoices yet. Trigger a scan or wait for data.</p>
          </div>
        ) : (
          <div className="rounded-md border overflow-auto max-h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sender</TableHead>
                  <TableHead>Filename</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Domain</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium text-sm">
                      <div className="flex items-center gap-1">
                        {inv.sender_name}
                        {inv.is_known_supplier && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0">
                            KNOWN
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                      {inv.filename}
                    </TableCell>
                    <TableCell>{confidenceBadge(inv.confidence)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {format(new Date(inv.received_at), "dd MMM yyyy")}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {inv.sender_domain}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
