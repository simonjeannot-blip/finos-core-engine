import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mail, Plug, RefreshCw, AlertTriangle, CheckCircle2, Scan, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSiphonStatus } from "@/hooks/useSiphonStatus";
import { useSiphonScanner } from "@/hooks/useSiphonScanner";
import { useToast } from "@/hooks/use-toast";

export function SiphonControl() {
  const { state, expiresAt, updatedAt, tenantId, loading, initiateConnection, refresh } = useSiphonStatus();
  const { scanning, lastScan, lastScanTime, error: scanError, todayCount, todayCountLoading, triggerScan, fetchTodayCount } = useSiphonScanner();
  const { toast } = useToast();

  // Load today's count on mount
  useEffect(() => {
    fetchTodayCount();
  }, [fetchTodayCount]);

  const handleScan = async () => {
    const result = await triggerScan();
    if (result) {
      toast({
        title: "Scan Complete",
        description: `${result.new_invoices} new invoice(s) siphoned. ${result.duplicates_skipped} duplicates skipped.`,
      });
      refresh(); // Refresh token status after scan
    } else if (scanError) {
      toast({
        title: "Scan Failed",
        description: scanError,
        variant: "destructive",
      });
    }
  };

  const getStatusBadge = () => {
    switch (state) {
      case "connected":
        return (
          <Badge className="bg-siphon-connected/15 text-siphon-connected border-siphon-connected/30 font-mono text-xs">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            SIPHONING
          </Badge>
        );
      case "expiring":
        return (
          <Badge className="bg-siphon-scanning/15 text-siphon-scanning border-siphon-scanning/30 font-mono text-xs">
            <AlertTriangle className="mr-1 h-3 w-3" />
            TOKEN EXPIRING
          </Badge>
        );
      case "error":
        return (
          <Badge variant="destructive" className="font-mono text-xs">
            <AlertTriangle className="mr-1 h-3 w-3" />
            RE-AUTH REQUIRED
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
            DISCONNECTED
          </Badge>
        );
    }
  };

  const formatTimestamp = (date: Date | null): string => {
    if (!date) return "—";
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <Card className="bg-siphon-charcoal border-siphon-charcoal-border">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-siphon-charcoal-foreground">
              <Mail className="h-5 w-5 text-siphon-connected" />
              Ghost Siphon — Inbox Control
            </CardTitle>
            <CardDescription className="text-siphon-charcoal-muted">
              Microsoft Outlook integration for automated invoice extraction
            </CardDescription>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Connection Status Details */}
        {state !== "disconnected" && (
          <div className="rounded-md border border-siphon-charcoal-border bg-siphon-charcoal-deep p-3 space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-siphon-charcoal-muted">STATUS</span>
              <span className={cn(
                state === "connected" && "text-siphon-connected",
                state === "expiring" && "text-siphon-scanning",
                state === "error" && "text-destructive",
              )}>
                {state.toUpperCase()}
              </span>
            </div>
            {tenantId && (
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-siphon-charcoal-muted">TENANT</span>
                <span className="text-siphon-charcoal-foreground tracking-tight">
                  {tenantId.slice(0, 8)}…{tenantId.slice(-4)}
                </span>
              </div>
            )}
            {expiresAt && (
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-siphon-charcoal-muted">TOKEN EXPIRES</span>
                <span className="text-siphon-charcoal-foreground">
                  {expiresAt.toLocaleString()}
                </span>
              </div>
            )}
            {updatedAt && (
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-siphon-charcoal-muted">LAST SYNC</span>
                <span className="text-siphon-charcoal-foreground">
                  {updatedAt.toLocaleString()}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Scanner Status Panel */}
        {state === "connected" && (
          <div className="rounded-md border border-siphon-connected/20 bg-siphon-connected/5 p-3 space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-siphon-charcoal-muted">LAST SCANNED</span>
              <span className="text-siphon-charcoal-foreground">
                {formatTimestamp(lastScanTime)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-siphon-charcoal-muted">SIPHONED TODAY</span>
              <span className="text-siphon-connected font-bold">
                {todayCountLoading ? "…" : todayCount}
              </span>
            </div>
            {lastScan && (
              <>
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-siphon-charcoal-muted">MESSAGES SCANNED</span>
                  <span className="text-siphon-charcoal-foreground">
                    {lastScan.messages_scanned}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-siphon-charcoal-muted">NEW / DUPES</span>
                  <span className="text-siphon-charcoal-foreground">
                    {lastScan.new_invoices} / {lastScan.duplicates_skipped}
                  </span>
                </div>
              </>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          {state === "disconnected" || state === "error" ? (
            <Button
              onClick={initiateConnection}
              disabled={loading}
              className="bg-siphon-connected hover:bg-siphon-connected/90 text-siphon-connected-foreground font-mono uppercase tracking-wider text-xs"
            >
              <Plug className="mr-2 h-4 w-4" />
              {state === "error" ? "Re-authenticate" : "Connect Master Inbox"}
            </Button>
          ) : (
            <>
              <Button
                onClick={handleScan}
                disabled={scanning}
                className="bg-siphon-connected hover:bg-siphon-connected/90 text-siphon-connected-foreground font-mono uppercase tracking-wider text-xs"
              >
                {scanning ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Scan className="mr-2 h-4 w-4" />
                )}
                {scanning ? "Scanning…" : "Scan Inbox"}
              </Button>
              <Button
                onClick={initiateConnection}
                variant="outline"
                disabled={loading}
                className="border-siphon-charcoal-border text-siphon-charcoal-foreground hover:bg-siphon-charcoal-deep font-mono uppercase tracking-wider text-xs"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh Token
              </Button>
            </>
          )}
        </div>

        {/* Scope Information */}
        <div className="text-xs text-siphon-charcoal-muted font-mono space-y-1">
          <p>SCOPES: openid · offline_access · Mail.Read · Mail.ReadBasic</p>
          <p>PROTOCOL: OAuth 2.0 Authorization Code Flow</p>
          <p>TENANT: /common/ (Multi-Tenant Identity Bridge)</p>
        </div>
      </CardContent>
    </Card>
  );
}
