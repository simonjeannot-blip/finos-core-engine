/**
 * Sovereign Handshake — Background Sync to Financial OS
 * 
 * Fires a non-blocking POST to the universal-booking-intake endpoint
 * after a booking is successfully saved locally. If the endpoint is
 * unavailable (404 during propagation, network error, etc.), the
 * error is logged silently — the user's confirmation is never blocked.
 */

const INTAKE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/universal-booking-intake`;
const INTAKE_KEY = "FF_INTAKE_001_SECURE";
const HANDSHAKE_TIMEOUT_MS = 15000; // 15s — background, don't hold the user

export interface BookingHandshakePayload {
  booking_id: string;
  guest_name: string;
  guest_email: string | null;
  guest_phone?: string | null;
  party_size: number;
  reservation_time: string;
  attribution_id: string | null;
  metadata?: Record<string, unknown>;
}

export interface HandshakeResult {
  success: boolean;
  status?: string;
  message?: string;
  error?: string;
}

/**
 * Retrieve the attribution_id captured from an ad-click.
 * Checks sessionStorage first, then localStorage.
 */
export function getAttributionId(): string | null {
  try {
    // Check session first (current visit from ad click)
    const sessionAid = sessionStorage.getItem("attribution_id") 
      || sessionStorage.getItem("aid");
    if (sessionAid) return sessionAid;

    // Fall back to persistent storage (cross-session attribution)
    const localAid = localStorage.getItem("attribution_id")
      || localStorage.getItem("aid");
    if (localAid) return localAid;

    // Check URL params as last resort (landing page)
    const urlParams = new URLSearchParams(window.location.search);
    const urlAid = urlParams.get("aid") || urlParams.get("attribution_id");
    if (urlAid) {
      // Persist for future use
      sessionStorage.setItem("attribution_id", urlAid);
      return urlAid;
    }

    return null;
  } catch {
    // Storage access can fail in private browsing
    return null;
  }
}

/**
 * Fire the Sovereign Handshake — non-blocking background sync.
 * 
 * RESILIENCE RULES:
 * - Wrapped in try/catch: NEVER throws to the caller
 * - 15s timeout: don't hold the user waiting
 * - Logs errors internally for diagnostics
 * - Returns result for optional UI feedback
 */
export async function sovereignHandshake(
  payload: BookingHandshakePayload
): Promise<HandshakeResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HANDSHAKE_TIMEOUT_MS);

  try {
    const url = `${INTAKE_URL}?key=${INTAKE_KEY}&source=MO_MANGIO_BOOKING`;

    console.log("[Sovereign Handshake] Firing →", url);
    console.log("[Sovereign Handshake] Payload:", {
      booking_id: payload.booking_id,
      guest_name: payload.guest_name,
      party_size: payload.party_size,
      attribution_id: payload.attribution_id,
    });

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Handle non-JSON responses (HTML error pages, 404 propagation)
    const contentType = response.headers.get("content-type");
    if (!contentType?.includes("application/json")) {
      const textPreview = await response.text();
      console.warn(
        `[Sovereign Handshake] Non-JSON response (${response.status}):`,
        textPreview.substring(0, 200)
      );
      return {
        success: false,
        status: "NON_JSON_RESPONSE",
        error: `HTTP ${response.status}: Expected JSON, got ${contentType}`,
      };
    }

    const result = await response.json();

    if (result.success) {
      console.log(
        `[Sovereign Handshake] ✅ Synced: ${result.booking_id || payload.booking_id}`,
        result.attribution_linked ? "🔗 Attribution linked" : ""
      );
    } else {
      console.warn(
        `[Sovereign Handshake] ⚠️ Partial: ${result.status || "UNKNOWN"}`,
        result.message
      );
    }

    return {
      success: result.success ?? false,
      status: result.status,
      message: result.message,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      console.warn("[Sovereign Handshake] ⏱ Timeout after 15s — will retry later");
      return { success: false, status: "TIMEOUT", error: "Handshake timed out" };
    }

    if (error instanceof TypeError && error.message.includes("Failed to fetch")) {
      console.warn("[Sovereign Handshake] 📡 Network error — endpoint may be propagating");
      return { success: false, status: "NETWORK_ERROR", error: "Endpoint unreachable" };
    }

    console.error("[Sovereign Handshake] ❌ Unexpected error:", error);
    return {
      success: false,
      status: "UNKNOWN_ERROR",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
