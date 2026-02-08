import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ═══════════════════════════════════════════════════════════════
// THE GHOST SIPHON — Microsoft OAuth Bridge v3.0
//
// ARCHITECTURE: Frontend-Redirected OAuth
//   POST (no body / with app_url) → Generate Microsoft OAuth URL
//       Microsoft redirects → FRONTEND /admin?code=...&state=...
//   POST (with code+state)        → Exchange code for tokens
//
// The callback now lands on the live frontend, not this function.
// This eliminates "Invalid Path" errors from Edge Function routing.
// ═══════════════════════════════════════════════════════════════

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ═══════════════════════════════════════════════════════════════
// GLOBAL COMMON ENDPOINT — No tenant inference. Multi-tenant only.
// ═══════════════════════════════════════════════════════════════
const MICROSOFT_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const SCOPES = "openid offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadBasic";

// Cache-buster version — bump on every deploy
const VERSION = "v4.0.0";

// ═══════════════════════════════════════════════════════════════
// HARD-CODED CLIENT ID — Clean-room registration. v4.0.0 transplant.
// ═══════════════════════════════════════════════════════════════
const IMMUTABLE_CLIENT_ID = "9878609b-2022-47dc-bfef-0611cf133dbc";

// ═══════════════════════════════════════════════════════════════
// IMMUTABLE REDIRECT URI — Hard-coded. No inference. No guesswork.
// Must match EXACTLY what is registered in Microsoft Entra Portal.
// ═══════════════════════════════════════════════════════════════
const IMMUTABLE_REDIRECT_URI = "https://finos-core-engine.lovable.app/admin";

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
  id_token?: string;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length !== 3) {
    throw new Error("ID_TOKEN_MALFORMED: Expected 3-part JWT");
  }
  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const json = atob(padded);
  return JSON.parse(json);
}

async function exchangeCodeForTokens(code: string): Promise<TokenResponse> {
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET") || "";

  // ═══════════════════════════════════════════════════════════
  // FORENSIC AUDIT — One-time diagnostic for Ghost Key integrity
  // If length ~36 → you used the Secret ID (WRONG)
  // If length ~40 and starts with expected prefix → Secret Value (CORRECT)
  // ═══════════════════════════════════════════════════════════
  console.log(`[Audit] Secret Length: ${clientSecret.length}`);
  console.log(`[Audit] Secret Prefix: ${clientSecret.substring(0, 3)}`);
  console.log(`[Audit] Client ID: ${IMMUTABLE_CLIENT_ID}`);
  console.log(`[Audit] Redirect URI: ${IMMUTABLE_REDIRECT_URI}`);

  console.log(`[Siphon v${VERSION}] 🔑 Exchanging code for tokens...`);
  console.log(`[Siphon v${VERSION}] [Handshake] Trading code using URI: ${IMMUTABLE_REDIRECT_URI}`);

  const response = await fetch(MICROSOFT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: IMMUTABLE_CLIENT_ID,
      client_secret: clientSecret,
      code,
      redirect_uri: IMMUTABLE_REDIRECT_URI,
      grant_type: "authorization_code",
      scope: SCOPES,
    }),
  });

  const body = await response.text();

  if (!response.ok) {
    console.error(`[Siphon v${VERSION}] ❌ Token exchange failed:`, body);
    throw new Error(`TOKEN_EXCHANGE_FAILED: ${response.status} — ${body}`);
  }

  const tokenData = JSON.parse(body) as TokenResponse;
  console.log(`[Siphon v${VERSION}] ✅ Tokens acquired. Expires in: ${tokenData.expires_in}s`);

  if (tokenData.id_token) {
    try {
      const claims = decodeJwtPayload(tokenData.id_token);
      console.log(`[Siphon v${VERSION}] 🏢 Tenant ID (tid): ${claims.tid || "NOT_PRESENT"}`);
    } catch (e) {
      console.warn(`[Siphon v${VERSION}] ⚠️ Could not decode id_token:`, e);
    }
  }

  return tokenData;
}

// ═══════════════════════════════════════════════════════════════
// TOKEN STORAGE — Upsert into microsoft_oauth_tokens vault
// ═══════════════════════════════════════════════════════════════
async function storeTokens(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  tokens: TokenResponse
): Promise<string | null> {
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  let tenantId: string | null = null;
  if (tokens.id_token) {
    try {
      const claims = decodeJwtPayload(tokens.id_token);
      tenantId = (claims.tid as string) || null;
      console.log(`[Siphon v${VERSION}] 🏢 Extracted tenant_id: ${tenantId || "NONE"}`);
    } catch (e) {
      console.warn(`[Siphon v${VERSION}] ⚠️ Failed to extract tenant_id:`, e);
    }
  }

  console.log(`[Siphon v${VERSION}] 💾 Storing tokens for user ${userId.slice(0, 8)}...`);

  const upsertPayload: Record<string, unknown> = {
    user_id: userId,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: expiresAt,
    scopes: tokens.scope || SCOPES,
  };

  if (tenantId) {
    upsertPayload.tenant_id = tenantId;
  }

  const { error } = await supabase
    .from("microsoft_oauth_tokens")
    .upsert(upsertPayload, { onConflict: "user_id" });

  if (error) {
    console.error(`[Siphon v${VERSION}] ❌ Token storage failed:`, error.message);
    throw new Error(`TOKEN_STORAGE_FAILED: ${error.message}`);
  }

  console.log(`[Siphon v${VERSION}] ✅ Tokens stored successfully`);
  return tenantId;
}

// ═══════════════════════════════════════════════════════════════
// AUDIT LOG
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
        version: VERSION,
      }),
      changed_by: null,
    });
    console.log(`[Siphon v${VERSION}] 📝 ${actionType} logged to audit trail`);
  } catch (err) {
    console.error(`[Siphon v${VERSION}] ⚠️ Audit log write failed:`, err);
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER — POST only
// ═══════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "METHOD_NOT_ALLOWED", _version: VERSION }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ═════════════════════════════════════════════════════════
  // Validate auth header
  // ═════════════════════════════════════════════════════════
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: "AUTH_REQUIRED", message: "Missing authorization header" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseAuth = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();

  if (authError || !user) {
    console.error(`[Siphon v${VERSION}] ❌ Auth validation failed:`, authError?.message);
    return new Response(
      JSON.stringify({ error: "AUTH_FAILED", message: "Invalid authentication" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ═════════════════════════════════════════════════════════
  // Parse body to determine mode
  // ═════════════════════════════════════════════════════════
  let body: Record<string, string> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const { code, state } = body;

  // ═════════════════════════════════════════════════════════
  // MODE A: TOKEN EXCHANGE — Frontend sends code + state
  // ═════════════════════════════════════════════════════════
  if (code && state) {
    console.log(`[Siphon v${VERSION}] 🔄 TOKEN EXCHANGE mode — code received from frontend`);

    try {
      const { user_id: stateUserId, app_url: stateAppUrl } = decodeState(state);

      if (!stateUserId) {
        throw new Error("STATE_INVALID: No user_id in state");
      }

      // Security: verify the authenticated user matches the state user
      if (stateUserId !== user.id) {
        console.error(`[Siphon v${VERSION}] ❌ User mismatch: auth=${user.id.slice(0,8)} state=${stateUserId.slice(0,8)}`);
        throw new Error("USER_MISMATCH: Authenticated user does not match state");
      }

      console.log(`[Siphon v${VERSION}] 🔍 Processing token exchange for user ${user.id.slice(0, 8)}...`);
      console.log(`[Siphon v${VERSION}] [Handshake] Trading code using URI: ${IMMUTABLE_REDIRECT_URI}`);

      const tokens = await exchangeCodeForTokens(code);
      const tenantId = await storeTokens(supabase, user.id, tokens);

      await logAuditEvent(supabase, "SYNC_SUCCESS", {
        phase: "FRONTEND_TOKEN_EXCHANGE",
        user_id: user.id,
        tenant_id: tenantId || "unknown",
        scopes: tokens.scope,
        architecture: "v3_frontend_redirect",
      });

      return new Response(
        JSON.stringify({
          success: true,
          tenant_id: tenantId,
          _version: VERSION,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Siphon v${VERSION}] ❌ Token exchange failed: ${errMsg}`);
      await logAuditEvent(supabase, "ENDPOINT_FAILURE", {
        phase: "FRONTEND_TOKEN_EXCHANGE",
        error: errMsg,
      });

      return new Response(
        JSON.stringify({ error: "TOKEN_EXCHANGE_FAILED", message: errMsg, _version: VERSION }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // ═════════════════════════════════════════════════════════
  // MODE B: GENERATE AUTH URL — Initiate OAuth flow
  // ═════════════════════════════════════════════════════════
  console.log(`[Siphon v${VERSION}] 🔗 AUTH URL mode — generating OAuth URL`);

  try {
    const stateParam = encodeState(user.id, IMMUTABLE_REDIRECT_URI);

    const authorizationUrl = new URL(MICROSOFT_AUTH_URL);
    authorizationUrl.searchParams.set("client_id", IMMUTABLE_CLIENT_ID);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("redirect_uri", IMMUTABLE_REDIRECT_URI);
    authorizationUrl.searchParams.set("scope", SCOPES);
    authorizationUrl.searchParams.set("state", stateParam);
    authorizationUrl.searchParams.set("response_mode", "query");
    authorizationUrl.searchParams.set("prompt", "consent");

    console.log(`[Siphon v${VERSION}] ✅ Auth URL generated for user ${user.id.slice(0, 8)}...`);
    console.log(`[Siphon v${VERSION}] [Handshake] Auth redirect URI: ${IMMUTABLE_REDIRECT_URI}`);

    return new Response(
      JSON.stringify({
        auth_url: authorizationUrl.toString(),
        redirect_uri: IMMUTABLE_REDIRECT_URI,
        _version: VERSION,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Siphon v${VERSION}] ❌ Auth URL generation error: ${errMsg}`);
    await logAuditEvent(supabase, "ENDPOINT_FAILURE", {
      phase: "AUTH_URL_GENERATION",
      error: errMsg,
    });
    return new Response(
      JSON.stringify({ error: "INTERNAL_ERROR", message: errMsg, _version: VERSION }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
