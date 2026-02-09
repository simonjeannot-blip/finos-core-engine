import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ═══════════════════════════════════════════════════════════════
// GHOST SIPHON — Deep Discovery Scanner v4.2.0
//
// v4.2.0 INDUSTRIAL UPGRADE — FULLY AUTONOMOUS:
//   - Client Credentials flow (no user sign-in, no Supabase auth required)
//   - APPLICATION PERMISSIONS: /users/{mailbox}/messages
//   - FIXED Q1 FORENSIC WINDOW: Jan 1 → Feb 9, 2026
//   - Scope: https://graph.microsoft.com/.default
//   - Target mailbox via GHOST_TARGET_MAILBOX secret
//   - User resolved from microsoft_oauth_tokens vault (autonomous)
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

const Q1_START = "2026-01-01T00:00:00Z";
const Q1_END = "2026-02-09T23:59:59Z";

const CONSUMER_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.co.in",
  "hotmail.com", "hotmail.co.uk",
  "outlook.com", "live.com", "live.co.uk", "msn.com",
  "aol.com",
  "icloud.com", "me.com", "mac.com",
  "protonmail.com", "proton.me",
  "zoho.com",
  "yandex.com", "yandex.ru",
  "mail.com",
  "gmx.com", "gmx.co.uk",
  "fastmail.com",
  "tutanota.com", "tuta.io",
]);

const HIGH_CONFIDENCE_KEYWORDS = [
  "invoice", "bill", "statement", "receipt", "remittance",
  "payment", "purchase order", "po#", "credit note", "debit note",
  "inv-", "inv_", "inv #",
  "amount due", "total", "tax", "order", "vat",
  "balance due", "pay by", "due date", "account statement",
  "pro forma", "proforma", "quotation", "quote",
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

  for (const kw of HIGH_CONFIDENCE_KEYWORDS) {
    if (combined.includes(kw)) {
      return {
        score: "HIGH",
        reason: `Keyword match: "${kw}" found in ${subjectLower.includes(kw) ? "subject" : "filename"}`,
      };
    }
  }

  const invoicePattern = /\b(inv|invoice|bill|stmt|statement|order|quote)[_\-\s]?\d*/i;
  if (invoicePattern.test(filename)) {
    return { score: "HIGH", reason: `Filename pattern match: "${filename}"` };
  }

  if (knownSupplierDomains.has(senderDomain)) {
    return { score: "MEDIUM", reason: `Known supplier domain: ${senderDomain}` };
  }

  return { score: "LOW", reason: "Non-consumer business domain PDF — no keyword match" };
}

function analyzeCadence(dates: string[]): string {
  if (dates.length < 2) return "INSUFFICIENT_DATA";
  const sorted = dates.map((d) => new Date(d).getTime()).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push((sorted[i] - sorted[i - 1]) / (1000 * 60 * 60 * 24));
  }
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (avgGap <= 8) return "WEEKLY";
  if (avgGap <= 16) return "BI_WEEKLY";
  if (avgGap <= 35) return "MONTHLY";
  return "IRREGULAR";
}

// ═══════════════════════════════════════════════════════════════
// CLIENT CREDENTIALS TOKEN — Pure machine-to-machine
// ═══════════════════════════════════════════════════════════════
async function acquireAppToken(tenantId: string): Promise<string> {
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!;
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  console.log(`[Discovery ${VERSION}] 🔑 Acquiring app token via client_credentials...`);
  console.log(`[Discovery ${VERSION}] 🏢 Tenant: ${tenantId}`);

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
    console.error(`[Discovery ${VERSION}] ❌ Client credentials token failed:`, body);
    throw new Error(`CLIENT_CREDENTIALS_FAILED: ${response.status} — ${body}`);
  }

  const data = JSON.parse(body);
  console.log(`[Discovery ${VERSION}] ✅ App token acquired. Expires in ${data.expires_in}s`);
  return data.access_token;
}

// ═══════════════════════════════════════════════════════════════
// GRAPH API — Application permissions: /users/{mailbox}/messages
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
  targetMailbox: string
): Promise<GraphMessage[]> {
  const filter = `hasAttachments eq true and receivedDateTime ge ${Q1_START} and receivedDateTime le ${Q1_END}`;
  const select = "id,receivedDateTime,subject,from,hasAttachments";
  const orderBy = "receivedDateTime desc";

  const allMessages: GraphMessage[] = [];
  let nextLink: string | null =
    `${GRAPH_API_BASE}/users/${encodeURIComponent(targetMailbox)}/messages?$filter=${encodeURIComponent(filter)}&$select=${select}&$orderby=${encodeURIComponent(orderBy)}&$top=50`;

  let pageCount = 0;
  const MAX_PAGES = 20;

  while (nextLink && pageCount < MAX_PAGES) {
    console.log(`[Discovery ${VERSION}] 📬 Fetching page ${pageCount + 1} from /users/${targetMailbox}/messages...`);

    const response = await fetch(nextLink, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[Discovery ${VERSION}] ❌ Graph query failed:`, response.status, errorBody);
      throw new Error(`GRAPH_MESSAGES_FAILED: ${response.status} — ${errorBody}`);
    }

    const data = await response.json();
    const messages: GraphMessage[] = data.value || [];
    allMessages.push(...messages);

    nextLink = data["@odata.nextLink"] || null;
    pageCount++;
  }

  console.log(`[Discovery ${VERSION}] 📊 Total messages with attachments: ${allMessages.length} across ${pageCount} page(s)`);
  return allMessages;
}

async function fetchAllAttachments(
  accessToken: string,
  targetMailbox: string,
  messageId: string
): Promise<GraphAttachment[]> {
  const url = `${GRAPH_API_BASE}/users/${encodeURIComponent(targetMailbox)}/messages/${messageId}/attachments?$select=id,name,contentType,size`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    console.warn(`[Discovery ${VERSION}] ⚠️ Could not fetch attachments for ${messageId.slice(0, 12)}...`);
    return [];
  }

  const data = await response.json();
  return data.value || [];
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER — FULLY AUTONOMOUS
//
// Auth model:
//   1. If Supabase auth header present → use that user_id
//   2. If no auth header → resolve user from microsoft_oauth_tokens
//      (single-tenant autonomous mode)
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

  // ═══════════════════════════════════════════════════════
  // AUTONOMOUS AUTH — Resolve user_id + tenant_id
  // No login required. Machine-to-machine only.
  // ═══════════════════════════════════════════════════════
  let userId: string;
  let tenantId: string;

  const authHeader = req.headers.get("authorization");

  if (authHeader && authHeader.startsWith("Bearer ")) {
    // Authenticated caller — use their identity
    const supabaseAuth = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();

    if (!authError && user) {
      userId = user.id;
      console.log(`[Discovery ${VERSION}] 🔒 Authenticated caller: ${userId.slice(0, 8)}...`);

      const { data: tokenRecord } = await supabase
        .from("microsoft_oauth_tokens")
        .select("tenant_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (!tokenRecord?.tenant_id) {
        return new Response(
          JSON.stringify({ error: "NO_TENANT", message: "No tenant_id for authenticated user.", siphon_state: "disconnected" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      tenantId = tokenRecord.tenant_id;
    } else {
      // Auth header present but invalid — fall through to autonomous
      console.warn(`[Discovery ${VERSION}] ⚠️ Auth header present but invalid. Falling through to autonomous mode.`);
      const resolved = await resolveAutonomousUser(supabase);
      if (!resolved) {
        return new Response(
          JSON.stringify({ error: "NO_CONNECTED_USER", message: "No microsoft_oauth_tokens record found.", siphon_state: "disconnected" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      userId = resolved.userId;
      tenantId = resolved.tenantId;
    }
  } else {
    // No auth header — AUTONOMOUS MODE
    console.log(`[Discovery ${VERSION}] 🤖 AUTONOMOUS MODE — No auth header. Resolving user from vault...`);
    const resolved = await resolveAutonomousUser(supabase);
    if (!resolved) {
      return new Response(
        JSON.stringify({ error: "NO_CONNECTED_USER", message: "No microsoft_oauth_tokens record found.", siphon_state: "disconnected" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    userId = resolved.userId;
    tenantId = resolved.tenantId;
  }

  const scanId = crypto.randomUUID();
  console.log(`[Discovery ${VERSION}] 🆔 Scan ID: ${scanId.slice(0, 8)}...`);
  console.log(`[Discovery ${VERSION}] 👤 User: ${userId.slice(0, 8)}... | Tenant: ${tenantId}`);
  console.log(`[Discovery ${VERSION}] 📅 Q1 Forensic Window: ${Q1_START} → ${Q1_END}`);

  try {
    // ═══════════════════════════════════════════════════════
    // STEP 1: Resolve target mailbox
    // ═══════════════════════════════════════════════════════
    const targetMailbox = Deno.env.get("GHOST_TARGET_MAILBOX");
    if (!targetMailbox) {
      console.error(`[Discovery ${VERSION}] ❌ GHOST_TARGET_MAILBOX secret not configured.`);
      return new Response(
        JSON.stringify({ error: "NO_TARGET_MAILBOX", message: "GHOST_TARGET_MAILBOX secret is required.", siphon_state: "error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Discovery ${VERSION}] 📧 Target mailbox: ${targetMailbox}`);

    // ═══════════════════════════════════════════════════════
    // STEP 2: Acquire app-level token (client_credentials)
    // ═══════════════════════════════════════════════════════
    let accessToken: string;
    try {
      accessToken = await acquireAppToken(tenantId);
    } catch (tokenErr) {
      const errMsg = tokenErr instanceof Error ? tokenErr.message : String(tokenErr);
      return new Response(
        JSON.stringify({ error: "TOKEN_ACQUISITION_FAILED", message: errMsg, siphon_state: "error" }),
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
        const domainMatch = v.vendor_name.match(/@?([\w.-]+\.\w{2,})/);
        if (domainMatch) knownSupplierDomains.add(domainMatch[1].toLowerCase());
      }
    }

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

    console.log(`[Discovery ${VERSION}] 🏭 Known supplier domains: ${knownSupplierDomains.size}`);

    // ═══════════════════════════════════════════════════════
    // STEP 4: Full inbox scan — APPLICATION PERMISSIONS
    // ═══════════════════════════════════════════════════════
    const messages = await fetchAllMessagesWithAttachments(accessToken, targetMailbox);

    // ═══════════════════════════════════════════════════════
    // STEP 5: Extract, classify, map — RAW LOG PROTOCOL
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

    if (siphonedVendors) {
      for (const sv of siphonedVendors) {
        const dedupKey = (sv.raw_json as Record<string, string>)?.dedup_key;
        if (dedupKey) existingDedupKeys.add(dedupKey);
      }
    }

    let processedMessages = 0;
    let totalAttachmentsSeen = 0;
    let pdfAccepted = 0;
    let nonPdfRejected = 0;
    let consumerDomainSkipped = 0;

    for (const message of messages) {
      const senderAddress = message.from?.emailAddress?.address || "unknown@unknown";
      const senderName = message.from?.emailAddress?.name || senderAddress;
      const senderDomain = senderAddress.split("@")[1]?.toLowerCase() || "unknown";

      const allAttachments = await fetchAllAttachments(accessToken, targetMailbox, message.id);
      processedMessages++;

      for (const att of allAttachments) {
        totalAttachmentsSeen++;
        const isPdf = att.contentType === "application/pdf" || att.name?.toLowerCase().endsWith(".pdf");
        const isConsumer = CONSUMER_DOMAINS.has(senderDomain);

        if (!isPdf) {
          nonPdfRejected++;
          console.log(`[Discovery ${VERSION}] 📎 REJECTED (non-PDF) | ${senderDomain} | "${att.name}" | type=${att.contentType} | size=${att.size}`);
          continue;
        }

        if (isConsumer) {
          consumerDomainSkipped++;
          console.log(`[Discovery ${VERSION}] 🚫 SKIPPED (consumer domain) | ${senderDomain} | "${att.name}" | ${senderAddress}`);
          continue;
        }

        pdfAccepted++;
        const dedupKey = `${message.id}::${att.id}`;

        if (!senderDateMap[senderDomain]) senderDateMap[senderDomain] = [];
        senderDateMap[senderDomain].push(message.receivedDateTime);

        const { score, reason } = classifyConfidence(
          message.subject || "", att.name || "", senderDomain, knownSupplierDomains
        );

        const isKnown = knownSupplierDomains.has(senderDomain) || knownVendorNames.has(senderName.toLowerCase());

        discoveries.push({
          message_id: message.id,
          sender_name: senderName,
          sender_address: senderAddress,
          sender_domain: senderDomain,
          subject: message.subject || "(No Subject)",
          filename: att.name,
          file_size: att.size,
          received_at: message.receivedDateTime,
          confidence: score,
          confidence_reason: reason,
          is_known_supplier: isKnown,
          is_already_siphoned: existingDedupKeys.has(dedupKey),
        });

        console.log(`[Discovery ${VERSION}] ✅ ACCEPTED | ${score} | ${senderDomain} | "${att.name}" | ${reason}`);
      }
    }

    console.log(`[Discovery ${VERSION}] 📊 RAW LOG SUMMARY:`);
    console.log(`  Messages processed: ${processedMessages}`);
    console.log(`  Total attachments seen: ${totalAttachmentsSeen}`);
    console.log(`  PDFs accepted: ${pdfAccepted}`);
    console.log(`  Non-PDFs rejected: ${nonPdfRejected}`);
    console.log(`  Consumer domain skipped: ${consumerDomainSkipped}`);

    // ═══════════════════════════════════════════════════════
    // STEP 5.5: PERSIST to discovered_invoices
    // ═══════════════════════════════════════════════════════
    if (discoveries.length > 0) {
      console.log(`[Discovery ${VERSION}] 💾 Persisting ${discoveries.length} discoveries...`);

      await supabase.from("discovered_invoices").delete().eq("user_id", userId);

      const batchSize = 50;
      for (let i = 0; i < discoveries.length; i += batchSize) {
        const batch = discoveries.slice(i, i + batchSize).map((d) => ({
          user_id: userId,
          scan_id: scanId,
          message_id: d.message_id,
          sender_name: d.sender_name,
          sender_address: d.sender_address,
          sender_domain: d.sender_domain,
          subject: d.subject,
          filename: d.filename,
          file_size: d.file_size,
          received_at: d.received_at,
          confidence: d.confidence,
          confidence_reason: d.confidence_reason,
          is_known_supplier: d.is_known_supplier,
          is_already_siphoned: d.is_already_siphoned,
        }));

        const { error: insertError } = await supabase.from("discovered_invoices").insert(batch);
        if (insertError) {
          console.error(`[Discovery ${VERSION}] ❌ Batch insert failed:`, insertError.message);
        } else {
          console.log(`[Discovery ${VERSION}] 💾 Batch ${Math.floor(i / batchSize) + 1} persisted (${batch.length} rows)`);
        }
      }
    } else {
      console.log(`[Discovery ${VERSION}] ⚠️ ZERO discoveries — nothing to persist`);
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
          domain: d.sender_domain, sender_names: [], total_pdfs: 0,
          cadence: "INSUFFICIENT_DATA", is_known: d.is_known_supplier, highest_confidence: d.confidence,
        };
      }
      const sp = supplierMap[d.sender_domain];
      sp.total_pdfs++;
      if (!sp.sender_names.includes(d.sender_name)) sp.sender_names.push(d.sender_name);
      const rank = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      if (rank[d.confidence] > rank[sp.highest_confidence]) sp.highest_confidence = d.confidence;
    }

    for (const domain of Object.keys(supplierMap)) {
      if (senderDateMap[domain]) supplierMap[domain].cadence = analyzeCadence(senderDateMap[domain]);
    }

    const suppliers = Object.values(supplierMap);
    const newSuppliers = suppliers.filter((s) => !s.is_known);

    // ═══════════════════════════════════════════════════════
    // STEP 7: Audit
    // ═══════════════════════════════════════════════════════
    try {
      await supabase.from("system_audit_log").insert({
        table_name: "discovered_invoices",
        record_id: "00000000-0000-0000-0000-000000000000",
        action_type: "SYNC_SUCCESS",
        old_data_hash: null,
        new_data_hash: JSON.stringify({
          phase: "DISCOVERY_SCAN", version: VERSION, architecture: "CLIENT_CREDENTIALS_AUTONOMOUS",
          scan_id: scanId, user_id: userId, target_mailbox: targetMailbox,
          q1_window: { start: Q1_START, end: Q1_END },
          messages_scanned: processedMessages, pdfs_accepted: pdfAccepted,
          total_pdfs_found: discoveries.length,
          high: discoveries.filter((d) => d.confidence === "HIGH").length,
          medium: discoveries.filter((d) => d.confidence === "MEDIUM").length,
          low: discoveries.filter((d) => d.confidence === "LOW").length,
          new_suppliers: newSuppliers.length,
          timestamp: new Date().toISOString(), source: "GHOST_DISCOVERY_SCANNER",
        }),
        changed_by: null,
      });
    } catch (err) {
      console.error(`[Discovery ${VERSION}] ⚠️ Audit log write failed:`, err);
    }

    console.log(`[Discovery ${VERSION}] ✅ SCAN COMPLETE: ${discoveries.length} PDFs, ${suppliers.length} suppliers`);

    return new Response(
      JSON.stringify({
        status: "DISCOVERY_COMPLETE", siphon_state: "connected", version: VERSION,
        architecture: "CLIENT_CREDENTIALS_AUTONOMOUS",
        scan_id: scanId, q1_window: { start: Q1_START, end: Q1_END },
        target_mailbox: targetMailbox, messages_scanned: processedMessages,
        total_pdfs_found: discoveries.length,
        raw_log: { total_attachments_seen: totalAttachmentsSeen, pdfs_accepted: pdfAccepted, non_pdfs_rejected: nonPdfRejected, consumer_domain_skipped: consumerDomainSkipped },
        summary: {
          high_confidence: discoveries.filter((d) => d.confidence === "HIGH").length,
          medium_confidence: discoveries.filter((d) => d.confidence === "MEDIUM").length,
          low_confidence: discoveries.filter((d) => d.confidence === "LOW").length,
          already_siphoned: discoveries.filter((d) => d.is_already_siphoned).length,
        },
        discoveries, suppliers,
        new_suppliers: newSuppliers.map((s) => ({
          domain: s.domain, sender_names: s.sender_names, total_pdfs: s.total_pdfs,
          cadence: s.cadence, flag: "NEW_SUPPLIER_DETECTED", action: "REQUESTING_ACCRUAL_MAPPING",
        })),
        scan_timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Discovery ${VERSION}] ❌ Scan failed: ${errMsg}`);
    return new Response(
      JSON.stringify({ error: "DISCOVERY_FAILED", message: errMsg, siphon_state: "error", version: VERSION, scan_id: scanId }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ═══════════════════════════════════════════════════════════════
// AUTONOMOUS USER RESOLVER
// Looks up the first microsoft_oauth_tokens record to determine
// user_id + tenant_id without requiring Supabase auth.
// ═══════════════════════════════════════════════════════════════
async function resolveAutonomousUser(
  supabase: ReturnType<typeof createClient>
): Promise<{ userId: string; tenantId: string } | null> {
  const { data, error } = await supabase
    .from("microsoft_oauth_tokens")
    .select("user_id, tenant_id")
    .not("tenant_id", "is", null)
    .limit(1)
    .maybeSingle();

  if (error || !data?.user_id || !data?.tenant_id) {
    console.error(`[Discovery ${VERSION}] ❌ Autonomous resolver failed:`, error?.message || "No records");
    return null;
  }

  console.log(`[Discovery ${VERSION}] 🤖 Autonomous resolver: user=${data.user_id.slice(0, 8)}... tenant=${data.tenant_id}`);
  return { userId: data.user_id, tenantId: data.tenant_id };
}
