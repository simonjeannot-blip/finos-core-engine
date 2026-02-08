import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ═══════════════════════════════════════════════════════════════
// GHOST SIPHON — Deep Discovery Scanner v1.0
//
// ARCHITECTURE: POST-triggered 30-day inbox forensic scan
//   1. Refresh access_token using stored refresh_token
//   2. Query Microsoft Graph for ALL PDF attachments (last 30 days)
//   3. Extract & classify metadata with confidence scoring
//   4. Cross-reference senders against known ledger vendors
//   5. Return the full Supplier Intelligence Map
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
// CONFIDENCE SCORING ENGINE
//
// HIGH  (Dojo Green):  Contains "Invoice", "Bill", "Statement"
//                      in subject or filename
// MEDIUM (Amber):      PDF from a known supplier domain but
//                      no "Invoice" keyword
// LOW   (Charcoal):    Miscellaneous PDFs
// ═══════════════════════════════════════════════════════════════
const HIGH_CONFIDENCE_KEYWORDS = [
  "invoice", "bill", "statement", "receipt", "remittance",
  "payment", "purchase order", "po#", "credit note", "debit note",
  "inv-", "inv_", "inv #",
];

function classifyConfidence(
  subject: string,
  filename: string,
  senderDomain: string,
  knownSupplierDomains: Set<string>
): { score: "HIGH" | "MEDIUM" | "LOW"; reason: string } {
  const subjectLower = subject.toLowerCase();
  const filenameLower = filename.toLowerCase();
  const combined = `${subjectLower} ${filenameLower}`;

  // HIGH: keyword match in subject or filename
  for (const kw of HIGH_CONFIDENCE_KEYWORDS) {
    if (combined.includes(kw)) {
      return {
        score: "HIGH",
        reason: `Keyword match: "${kw}" found in ${subjectLower.includes(kw) ? "subject" : "filename"}`,
      };
    }
  }

  // Filename pattern match (INV-XXXX, Statement_Feb, etc.)
  const invoicePattern = /\b(inv|invoice|bill|stmt|statement)[_\-\s]?\d*/i;
  if (invoicePattern.test(filename)) {
    return {
      score: "HIGH",
      reason: `Filename pattern match: "${filename}"`,
    };
  }

  // MEDIUM: known supplier domain
  if (knownSupplierDomains.has(senderDomain)) {
    return {
      score: "MEDIUM",
      reason: `Known supplier domain: ${senderDomain}`,
    };
  }

  // LOW: miscellaneous PDF
  return {
    score: "LOW",
    reason: "No keyword or supplier match — miscellaneous PDF",
  };
}

// ═══════════════════════════════════════════════════════════════
// CADENCE ANALYSIS — Detect arrival patterns
// ═══════════════════════════════════════════════════════════════
function analyzeCadence(dates: string[]): string {
  if (dates.length < 2) return "INSUFFICIENT_DATA";
  
  const sorted = dates
    .map((d) => new Date(d).getTime())
    .sort((a, b) => a - b);
  
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push((sorted[i] - sorted[i - 1]) / (1000 * 60 * 60 * 24)); // days
  }
  
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  
  if (avgGap <= 8) return "WEEKLY";
  if (avgGap <= 16) return "BI_WEEKLY";
  if (avgGap <= 35) return "MONTHLY";
  return "IRREGULAR";
}

// ═══════════════════════════════════════════════════════════════
// TOKEN REFRESH — Silent renewal
// ═══════════════════════════════════════════════════════════════
async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!;
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!;

  console.log("[Discovery] 🔄 Refreshing access token...");

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
    console.error("[Discovery] ❌ Token refresh failed:", body);
    throw new Error(`TOKEN_REFRESH_FAILED: ${response.status}`);
  }

  const data = JSON.parse(body);
  console.log("[Discovery] ✅ Token refreshed.");
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires_in: data.expires_in,
  };
}

// ═══════════════════════════════════════════════════════════════
// GRAPH API — Paginated fetch for 30 days of messages
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

async function fetchAllMessagesWithAttachments(
  accessToken: string,
  daysBack: number = 30
): Promise<GraphMessage[]> {
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const filter = `hasAttachments eq true and receivedDateTime ge ${since}`;
  const select = "id,receivedDateTime,subject,from,hasAttachments";
  const orderBy = "receivedDateTime desc";

  const allMessages: GraphMessage[] = [];
  let nextLink: string | null =
    `${GRAPH_API_BASE}/me/messages?$filter=${encodeURIComponent(filter)}&$select=${select}&$orderby=${encodeURIComponent(orderBy)}&$top=50`;

  let pageCount = 0;
  const MAX_PAGES = 10; // Safety cap: 500 messages max

  while (nextLink && pageCount < MAX_PAGES) {
    console.log(`[Discovery] 📬 Fetching page ${pageCount + 1}...`);

    const response = await fetch(nextLink, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("[Discovery] ❌ Graph query failed:", response.status, errorBody);
      throw new Error(`GRAPH_MESSAGES_FAILED: ${response.status}`);
    }

    const data = await response.json();
    const messages: GraphMessage[] = data.value || [];
    allMessages.push(...messages);

    nextLink = data["@odata.nextLink"] || null;
    pageCount++;
  }

  console.log(`[Discovery] 📊 Total messages found: ${allMessages.length} across ${pageCount} page(s)`);
  return allMessages;
}

async function fetchPdfAttachments(
  accessToken: string,
  messageId: string
): Promise<GraphAttachment[]> {
  const url = `${GRAPH_API_BASE}/me/messages/${messageId}/attachments?$select=id,name,contentType,size`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    console.warn(`[Discovery] ⚠️ Could not fetch attachments for ${messageId.slice(0, 12)}...`);
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
  // AUTH GATE
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
  console.log(`[Discovery] 🔒 Authenticated: ${userId.slice(0, 8)}...`);

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
      return new Response(
        JSON.stringify({
          error: "NO_CONNECTION",
          message: "Ghost Siphon not connected.",
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

      const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
      await supabase
        .from("microsoft_oauth_tokens")
        .update({
          access_token: refreshed.access_token,
          refresh_token: refreshed.refresh_token,
          expires_at: newExpiresAt,
        })
        .eq("user_id", userId);
    } catch (refreshErr) {
      const errMsg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);

      await supabase
        .from("microsoft_oauth_tokens")
        .update({ expires_at: new Date(0).toISOString() })
        .eq("user_id", userId);

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
    // STEP 3: Load known supplier domains from ledger
    // ═══════════════════════════════════════════════════════
    const { data: ledgerVendors } = await supabase
      .from("financial_ledger")
      .select("vendor_name")
      .eq("user_id", userId);

    const knownVendorNames = new Set<string>();
    const knownSupplierDomains = new Set<string>();

    if (ledgerVendors) {
      for (const v of ledgerVendors) {
        knownVendorNames.add(v.vendor_name.toLowerCase());
        // Extract domain-like patterns from vendor names
        const domainMatch = v.vendor_name.match(/@?([\w.-]+\.\w{2,})/);
        if (domainMatch) {
          knownSupplierDomains.add(domainMatch[1].toLowerCase());
        }
      }
    }

    // Also load existing siphoned senders as known
    const { data: siphonedVendors } = await supabase
      .from("siphoned_invoices")
      .select("sender, raw_json")
      .eq("user_id", userId);

    if (siphonedVendors) {
      for (const sv of siphonedVendors) {
        const addr = (sv.raw_json as Record<string, string>)?.sender_address;
        if (addr) {
          const domain = addr.split("@")[1]?.toLowerCase();
          if (domain) knownSupplierDomains.add(domain);
        }
      }
    }

    console.log(`[Discovery] 🏭 Known supplier domains: ${knownSupplierDomains.size}`);

    // ═══════════════════════════════════════════════════════
    // STEP 4: Full 30-day inbox scan
    // ═══════════════════════════════════════════════════════
    const messages = await fetchAllMessagesWithAttachments(accessToken, 30);

    // ═══════════════════════════════════════════════════════
    // STEP 5: Extract, classify, and map
    // ═══════════════════════════════════════════════════════
    interface DiscoveredInvoice {
      message_id: string;
      sender_name: string;
      sender_address: string;
      sender_domain: string;
      subject: string;
      filename: string;
      file_size: number;
      received_at: string;
      confidence: "HIGH" | "MEDIUM" | "LOW";
      confidence_reason: string;
      is_known_supplier: boolean;
      is_already_siphoned: boolean;
    }

    const discoveries: DiscoveredInvoice[] = [];
    const senderDateMap: Record<string, string[]> = {};
    const existingDedupKeys = new Set<string>();

    // Build dedup set from existing siphoned invoices
    if (siphonedVendors) {
      for (const sv of siphonedVendors) {
        const dedupKey = (sv.raw_json as Record<string, string>)?.dedup_key;
        if (dedupKey) existingDedupKeys.add(dedupKey);
      }
    }

    let processedMessages = 0;
    for (const message of messages) {
      const pdfs = await fetchPdfAttachments(accessToken, message.id);
      processedMessages++;

      for (const pdf of pdfs) {
        const senderAddress = message.from?.emailAddress?.address || "unknown@unknown";
        const senderName = message.from?.emailAddress?.name || senderAddress;
        const senderDomain = senderAddress.split("@")[1]?.toLowerCase() || "unknown";
        const dedupKey = `${message.id}::${pdf.id}`;

        // Track dates per sender for cadence analysis
        if (!senderDateMap[senderDomain]) {
          senderDateMap[senderDomain] = [];
        }
        senderDateMap[senderDomain].push(message.receivedDateTime);

        const { score, reason } = classifyConfidence(
          message.subject || "",
          pdf.name || "",
          senderDomain,
          knownSupplierDomains
        );

        const isKnown = knownSupplierDomains.has(senderDomain) ||
          knownVendorNames.has(senderName.toLowerCase());

        discoveries.push({
          message_id: message.id,
          sender_name: senderName,
          sender_address: senderAddress,
          sender_domain: senderDomain,
          subject: message.subject || "(No Subject)",
          filename: pdf.name,
          file_size: pdf.size,
          received_at: message.receivedDateTime,
          confidence: score,
          confidence_reason: reason,
          is_known_supplier: isKnown,
          is_already_siphoned: existingDedupKeys.has(dedupKey),
        });
      }
    }

    // ═══════════════════════════════════════════════════════
    // STEP 6: Supplier Intelligence Summary
    // ═══════════════════════════════════════════════════════
    interface SupplierProfile {
      domain: string;
      sender_names: string[];
      total_pdfs: number;
      cadence: string;
      is_known: boolean;
      highest_confidence: "HIGH" | "MEDIUM" | "LOW";
    }

    const supplierMap: Record<string, SupplierProfile> = {};

    for (const d of discoveries) {
      if (!supplierMap[d.sender_domain]) {
        supplierMap[d.sender_domain] = {
          domain: d.sender_domain,
          sender_names: [],
          total_pdfs: 0,
          cadence: "INSUFFICIENT_DATA",
          is_known: d.is_known_supplier,
          highest_confidence: d.confidence,
        };
      }
      const sp = supplierMap[d.sender_domain];
      sp.total_pdfs++;
      if (!sp.sender_names.includes(d.sender_name)) {
        sp.sender_names.push(d.sender_name);
      }
      // Upgrade confidence if higher
      const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      if (rank[d.confidence] > rank[sp.highest_confidence]) {
        sp.highest_confidence = d.confidence;
      }
    }

    // Inject cadence data
    for (const domain of Object.keys(supplierMap)) {
      if (senderDateMap[domain]) {
        supplierMap[domain].cadence = analyzeCadence(senderDateMap[domain]);
      }
    }

    const suppliers = Object.values(supplierMap);
    const newSuppliers = suppliers.filter((s) => !s.is_known);

    // ═══════════════════════════════════════════════════════
    // STEP 7: Audit the discovery event
    // ═══════════════════════════════════════════════════════
    try {
      await supabase.from("system_audit_log").insert({
        table_name: "siphoned_invoices",
        record_id: "00000000-0000-0000-0000-000000000000",
        action_type: "SYNC_SUCCESS",
        old_data_hash: null,
        new_data_hash: JSON.stringify({
          phase: "DISCOVERY_SCAN",
          user_id: userId,
          messages_scanned: processedMessages,
          total_pdfs_found: discoveries.length,
          high_confidence: discoveries.filter((d) => d.confidence === "HIGH").length,
          medium_confidence: discoveries.filter((d) => d.confidence === "MEDIUM").length,
          low_confidence: discoveries.filter((d) => d.confidence === "LOW").length,
          new_suppliers_detected: newSuppliers.length,
          known_suppliers_matched: suppliers.length - newSuppliers.length,
          timestamp: new Date().toISOString(),
          source: "GHOST_DISCOVERY_SCANNER",
        }),
        changed_by: null,
      });
    } catch (err) {
      console.error("[Discovery] ⚠️ Audit log write failed:", err);
    }

    console.log(`[Discovery] ✅ Scan complete: ${discoveries.length} PDFs, ${suppliers.length} suppliers`);

    return new Response(
      JSON.stringify({
        status: "DISCOVERY_COMPLETE",
        siphon_state: "connected",
        scan_window_days: 30,
        messages_scanned: processedMessages,
        total_pdfs_found: discoveries.length,
        summary: {
          high_confidence: discoveries.filter((d) => d.confidence === "HIGH").length,
          medium_confidence: discoveries.filter((d) => d.confidence === "MEDIUM").length,
          low_confidence: discoveries.filter((d) => d.confidence === "LOW").length,
          already_siphoned: discoveries.filter((d) => d.is_already_siphoned).length,
        },
        discoveries,
        suppliers,
        new_suppliers: newSuppliers.map((s) => ({
          domain: s.domain,
          sender_names: s.sender_names,
          total_pdfs: s.total_pdfs,
          cadence: s.cadence,
          flag: "NEW_SUPPLIER_DETECTED",
          action: "REQUESTING_ACCRUAL_MAPPING",
        })),
        scan_timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Discovery] ❌ Scan failed: ${errMsg}`);

    return new Response(
      JSON.stringify({
        error: "DISCOVERY_FAILED",
        message: errMsg,
        siphon_state: "error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
