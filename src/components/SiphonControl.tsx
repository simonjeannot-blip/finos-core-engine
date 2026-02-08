import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Mail, Plug, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSiphonStatus } from "@/hooks/useSiphonStatus";
import { useToast } from "@/hooks/use-toast";

export function SiphonControl() {
  const { state, expiresAt, updatedAt, loading, initiateConnection, refresh } = useSiphonStatus();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // Handle OAuth callback redirects
  useEffect(() => {
    const siphonResult = searchParams.get("siphon");
    if (siphonResult === "connected") {
      toast({
        title: "Siphon Connected",
        description: "Master Inbox handshake complete. The Ghost is now siphoning.",
      });
      refresh();
      // Clean URL
      searchParams.delete("siphon");
      setSearchParams(searchParams, { replace: true });
    } else if (siphonResult === "error") {
      const reason = searchParams.get("reason") || "Unknown error";
      toast({
        title: "Siphon Connection Failed",
        description: `OAuth handshake failed: ${reason}`,
        variant: "destructive",
      });
      searchParams.delete("siphon");
      searchParams.delete("reason");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, toast, refresh]);

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
            <Button
              onClick={initiateConnection}
              variant="outline"
              disabled={loading}
              className="border-siphon-charcoal-border text-siphon-charcoal-foreground hover:bg-siphon-charcoal-deep font-mono uppercase tracking-wider text-xs"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh Token
            </Button>
          )}
        </div>

        {/* Scope Information */}
        <div className="text-xs text-siphon-charcoal-muted font-mono space-y-1">
          <p>SCOPES: offline_access · Mail.Read · Mail.ReadBasic</p>
          <p>PROTOCOL: OAuth 2.0 Authorization Code Flow</p>
        </div>
      </CardContent>
    </Card>
  );
}
