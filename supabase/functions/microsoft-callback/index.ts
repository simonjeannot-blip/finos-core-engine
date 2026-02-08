import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ═══════════════════════════════════════════════════════════════
// THE GHOST SIPHON — Microsoft OAuth Callback Engine v1.0
//
// ARCHITECTURE: Dual-Mode Handler
//   POST → Generate Microsoft OAuth authorization URL
//   GET  → Exchange authorization code for tokens & store
//
// SCOPES: offline_access, Mail.Read, Mail.ReadBasic
// TENANT: common (multi-tenant)
// ═══════════════════════════════════════════════════════════════

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const MICROSOFT_TENANT = "common";
const MICROSOFT_AUTH_URL = `https://login.microsoftonline.com/${MICROSOFT_TENANT}/oauth2/v2.0/authorize`;
const MICROSOFT_TOKEN_URL = `https://login.microsoftonline.com/${MICROSOFT_TENANT}/oauth2/v2.0/token`;
const SCOPES = "offline_access Mail.Read Mail.ReadBasic";

// Redirect URI = this function's own URL
function getRedirectUri(): string {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  return `${supabaseUrl}/functions/v1/microsoft-callback`;
}

// ═══════════════════════════════════════════════════════════════
// STATE ENCODING — Carries user_id + app_url through OAuth flow
// ═══════════════════════════════════════════════════════════════
function encodeState(userId: string, appUrl: string): string {
  const payload = JSON.stringify({ user_id: userId, app_url: appUrl });
  return btoa(payload);
}

function decodeState(state: string): { user_id: string; app_url: string } {
  try {
    const payload = JSON.parse(atob(state));
    return {
      user_id: payload.user_id || "",
      app_url: payload.app_url || "",
    };
  } catch {
    throw new Error("STATE_DECODE_FAILED: Invalid state parameter");
  }
}

// ═══════════════════════════════════════════════════════════════
// TOKEN EXCHANGE — Authorization Code → Access + Refresh Tokens
// ═══════════════════════════════════════════════════════════════
interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!;
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!;
  const redirectUri = getRedirectUri();

  console.log("[Siphon] 🔑 Exchanging authorization code for tokens...");

  const response = await fetch(MICROSOFT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: SCOPES,
    }),
  });

  const body = await response.text();

  if (!response.ok) {
    console.error("[Siphon] ❌ Token exchange failed:", body);
    throw new Error(`TOKEN_EXCHANGE_FAILED: ${response.status} — ${body}`);
  }

  const tokenData = JSON.parse(body) as TokenResponse;
  console.log("[Siphon] ✅ Tokens acquired. Expires in:", tokenData.expires_in, "seconds");
  return tokenData;
}

// ═══════════════════════════════════════════════════════════════
// TOKEN STORAGE — Upsert into microsoft_oauth_tokens vault
// ═══════════════════════════════════════════════════════════════
async function storeTokens(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  tokens: TokenResponse
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  console.log(`[Siphon] 💾 Storing tokens for user ${userId.slice(0, 8)}...`);

  const { error } = await supabase
    .from("microsoft_oauth_tokens")
    .upsert(
      {
        user_id: userId,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
        scopes: tokens.scope || SCOPES,
      },
      { onConflict: "user_id" }
    );

  if (error) {
    console.error("[Siphon] ❌ Token storage failed:", error.message);
    throw new Error(`TOKEN_STORAGE_FAILED: ${error.message}`);
  }

  console.log("[Siphon] ✅ Tokens stored successfully");
}

// ═══════════════════════════════════════════════════════════════
// AUDIT LOG — Record sync events
// ═══════════════════════════════════════════════════════════════
async function logAuditEvent(
  supabase: ReturnType<typeof createClient>,
  actionType: string,
  context: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from("system_audit_log").insert({
      table_name: "microsoft_oauth_tokens",
      record_id: "00000000-0000-0000-0000-000000000000",
      action_type: actionType,
      old_data_hash: null,
      new_data_hash: JSON.stringify({
        ...context,
        timestamp: new Date().toISOString(),
        source: "GHOST_SIPHON",
      }),
      changed_by: null,
    });
    console.log(`[Siphon] 📝 ${actionType} logged to audit trail`);
  } catch (err) {
    console.error("[Siphon] ⚠️ Audit log write failed:", err);
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // ═══════════════════════════════════════════════════════════
  // MODE 1: POST — Generate OAuth Authorization URL
  // Requires authenticated user (auth header)
  // ═══════════════════════════════════════════════════════════
  if (req.method === "POST") {
    console.log("[Siphon] 🔗 POST — Generating OAuth authorization URL");

    try {
      // Validate auth
      const authHeader = req.headers.get("authorization");
      if (!authHeader) {
        return new Response(
          JSON.stringify({ error: "AUTH_REQUIRED", message: "Missing authorization header" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Extract user from JWT
      const supabaseAuth = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();

      if (authError || !user) {
        console.error("[Siphon] ❌ Auth validation failed:", authError?.message);
        return new Response(
          JSON.stringify({ error: "AUTH_FAILED", message: "Invalid authentication" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Parse body for app_url
      let appUrl = "";
      try {
        const body = await req.json();
        appUrl = body.app_url || "";
      } catch {
        appUrl = "";
      }

      const clientId = Deno.env.get("MICROSOFT_CLIENT_ID");
      if (!clientId) {
        return new Response(
          JSON.stringify({ error: "CONFIG_ERROR", message: "MICROSOFT_CLIENT_ID not configured" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const redirectUri = getRedirectUri();
      const state = encodeState(user.id, appUrl);

      const authorizationUrl = new URL(MICROSOFT_AUTH_URL);
      authorizationUrl.searchParams.set("client_id", clientId);
      authorizationUrl.searchParams.set("response_type", "code");
      authorizationUrl.searchParams.set("redirect_uri", redirectUri);
      authorizationUrl.searchParams.set("scope", SCOPES);
      authorizationUrl.searchParams.set("state", state);
      authorizationUrl.searchParams.set("response_mode", "query");
      authorizationUrl.searchParams.set("prompt", "consent");

      console.log(`[Siphon] ✅ Auth URL generated for user ${user.id.slice(0, 8)}...`);
      console.log(`[Siphon] 🔗 Redirect URI: ${redirectUri}`);

      return new Response(
        JSON.stringify({ auth_url: authorizationUrl.toString() }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Siphon] ❌ POST handler error: ${errMsg}`);
      await logAuditEvent(supabase, "ENDPOINT_FAILURE", { phase: "AUTH_URL_GENERATION", error: errMsg });
      return new Response(
        JSON.stringify({ error: "INTERNAL_ERROR", message: errMsg }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // ═══════════════════════════════════════════════════════════
  // MODE 2: GET — Handle Microsoft OAuth Callback
  // Exchanges authorization code for tokens, stores them
  // ═══════════════════════════════════════════════════════════
  if (req.method === "GET") {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    console.log("[Siphon] 📥 GET — OAuth callback received");

    // Handle Microsoft error response
    if (error) {
      console.error(`[Siphon] ❌ Microsoft returned error: ${error} — ${errorDescription}`);
      await logAuditEvent(supabase, "ENDPOINT_FAILURE", {
        phase: "OAUTH_CALLBACK",
        error,
        error_description: errorDescription,
      });

      let redirectUrl = "/admin?siphon=error";
      if (state) {
        try {
          const decoded = decodeState(state);
          redirectUrl = `${decoded.app_url}/admin?siphon=error&reason=${encodeURIComponent(error)}`;
        } catch { /* use default */ }
      }

      return new Response(null, {
        status: 302,
        headers: { Location: redirectUrl },
      });
    }

    // Validate required params
    if (!code || !state) {
      console.error("[Siphon] ❌ Missing code or state parameter");
      return new Response(
        JSON.stringify({ error: "INVALID_CALLBACK", message: "Missing code or state parameter" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    try {
      // Decode state to get user_id and app_url
      const { user_id: userId, app_url: appUrl } = decodeState(state);

      if (!userId) {
        throw new Error("STATE_INVALID: No user_id in state");
      }

      console.log(`[Siphon] 🔍 Processing callback for user ${userId.slice(0, 8)}...`);

      // Exchange code for tokens
      const tokens = await exchangeCodeForTokens(code);

      // Store tokens in vault
      await storeTokens(supabase, userId, tokens);

      // Log success
      await logAuditEvent(supabase, "SYNC_SUCCESS", {
        phase: "OAUTH_TOKEN_EXCHANGE",
        user_id: userId,
        scopes: tokens.scope,
      });

      // Redirect back to app
      const successUrl = appUrl
        ? `${appUrl}/admin?siphon=connected`
        : "/admin?siphon=connected";

      console.log(`[Siphon] ✅ OAuth flow complete. Redirecting to ${successUrl}`);

      return new Response(null, {
        status: 302,
        headers: { Location: successUrl },
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Siphon] ❌ Callback processing failed: ${errMsg}`);
      await logAuditEvent(supabase, "ENDPOINT_FAILURE", {
        phase: "OAUTH_CODE_EXCHANGE",
        error: errMsg,
      });

      return new Response(null, {
        status: 302,
        headers: { Location: "/admin?siphon=error&reason=token_exchange_failed" },
      });
    }
  }

  // Unsupported method
  return new Response(
    JSON.stringify({ error: "METHOD_NOT_ALLOWED" }),
    { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
