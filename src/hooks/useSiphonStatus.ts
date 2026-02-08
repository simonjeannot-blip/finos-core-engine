import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type SiphonConnectionState = "disconnected" | "connected" | "expiring" | "error";

interface SiphonStatus {
  state: SiphonConnectionState;
  expiresAt: Date | null;
  updatedAt: Date | null;
  loading: boolean;
}

export function useSiphonStatus() {
  const { user } = useAuth();
  const [status, setStatus] = useState<SiphonStatus>({
    state: "disconnected",
    expiresAt: null,
    updatedAt: null,
    loading: true,
  });

  const checkStatus = useCallback(async () => {
    if (!user) {
      setStatus({ state: "disconnected", expiresAt: null, updatedAt: null, loading: false });
      return;
    }

    try {
      // Query token record — RLS restricts to super_admins only
      const { data, error } = await (supabase
        .from("microsoft_oauth_tokens" as any)
        .select("id, expires_at, updated_at, user_id")
        .limit(1)
        .maybeSingle() as any);

      if (error) {
        // RLS denial or table not accessible = disconnected state
        console.log("[Siphon] Token check: no access or no records");
        setStatus({ state: "disconnected", expiresAt: null, updatedAt: null, loading: false });
        return;
      }

      if (!data) {
        setStatus({ state: "disconnected", expiresAt: null, updatedAt: null, loading: false });
        return;
      }

      const expiresAt = new Date(data.expires_at);
      const now = new Date();
      const updatedAt = data.updated_at ? new Date(data.updated_at) : null;

      // Token expired → re-auth required
      if (expiresAt <= now) {
        setStatus({ state: "error", expiresAt, updatedAt, loading: false });
        return;
      }

      // Token expiring within 10 minutes → amber warning
      const tenMinutes = 10 * 60 * 1000;
      if (expiresAt.getTime() - now.getTime() < tenMinutes) {
        setStatus({ state: "expiring", expiresAt, updatedAt, loading: false });
        return;
      }

      // Token valid → connected
      setStatus({ state: "connected", expiresAt, updatedAt, loading: false });
    } catch (err) {
      console.error("[Siphon] Status check error:", err);
      setStatus({ state: "error", expiresAt: null, updatedAt: null, loading: false });
    }
  }, [user]);

  useEffect(() => {
    checkStatus();
    // Poll every 60s
    const interval = setInterval(checkStatus, 60_000);
    return () => clearInterval(interval);
  }, [checkStatus]);

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
        // Open Microsoft OAuth in current window
        window.location.href = data.auth_url;
      }
    } catch (err) {
      console.error("[Siphon] Connection initiation failed:", err);
    }
  }, [user]);

  return {
    ...status,
    initiateConnection,
    refresh: checkStatus,
  };
}
