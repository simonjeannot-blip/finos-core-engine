import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type SiphonConnectionState = "disconnected" | "connected" | "expiring" | "error";

interface SiphonStatus {
  state: SiphonConnectionState;
  expiresAt: Date | null;
  updatedAt: Date | null;
  tenantId: string | null;
  loading: boolean;
}

export function useSiphonStatus() {
  const { user } = useAuth();
  const [status, setStatus] = useState<SiphonStatus>({
    state: "disconnected",
    expiresAt: null,
    updatedAt: null,
    tenantId: null,
    loading: true,
  });
  const [exchanging, setExchanging] = useState(false);

  const checkStatus = useCallback(async () => {
    if (!user) {
      setStatus({ state: "disconnected", expiresAt: null, updatedAt: null, tenantId: null, loading: false });
      return;
    }

    try {
      const { data, error } = await (supabase
        .from("microsoft_oauth_tokens" as any)
        .select("id, expires_at, updated_at, user_id, tenant_id")
        .limit(1)
        .maybeSingle() as any);

      if (error) {
        console.log("[Siphon] Token check: no access or no records");
        setStatus({ state: "disconnected", expiresAt: null, updatedAt: null, tenantId: null, loading: false });
        return;
      }

      if (!data) {
        setStatus({ state: "disconnected", expiresAt: null, updatedAt: null, tenantId: null, loading: false });
        return;
      }

      const expiresAt = new Date(data.expires_at);
      const now = new Date();
      const updatedAt = data.updated_at ? new Date(data.updated_at) : null;
      const tenantId = data.tenant_id || null;

      if (expiresAt <= now) {
        setStatus({ state: "error", expiresAt, updatedAt, tenantId, loading: false });
        return;
      }

      const tenMinutes = 10 * 60 * 1000;
      if (expiresAt.getTime() - now.getTime() < tenMinutes) {
        setStatus({ state: "expiring", expiresAt, updatedAt, tenantId, loading: false });
        return;
      }

      setStatus({ state: "connected", expiresAt, updatedAt, tenantId, loading: false });
    } catch (err) {
      console.error("[Siphon] Status check error:", err);
      setStatus({ state: "error", expiresAt: null, updatedAt: null, tenantId: null, loading: false });
    }
  }, [user]);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 60_000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  // ═══════════════════════════════════════════════════════════
  // INITIATE CONNECTION — Generate auth URL, redirect browser
  // ═══════════════════════════════════════════════════════════
  const initiateConnection = useCallback(async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase.functions.invoke("microsoft-callback", {
        method: "POST",
        body: { app_url: window.location.origin },
      });

      if (error) {
        console.error("[Siphon] Failed to get auth URL:", error);
        return;
      }

      if (data?.auth_url) {
        console.log("[Siphon] Redirecting to Microsoft OAuth...");
        console.log("[Siphon] Redirect URI registered:", data.redirect_uri);
        window.location.href = data.auth_url;
      }
    } catch (err) {
      console.error("[Siphon] Connection initiation failed:", err);
    }
  }, [user]);

  // ═══════════════════════════════════════════════════════════
  // EXCHANGE TOKENS — Session-injected token exchange
  //
  // Called by OAuthCallbackCatcher AFTER session restoration.
  // Explicitly fetches the current session token and passes it
  // as a manual Authorization header to guarantee the edge
  // function receives a valid JWT even immediately after redirect.
  // ═══════════════════════════════════════════════════════════
  const exchangeTokens = useCallback(async (code: string, state: string): Promise<{ success: boolean; error?: string }> => {
    setExchanging(true);
    try {
      // Step 1: Get fresh session — force refresh if needed
      let { data: { session } } = await supabase.auth.getSession();

      if (!session?.access_token) {
        console.log("[Siphon] ⚡ No session found — attempting forced refresh...");
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshError || !refreshData.session) {
          console.error("[Siphon] ❌ Session refresh failed:", refreshError?.message);
          return { success: false, error: "Session expired. Please log in and reconnect." };
        }
        session = refreshData.session;
        console.log("[Siphon] ✅ Session refreshed successfully");
      }

      console.log("[Siphon] 🔄 Exchanging OAuth code with explicit Bearer token...");

      // Step 2: Call edge function with explicit auth header
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/microsoft-callback`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
            "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ code, state }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        console.error("[Siphon] ❌ Token exchange HTTP error:", response.status, data);
        return { success: false, error: data?.message || `HTTP ${response.status}` };
      }

      if (data?.success) {
        console.log("[Siphon] ✅ Token exchange complete — Ghost Siphon connected");
        await checkStatus(); // Refresh status to show green
        return { success: true };
      }

      return { success: false, error: data?.message || "Unknown error" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Siphon] Exchange error:", msg);
      return { success: false, error: msg };
    } finally {
      setExchanging(false);
    }
  }, [checkStatus]);

  return {
    ...status,
    exchanging,
    initiateConnection,
    exchangeTokens,
    refresh: checkStatus,
  };
}
