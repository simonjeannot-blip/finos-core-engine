import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ═══════════════════════════════════════════════════════════════
// GHOST SIPHON — Autonomous Scanner v1.0
//
// ARCHITECTURE: POST-triggered inbox scanner
//   1. Refresh access_token using stored refresh_token
//   2. Query Microsoft Graph for PDF attachments (last 24h)
//   3. Deduplicate & inject into siphoned_invoices
//   4. Audit trail for every scan cycle
//
// SCOPES REQUIRED: Mail.Read, Mail.ReadBasic
// ═══════════════════════════════════════════════════════════════

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_API_BASE = "https://graph.microsoft.com/v1.0";
const SCOPES = "openid offline_access Mail.Read Mail.ReadBasic";

// ═══════════════════════════════════════════════════════════════
// TOKEN REFRESH — Silent renewal using refresh_token
// ═══════════════════════════════════════════════════════════════
interface TokenRefreshResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function refreshAccessToken(refreshToken: string): Promise<TokenRefreshResult> {
  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!;
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!;

  console.log("[Scanner] 🔄 Refreshing access token...");

  const response = await fetch(MICROSOFT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: SCOPES,
    }),
  });

  const body = await response.text();

  if (!response.ok) {
    console.error("[Scanner] ❌ Token refresh failed:", body);
    throw new Error(`TOKEN_REFRESH_FAILED: ${response.status}`);
  }

  const data = JSON.parse(body);
  console.log("[Scanner] ✅ Token refreshed. New expiry in", data.expires_in, "seconds");
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken, // Microsoft may or may not rotate
    expires_in: data.expires_in,
  };
}

// ═══════════════════════════════════════════════════════════════
// GRAPH API — Fetch messages with PDF attachments (last 24h)
// ═══════════════════════════════════════════════════════════════
interface GraphMessage {
  id: string;
  receivedDateTime: string;
  subject: string;
  from: { emailAddress: { name: string; address: string } };
  hasAttachments: boolean;
}

interface GraphAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
}

async function fetchRecentMessagesWithAttachments(accessToken: string): Promise<GraphMessage[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const filter = `hasAttachments eq true and receivedDateTime ge ${since}`;
  const select = "id,receivedDateTime,subject,from,hasAttachments";
  const orderBy = "receivedDateTime desc";
  const top = 50;

  const url = `${GRAPH_API_BASE}/me/messages?$filter=${encodeURIComponent(filter)}&$select=${select}&$orderby=${encodeURIComponent(orderBy)}&$top=${top}`;

  console.log("[Scanner] 👂 Querying inbox for messages with attachments...");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[Scanner] ❌ Graph messages query failed:", response.status, errorBody);
    throw new Error(`GRAPH_MESSAGES_FAILED: ${response.status}`);
  }

  const data = await response.json();
  const messages: GraphMessage[] = data.value || [];
  console.log(`[Scanner] 📬 Found ${messages.length} messages with attachments in last 24h`);
  return messages;
}

async function fetchPdfAttachments(accessToken: string, messageId: string): Promise<GraphAttachment[]> {
  const url = `${GRAPH_API_BASE}/me/messages/${messageId}/attachments?$select=id,name,contentType,size`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    console.warn(`[Scanner] ⚠️ Could not fetch attachments for message ${messageId.slice(0, 12)}...`);
    return [];
  }

  const data = await response.json();
  const attachments: GraphAttachment[] = data.value || [];

  // Filter PDF only
  return attachments.filter(
    (a) =>
      a.contentType === "application/pdf" ||
      a.name?.toLowerCase().endsWith(".pdf")
  );
}

// ═══════════════════════════════════════════════════════════════
// AUDIT LOG — Record scan events
// ═══════════════════════════════════════════════════════════════
async function logAuditEvent(
  supabase: ReturnType<typeof createClient>,
  actionType: string,
  context: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from("system_audit_log").insert({
      table_name: "siphoned_invoices",
      record_id: "00000000-0000-0000-0000-000000000000",
      action_type: actionType,
      old_data_hash: null,
      new_data_hash: JSON.stringify({
        ...context,
        timestamp: new Date().toISOString(),
        source: "GHOST_SIPHON_SCANNER",
      }),
      changed_by: null,
    });
    console.log(`[Scanner] 📝 Audit: ${actionType}`);
  } catch (err) {
    console.error("[Scanner] ⚠️ Audit log write failed:", err);
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "METHOD_NOT_ALLOWED" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // ═══════════════════════════════════════════════════════════
  // AUTH GATE — Validate caller
  // ═══════════════════════════════════════════════════════════
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: "AUTH_REQUIRED" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseAuth = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();

  if (authError || !user) {
    return new Response(
      JSON.stringify({ error: "AUTH_FAILED" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const userId = user.id;
  console.log(`[Scanner] 🔒 Authenticated: ${userId.slice(0, 8)}...`);

  try {
    // ═══════════════════════════════════════════════════════
    // STEP 1: Retrieve stored tokens
    // ═══════════════════════════════════════════════════════
    const { data: tokenRecord, error: tokenError } = await supabase
      .from("microsoft_oauth_tokens")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (tokenError || !tokenRecord) {
      console.error("[Scanner] ❌ No token record found for user");
      return new Response(
        JSON.stringify({
          error: "NO_CONNECTION",
          message: "Ghost Siphon not connected. Authorize via Siphon Control first.",
          siphon_state: "disconnected",
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ═══════════════════════════════════════════════════════
    // STEP 2: Refresh the access token
    // ═══════════════════════════════════════════════════════
    let accessToken: string;
    try {
      const refreshed = await refreshAccessToken(tokenRecord.refresh_token);
      accessToken = refreshed.access_token;

      // Update vault with new tokens
      const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
      await supabase
        .from("microsoft_oauth_tokens")
        .update({
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token,
          expires_at: newExpiresAt,
        })
        .eq("user_id", userId);

      console.log("[Scanner] 💾 Vault updated with fresh tokens");
    } catch (refreshErr) {
      const errMsg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
      console.error("[Scanner] ❌ Refresh failed — marking connection as error state");

      // Set expires_at to past to trigger "error" state in Ghost Pulse
      await supabase
        .from("microsoft_oauth_tokens")
        .update({ expires_at: new Date(0).toISOString() })
        .eq("user_id", userId);

      await logAuditEvent(supabase, "ENDPOINT_FAILURE", {
        phase: "TOKEN_REFRESH",
        user_id: userId,
        error: errMsg,
      });

      return new Response(
        JSON.stringify({
          error: "TOKEN_REFRESH_FAILED",
          message: "Re-authentication required.",
          siphon_state: "error",
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ═══════════════════════════════════════════════════════
    // STEP 3: Scan inbox for PDF attachments
    // ═══════════════════════════════════════════════════════
    const messages = await fetchRecentMessagesWithAttachments(accessToken);

    let newInvoicesCount = 0;
    let skippedCount = 0;
    const scanResults: Array<{ sender: string; subject: string; attachment: string; status: string }> = [];

    for (const message of messages) {
      const pdfs = await fetchPdfAttachments(accessToken, message.id);

      for (const pdf of pdfs) {
        // Deduplication key: message_id stored in raw_json
        const deduplicationKey = `${message.id}::${pdf.id}`;

        // Check for existing record
        const { data: existing } = await supabase
          .from("siphoned_invoices")
          .select("id")
          .eq("user_id", userId)
          .contains("raw_json", { dedup_key: deduplicationKey })
          .maybeSingle();

        if (existing) {
          skippedCount++;
          continue;
        }

        // ═══════════════════════════════════════════════════
        // EVIDENCE INJECTION — Insert new invoice record
        // ═══════════════════════════════════════════════════
        const senderAddress = message.from?.emailAddress?.address || "Unknown";
        const senderName = message.from?.emailAddress?.name || senderAddress;

        const { error: insertError } = await supabase
          .from("siphoned_invoices")
          .insert({
            user_id: userId,
            sender: senderName,
            subject: message.subject || "(No Subject)",
            attachment_name: pdf.name,
            received_at: message.receivedDateTime,
            status: "pending",
            amount_detected: 0,
            raw_json: {
              dedup_key: deduplicationKey,
              message_id: message.id,
              attachment_id: pdf.id,
              attachment_size: pdf.size,
              content_type: pdf.contentType,
              sender_address: senderAddress,
              sender_name: senderName,
            },
          });

        if (insertError) {
          console.error(`[Scanner] ❌ Insert failed for ${pdf.name}:`, insertError.message);
          scanResults.push({
            sender: senderAddress,
            subject: message.subject,
            attachment: pdf.name,
            status: "INSERT_FAILED",
          });
        } else {
          newInvoicesCount++;
          scanResults.push({
            sender: senderAddress,
            subject: message.subject,
            attachment: pdf.name,
            status: "INJECTED",
          });
          console.log(`[Scanner] 💉 Injected: ${pdf.name} from ${senderAddress}`);
        }
      }
    }

    // ═══════════════════════════════════════════════════════
    // STEP 4: Audit the scan cycle
    // ═══════════════════════════════════════════════════════
    await logAuditEvent(supabase, "SYNC_SUCCESS", {
      phase: "INBOX_SCAN",
      user_id: userId,
      messages_scanned: messages.length,
      new_invoices: newInvoicesCount,
      duplicates_skipped: skippedCount,
      tenant_id: tokenRecord.tenant_id || "unknown",
    });

    console.log(`[Scanner] ✅ Scan complete: ${newInvoicesCount} new, ${skippedCount} duplicates`);

    return new Response(
      JSON.stringify({
        status: "SCAN_COMPLETE",
        siphon_state: "connected",
        messages_scanned: messages.length,
        new_invoices: newInvoicesCount,
        duplicates_skipped: skippedCount,
        scan_timestamp: new Date().toISOString(),
        results: scanResults,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Scanner] ❌ Scan failed: ${errMsg}`);

    await logAuditEvent(supabase, "ENDPOINT_FAILURE", {
      phase: "INBOX_SCAN",
      user_id: userId,
      error: errMsg,
    });

    return new Response(
      JSON.stringify({
        error: "SCAN_FAILED",
        message: errMsg,
        siphon_state: "error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
