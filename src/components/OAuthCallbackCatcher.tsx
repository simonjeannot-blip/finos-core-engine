import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useSiphonStatus } from "@/hooks/useSiphonStatus";

/**
 * OAuthCallbackCatcher — Intercepts Microsoft OAuth redirects on the /admin page.
 *
 * When Microsoft redirects back to /admin?code=...&state=..., this component:
 * 1. Detects the `code` and `state` URL parameters
 * 2. Calls the edge function to exchange the code for tokens
 * 3. Cleans up URL parameters
 * 4. Shows success/error toast
 */
export function OAuthCallbackCatcher() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { exchangeTokens, exchanging, refresh } = useSiphonStatus();
  const handledRef = useRef(false);

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");

    // Handle Microsoft error response
    if (error) {
      toast({
        title: "Siphon Connection Failed",
        description: `Microsoft OAuth error: ${errorDescription || error}`,
        variant: "destructive",
      });

      // Clean URL
      const cleaned = new URLSearchParams(searchParams);
      cleaned.delete("error");
      cleaned.delete("error_description");
      cleaned.delete("state");
      setSearchParams(cleaned, { replace: true });
      return;
    }

    // Handle legacy ?siphon= params (backward compatibility)
    const siphonResult = searchParams.get("siphon");
    if (siphonResult === "connected") {
      toast({
        title: "Siphon Connected",
        description: "Master Inbox handshake complete. The Ghost is now siphoning.",
      });
      refresh();
      const cleaned = new URLSearchParams(searchParams);
      cleaned.delete("siphon");
      setSearchParams(cleaned, { replace: true });
      return;
    } else if (siphonResult === "error") {
      const reason = searchParams.get("reason") || "Unknown error";
      toast({
        title: "Siphon Connection Failed",
        description: `OAuth handshake failed: ${reason}`,
        variant: "destructive",
      });
      const cleaned = new URLSearchParams(searchParams);
      cleaned.delete("siphon");
      cleaned.delete("reason");
      setSearchParams(cleaned, { replace: true });
      return;
    }

    // Handle OAuth code+state — the main v3 flow
    if (code && state && !handledRef.current) {
      handledRef.current = true;

      console.log("[Siphon] 🎯 OAuth callback detected on frontend — initiating token exchange");

      // Clean URL immediately so refresh doesn't re-trigger
      const cleaned = new URLSearchParams(searchParams);
      cleaned.delete("code");
      cleaned.delete("state");
      cleaned.delete("session_state");
      setSearchParams(cleaned, { replace: true });

      // Fire the exchange
      exchangeTokens(code, state).then((result) => {
        if (result.success) {
          toast({
            title: "Siphon Connected",
            description: "Master Inbox handshake complete via frontend bridge. The Ghost is now siphoning.",
          });
        } else {
          toast({
            title: "Siphon Connection Failed",
            description: `Token exchange failed: ${result.error}`,
            variant: "destructive",
          });
        }
      });
    }
  }, [searchParams, setSearchParams, toast, exchangeTokens, refresh]);

  // Show a processing indicator while exchanging
  if (exchanging) {
    return (
      <div className="rounded-md border border-siphon-connected/30 bg-siphon-connected/5 p-4 flex items-center gap-3">
        <div className="h-4 w-4 rounded-full bg-siphon-connected animate-pulse" />
        <div className="text-sm font-mono text-siphon-connected">
          EXCHANGING TOKENS — Finalizing Ghost Siphon handshake…
        </div>
      </div>
    );
  }

  return null;
}
