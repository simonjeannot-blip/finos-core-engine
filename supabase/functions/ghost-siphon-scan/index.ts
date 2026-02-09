import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ═══════════════════════════════════════════════════════════════
// GHOST SIPHON — Autonomous Scanner v4.2.0
//
// v4.2.0 INDUSTRIAL UPGRADE:
//   - AUTONOMOUS: Client Credentials flow (no user sign-in)
//   - APPLICATION PERMISSIONS: /users/{mailbox}/messages
//   - Scope: https://graph.microsoft.com/.default
//   - Target mailbox via GHOST_TARGET_MAILBOX secret
//   - Rolling 24h scan window for ongoing siphoning
//
// ARCHITECTURE: POST-triggered inbox scanner
//   1. Acquire app-level token via client_credentials grant
//   2. Query Microsoft Graph /users/{mailbox}/messages (last 24h)
//   3. Deduplicate & inject into siphoned_invoices
//   4. Audit trail for every scan cycle
//
// PERMISSIONS REQUIRED: Mail.Read (Application), User.Read.All (Application)
// ═══════════════════════════════════════════════════════════════

const VERSION = "v4.2.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const IMMUTABLE_CLIENT_ID = "9878609b-2022-47dc-bfef-0611cf133dbc";
const GRAPH_API_BASE = "https://graph.microsoft.com/v1.0";

// ═══════════════════════════════════════════════════════════════
// CLIENT CREDENTIALS TOKEN — Autonomous app-level access
// ═══════════════════════════════════════════════════════════════
async function acquireAppToken(tenantId: string): Promise<string> {
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!;
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  console.log(`[Scanner ${VERSION}] 🔑 Acquiring app token via client_credentials...`);
  console.log(`[Scanner ${VERSION}] 🏢 Tenant: ${tenantId}`);

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: IMMUTABLE_CLIENT_ID,
      client_secret: clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });

  const body = await response.text();

  if (!response.ok) {
    console.error(`[Scanner ${VERSION}] ❌ Client credentials token failed:`, body);
    throw new Error(`CLIENT_CREDENTIALS_FAILED: ${response.status} — ${body}`);
  }

  const data = JSON.parse(body);
  console.log(`[Scanner ${VERSION}] ✅ App token acquired. Expires in ${data.expires_in}s`);
  return data.access_token;
}

// ═══════════════════════════════════════════════════════════════
// GRAPH API — Fetch messages with PDF attachments (last 24h)
// Endpoint: /users/{mailbox}/messages (NOT /me/messages)
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

async function fetchRecentMessagesWithAttachments(
  accessToken: string,
  targetMailbox: string
): Promise<GraphMessage[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const filter = `hasAttachments eq true and receivedDateTime ge ${since}`;
  const select = "id,receivedDateTime,subject,from,hasAttachments";
  const orderBy = "receivedDateTime desc";
  const top = 50;

  // v4.2.0: Application endpoint
  const url = `${GRAPH_API_BASE}/users/${encodeURIComponent(targetMailbox)}/messages?$filter=${encodeURIComponent(filter)}&$select=${select}&$orderby=${encodeURIComponent(orderBy)}&$top=${top}`;

  console.log(`[Scanner ${VERSION}] 📬 Querying /users/${targetMailbox}/messages (last 24h)...`);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[Scanner ${VERSION}] ❌ Graph messages query failed:`, response.status, errorBody);
    throw new Error(`GRAPH_MESSAGES_FAILED: ${response.status}`);
  }

  const data = await response.json();
  const messages: GraphMessage[] = data.value || [];
  console.log(`[Scanner ${VERSION}] 📬 Found ${messages.length} messages with attachments in last 24h`);
  return messages;
}

async function fetchPdfAttachments(
  accessToken: string,
  targetMailbox: string,
  messageId: string
): Promise<GraphAttachment[]> {
  // v4.2.0: Application endpoint
  const url = `${GRAPH_API_BASE}/users/${encodeURIComponent(targetMailbox)}/messages/${messageId}/attachments?$select=id,name,contentType,size`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    console.warn(`[Scanner ${VERSION}] ⚠️ Could not fetch attachments for message ${messageId.slice(0, 12)}...`);
    return [];
  }

  const data = await response.json();
  const attachments: GraphAttachment[] = data.value || [];

  return attachments.filter(
    (a) =>
      a.contentType === "application/pdf" ||
      a.name?.toLowerCase().endsWith(".pdf")
  );
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
      table_name: "siphoned_invoices",
      record_id: "00000000-0000-0000-0000-000000000000",
      action_type: actionType,
      old_data_hash: null,
      new_data_hash: JSON.stringify({
        ...context,
        timestamp: new Date().toISOString(),
        source: "GHOST_SIPHON_SCANNER",
        version: VERSION,
      }),
      changed_by: null,
    });
    console.log(`[Scanner ${VERSION}] 📝 Audit: ${actionType}`);
  } catch (err) {
    console.error(`[Scanner ${VERSION}] ⚠️ Audit log write failed:`, err);
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
  // AUTH GATE — Validates Supabase caller identity
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
  console.log(`[Scanner ${VERSION}] 🔒 Authenticated: ${userId.slice(0, 8)}...`);

  try {
    // ═══════════════════════════════════════════════════════
    // STEP 1: Resolve tenant_id from stored tokens
    // ═══════════════════════════════════════════════════════
    const { data: tokenRecord, error: tokenError } = await supabase
      .from("microsoft_oauth_tokens")
      .select("tenant_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (tokenError || !tokenRecord?.tenant_id) {
      console.error(`[Scanner ${VERSION}] ❌ No tenant_id found.`);
      return new Response(
        JSON.stringify({
          error: "NO_TENANT",
          message: "Ghost Siphon requires a stored tenant_id.",
          siphon_state: "disconnected",
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tenantId = tokenRecord.tenant_id;

    // ═══════════════════════════════════════════════════════
    // STEP 2: Acquire app-level token + resolve mailbox
    // ═══════════════════════════════════════════════════════
    const targetMailbox = Deno.env.get("GHOST_TARGET_MAILBOX");
    if (!targetMailbox) {
      console.error(`[Scanner ${VERSION}] ❌ GHOST_TARGET_MAILBOX secret not configured.`);
      return new Response(
        JSON.stringify({
          error: "NO_TARGET_MAILBOX",
          message: "GHOST_TARGET_MAILBOX secret is required.",
          siphon_state: "error",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Scanner ${VERSION}] 📧 Target mailbox: ${targetMailbox}`);

    let accessToken: string;
    try {
      accessToken = await acquireAppToken(tenantId);
    } catch (tokenErr) {
      const errMsg = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
      console.error(`[Scanner ${VERSION}] ❌ App token acquisition failed:`, errMsg);

      await logAuditEvent(supabase, "ENDPOINT_FAILURE", {
        phase: "TOKEN_ACQUISITION",
        user_id: userId,
        error: errMsg,
      });

      return new Response(
        JSON.stringify({
          error: "TOKEN_ACQUISITION_FAILED",
          message: errMsg,
          siphon_state: "error",
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ═══════════════════════════════════════════════════════
    // STEP 3: Scan inbox for PDF attachments (last 24h)
    // ═══════════════════════════════════════════════════════
    const messages = await fetchRecentMessagesWithAttachments(accessToken, targetMailbox);

    let newInvoicesCount = 0;
    let skippedCount = 0;
    const scanResults: Array<{ sender: string; subject: string; attachment: string; status: string }> = [];

    for (const message of messages) {
      const pdfs = await fetchPdfAttachments(accessToken, targetMailbox, message.id);

      for (const pdf of pdfs) {
        const deduplicationKey = `${message.id}::${pdf.id}`;

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
        // EVIDENCE INJECTION
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
              architecture: "CLIENT_CREDENTIALS",
              version: VERSION,
            },
          });

        if (insertError) {
          console.error(`[Scanner ${VERSION}] ❌ Insert failed for ${pdf.name}:`, insertError.message);
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
          console.log(`[Scanner ${VERSION}] 💉 Injected: ${pdf.name} from ${senderAddress}`);
        }
      }
    }

    // ═══════════════════════════════════════════════════════
    // STEP 4: Audit the scan cycle
    // ═══════════════════════════════════════════════════════
    await logAuditEvent(supabase, "SYNC_SUCCESS", {
      phase: "INBOX_SCAN",
      architecture: "CLIENT_CREDENTIALS",
      user_id: userId,
      target_mailbox: targetMailbox,
      messages_scanned: messages.length,
      new_invoices: newInvoicesCount,
      duplicates_skipped: skippedCount,
      tenant_id: tenantId,
    });

    console.log(`[Scanner ${VERSION}] ✅ Scan complete: ${newInvoicesCount} new, ${skippedCount} duplicates`);

    return new Response(
      JSON.stringify({
        status: "SCAN_COMPLETE",
        siphon_state: "connected",
        version: VERSION,
        architecture: "CLIENT_CREDENTIALS",
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
    console.error(`[Scanner ${VERSION}] ❌ Scan failed: ${errMsg}`);

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
        version: VERSION,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
