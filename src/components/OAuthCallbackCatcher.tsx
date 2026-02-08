import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { useSiphonStatus } from "@/hooks/useSiphonStatus";
import { supabase } from "@/integrations/supabase/client";

/**
 * OAuthCallbackCatcher — Intercepts Microsoft OAuth redirects on the /admin page.
 *
 * ARCHITECTURE (v3.1 — Session-Aware):
 *   After Microsoft redirects back to /admin?code=&state=, this component:
 *   1. Detects code+state in URL params
 *   2. WAITS for Supabase to restore the user session (up to 10s)
 *   3. Calls the edge function with an explicit Bearer token
 *   4. Cleans URL params and shows result toast
 */
export function OAuthCallbackCatcher() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { exchangeTokens, exchanging, refresh } = useSiphonStatus();
  const handledRef = useRef(false);
  const [waitingForSession, setWaitingForSession] = useState(false);

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

    // ═══════════════════════════════════════════════════════════
    // MAIN v3.1 FLOW — Session-Aware Token Exchange
    // ═══════════════════════════════════════════════════════════
    if (code && state && !handledRef.current) {
      handledRef.current = true;

      console.log("[Siphon] 🎯 OAuth callback detected — waiting for session restoration...");

      // Clean URL immediately so refresh doesn't re-trigger
      const cleaned = new URLSearchParams(searchParams);
      cleaned.delete("code");
      cleaned.delete("state");
      cleaned.delete("session_state");
      setSearchParams(cleaned, { replace: true });

      // Wait for session then exchange
      setWaitingForSession(true);
      waitForSessionThenExchange(code, state);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run once on mount — code+state only appear on redirect

  /**
   * Polls for a valid Supabase session before firing the token exchange.
   * After a full-page redirect from Microsoft, the Supabase client needs
   * time to restore the session from localStorage/cookies.
   */
  const waitForSessionThenExchange = async (code: string, state: string) => {
    const MAX_ATTEMPTS = 20; // 20 × 500ms = 10 seconds max wait
    const INTERVAL_MS = 500;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      console.log(`[Siphon] ⏳ Session check attempt ${attempt}/${MAX_ATTEMPTS}...`);

      const { data: { session } } = await supabase.auth.getSession();

      if (session?.access_token) {
        console.log(`[Siphon] ✅ Session restored after ${attempt} attempts — firing exchange`);
        setWaitingForSession(false);

        const result = await exchangeTokens(code, state);

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
        return;
      }

      // Wait before next attempt
      await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
    }

    // Session never restored — fatal
    setWaitingForSession(false);
    console.error("[Siphon] ❌ Session restoration timed out after 10 seconds");
    toast({
      title: "Siphon Connection Failed",
      description: "Session expired during OAuth redirect. Please log in and try again.",
      variant: "destructive",
    });
  };

  // Show processing indicator
  if (waitingForSession) {
    return (
      <div className="rounded-md border border-siphon-connected/30 bg-siphon-connected/5 p-4 flex items-center gap-3">
        <div className="h-4 w-4 rounded-full bg-siphon-connected animate-pulse" />
        <div className="text-sm font-mono text-siphon-connected">
          RESTORING SESSION — Waiting for authentication…
        </div>
      </div>
    );
  }

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
