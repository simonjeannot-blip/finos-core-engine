/**
 * Online Status Detection Hook
 * 
 * Monitors both browser connectivity and Supabase reachability.
 * Triggers fallback to cached data when the backend is unavailable.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface OnlineStatus {
  isOnline: boolean;
  isSupabaseReachable: boolean;
  lastHeartbeat: Date | null;
  latencyMs: number | null;
  checkNow: () => Promise<void>;
}

const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const HEARTBEAT_TIMEOUT = 10000; // 10 seconds

export function useOnlineStatus(): OnlineStatus {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSupabaseReachable, setIsSupabaseReachable] = useState(true);
  const [lastHeartbeat, setLastHeartbeat] = useState<Date | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  /**
   * Perform a heartbeat check to Supabase
   */
  const checkSupabaseHeartbeat = useCallback(async () => {
    if (!navigator.onLine) {
      if (isMountedRef.current) {
        setIsSupabaseReachable(false);
      }
      return;
    }

    const startTime = performance.now();
    
    try {
      // Use a simple query to test connectivity
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT);

      // Query app_settings as a lightweight health check
      const { error } = await supabase
        .from("app_settings")
        .select("id")
        .limit(1)
        .single();

      clearTimeout(timeoutId);

      const endTime = performance.now();
      const latency = Math.round(endTime - startTime);

      if (isMountedRef.current) {
        // PGRST116 (no rows) is still a successful connection
        const isReachable = !error || error.code === "PGRST116";
        setIsSupabaseReachable(isReachable);
        setLastHeartbeat(new Date());
        setLatencyMs(latency);

        if (isReachable) {
          console.log(`[Heartbeat] ✓ Supabase reachable (${latency}ms)`);
        } else {
          console.warn(`[Heartbeat] ✗ Supabase error:`, error);
        }
      }
    } catch (error) {
      if (isMountedRef.current) {
        setIsSupabaseReachable(false);
        console.warn("[Heartbeat] ✗ Supabase unreachable:", error);
      }
    }
  }, []);

  // Browser online/offline events
  useEffect(() => {
    const handleOnline = () => {
      console.log("[Network] Browser is online");
      setIsOnline(true);
      // Immediately check Supabase when coming back online
      checkSupabaseHeartbeat();
    };

    const handleOffline = () => {
      console.log("[Network] Browser is offline");
      setIsOnline(false);
      setIsSupabaseReachable(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [checkSupabaseHeartbeat]);

  // Periodic heartbeat
  useEffect(() => {
    isMountedRef.current = true;

    // Initial check
    checkSupabaseHeartbeat();

    // Set up interval
    heartbeatIntervalRef.current = setInterval(checkSupabaseHeartbeat, HEARTBEAT_INTERVAL);

    return () => {
      isMountedRef.current = false;
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
    };
  }, [checkSupabaseHeartbeat]);

  return {
    isOnline,
    isSupabaseReachable,
    lastHeartbeat,
    latencyMs,
    checkNow: checkSupabaseHeartbeat,
  };
}
