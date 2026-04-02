import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createSovereignClient } from "../_shared/sovereign-client.ts";

// ═══════════════════════════════════════════════════════════════
// GHOST PROCESSOR — Extraction Layer v1.0
//
// ARCHITECTURE: POST-triggered PDF-to-JSON extraction engine
//   1. Accept siphoned_invoice ID + PDF attachment metadata
//   2. Fetch raw PDF content from Microsoft Graph
//   3. Send base64 content to Lovable AI Gateway (Gemini Flash)
//   4. Extract structured financial bones with Zero-Inference Rule
//   5. Update siphoned_invoices → create committed_accrual → feed $A$
//
// ZERO-INFERENCE RULE: If AI confidence < 95% on ANY numeric field,
//   return null and set status = "flagged_for_human_audit"
//   Hallucinations are FORBIDDEN.
//
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
const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

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

  console.log("[Processor] 🔄 Refreshing access token...");

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
    console.error("[Processor] ❌ Token refresh failed:", body);
    throw new Error(`TOKEN_REFRESH_FAILED: ${response.status}`);
  }

  const data = JSON.parse(body);
  console.log("[Processor] ✅ Token refreshed.");
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires_in: data.expires_in,
  };
}

// ═══════════════════════════════════════════════════════════════
// PDF CONTENT FETCH — Download raw attachment bytes from Graph
// ═══════════════════════════════════════════════════════════════
async function fetchAttachmentContent(
  accessToken: string,
  messageId: string,
  attachmentId: string
): Promise<string> {
  const url = `${GRAPH_API_BASE}/me/messages/${messageId}/attachments/${attachmentId}`;

  console.log(`[Processor] 📎 Fetching attachment: ${attachmentId.slice(0, 12)}...`);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[Processor] ❌ Attachment fetch failed:", response.status, errorBody);
    throw new Error(`ATTACHMENT_FETCH_FAILED: ${response.status}`);
  }

  const data = await response.json();

  // Microsoft Graph returns contentBytes as base64 for file attachments
  if (!data.contentBytes) {
    throw new Error("ATTACHMENT_NO_CONTENT: No contentBytes in response");
  }

  return data.contentBytes;
}

// ═══════════════════════════════════════════════════════════════
// AI EXTRACTION — Lovable AI Gateway with tool calling
// ═══════════════════════════════════════════════════════════════
interface ExtractionResult {
  supplier_name: string | null;
  total_amount: number | null;
  tax_amount: number | null;
  invoice_date: string | null;
  due_date: string | null;
  invoice_reference_number: string | null;
  confidence_percent: number;
  extraction_notes: string;
}

async function extractInvoiceData(
  base64Pdf: string,
  senderHint: string,
  subjectHint: string,
  filenameHint: string
): Promise<ExtractionResult> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY is not configured");
  }

  const systemPrompt = `You are a forensic financial document extraction engine. Your ONLY job is to extract structured data from PDF invoices with surgical precision.

ZERO-INFERENCE RULE:
- If you cannot extract a numeric value with ≥95% confidence, return null for that field.
- NEVER guess, estimate, or hallucinate numbers.
- If the document is not an invoice/bill/statement, set confidence_percent to 0.
- Confidence must reflect the LOWEST confidence across all extracted numeric fields.

EXTRACTION TARGETS:
- supplier_name: The company/person issuing the invoice (cleaned, standardized)
- total_amount: The final total amount due (numeric, no currency symbols)
- tax_amount: VAT/tax amount if present (numeric, no currency symbols)
- invoice_date: Date the invoice was issued (ISO 8601 format: YYYY-MM-DD)
- due_date: Payment due date if present (ISO 8601 format: YYYY-MM-DD)
- invoice_reference_number: Invoice number/reference if present
- confidence_percent: Your confidence in the extraction (0-100)
- extraction_notes: Brief note about extraction quality or issues

Context hints (use to validate, not to hallucinate):
- Sender: ${senderHint}
- Subject: ${subjectHint}
- Filename: ${filenameHint}`;

  console.log("[Processor] 🧠 Sending to AI Gateway for extraction...");

  const response = await fetch(AI_GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract all financial data from this PDF invoice attachment. Apply the Zero-Inference Rule strictly.",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:application/pdf;base64,${base64Pdf}`,
              },
            },
          ],
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "extract_invoice_data",
            description: "Extract structured financial data from a PDF invoice with confidence scoring.",
            parameters: {
              type: "object",
              properties: {
                supplier_name: {
                  type: ["string", "null"],
                  description: "The company/entity issuing the invoice, cleaned and standardized",
                },
                total_amount: {
                  type: ["number", "null"],
                  description: "The final total amount due as a decimal number. Null if confidence < 95%",
                },
                tax_amount: {
                  type: ["number", "null"],
                  description: "VAT/tax amount as a decimal number. Null if not present or confidence < 95%",
                },
                invoice_date: {
                  type: ["string", "null"],
                  description: "Invoice issue date in ISO 8601 format (YYYY-MM-DD). Null if not found",
                },
                due_date: {
                  type: ["string", "null"],
                  description: "Payment due date in ISO 8601 format (YYYY-MM-DD). Null if not found",
                },
                invoice_reference_number: {
                  type: ["string", "null"],
                  description: "Invoice number or reference identifier. Null if not found",
                },
                confidence_percent: {
                  type: "number",
                  description: "Overall extraction confidence 0-100. Must reflect lowest confidence across numeric fields",
                },
                extraction_notes: {
                  type: "string",
                  description: "Brief note about extraction quality, issues, or flags",
                },
              },
              required: ["supplier_name", "total_amount", "tax_amount", "invoice_date", "due_date", "invoice_reference_number", "confidence_percent", "extraction_notes"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "extract_invoice_data" } },
    }),
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("AI_RATE_LIMITED: Too many requests. Try again later.");
    }
    if (response.status === 402) {
      throw new Error("AI_PAYMENT_REQUIRED: AI credits exhausted.");
    }
    const errorText = await response.text();
    console.error("[Processor] ❌ AI Gateway error:", response.status, errorText);
    throw new Error(`AI_GATEWAY_ERROR: ${response.status}`);
  }

  const aiResponse = await response.json();

  // Extract tool call result
  const toolCall = aiResponse.choices?.[0]?.message?.tool_calls?.[0];
  if (!toolCall || toolCall.function.name !== "extract_invoice_data") {
    console.error("[Processor] ❌ No tool call in AI response");
    throw new Error("AI_NO_TOOL_CALL: Model did not return structured extraction");
  }

  let extracted: ExtractionResult;
  try {
    extracted = JSON.parse(toolCall.function.arguments);
  } catch {
    console.error("[Processor] ❌ Failed to parse tool call arguments");
    throw new Error("AI_PARSE_FAILED: Could not parse extraction result");
  }

  console.log(`[Processor] 🧠 Extraction complete. Confidence: ${extracted.confidence_percent}%`);
  return extracted;
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
  console.log(`[Processor] 🔒 Authenticated: ${userId.slice(0, 8)}...`);

  try {
    // ═══════════════════════════════════════════════════════
    // PARSE REQUEST — Accept invoice_id or discovery metadata
    // ═══════════════════════════════════════════════════════
    const body = await req.json();
    const { invoice_id, message_id, attachment_id, sender, subject, filename } = body;

    if (!message_id || !attachment_id) {
      return new Response(
        JSON.stringify({ error: "MISSING_PARAMS", message: "message_id and attachment_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[Processor] 📋 Processing: ${filename || "unknown"} from ${sender || "unknown"}`);

    // ═══════════════════════════════════════════════════════
    // STEP 1: Get access token
    // ═══════════════════════════════════════════════════════
    const { data: tokenRecord, error: tokenError } = await supabase
      .from("microsoft_oauth_tokens")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (tokenError || !tokenRecord) {
      return new Response(
        JSON.stringify({ error: "NO_CONNECTION", siphon_state: "disconnected" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
        JSON.stringify({ error: "TOKEN_REFRESH_FAILED", siphon_state: "error" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ═══════════════════════════════════════════════════════
    // STEP 2: Fetch PDF content from Microsoft Graph
    // ═══════════════════════════════════════════════════════
    let base64Pdf: string;
    try {
      base64Pdf = await fetchAttachmentContent(accessToken, message_id, attachment_id);
    } catch (fetchErr) {
      const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      console.error("[Processor] ❌ PDF fetch failed:", errMsg);

      // If we have an existing siphoned_invoices record, mark it
      if (invoice_id) {
        await supabase
          .from("siphoned_invoices")
          .update({
            status: "fetch_failed",
            raw_json: { ...(body.existing_raw_json || {}), fetch_error: errMsg, processor_timestamp: new Date().toISOString() },
          })
          .eq("id", invoice_id)
          .eq("user_id", userId);
      }

      return new Response(
        JSON.stringify({ error: "PDF_FETCH_FAILED", message: errMsg }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ═══════════════════════════════════════════════════════
    // STEP 3: AI Extraction — Zero-Inference Rule Active
    // ═══════════════════════════════════════════════════════
    let extraction: ExtractionResult;
    try {
      extraction = await extractInvoiceData(
        base64Pdf,
        sender || "Unknown",
        subject || "Unknown",
        filename || "Unknown"
      );
    } catch (aiErr) {
      const errMsg = aiErr instanceof Error ? aiErr.message : String(aiErr);
      console.error("[Processor] ❌ AI extraction failed:", errMsg);

      // Mark as flagged — AI could not process
      if (invoice_id) {
        await supabase
          .from("siphoned_invoices")
          .update({
            status: "flagged_for_human_audit",
            raw_json: { ...(body.existing_raw_json || {}), ai_error: errMsg, processor_timestamp: new Date().toISOString() },
          })
          .eq("id", invoice_id)
          .eq("user_id", userId);
      }

      return new Response(
        JSON.stringify({
          error: "AI_EXTRACTION_FAILED",
          message: errMsg,
          status: "flagged_for_human_audit",
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ═══════════════════════════════════════════════════════
    // STEP 4: ZERO-INFERENCE GATE — Confidence check
    // ═══════════════════════════════════════════════════════
    const isFlagged = extraction.confidence_percent < 95 ||
      (extraction.total_amount === null && extraction.tax_amount === null);

    const finalStatus = isFlagged ? "flagged_for_human_audit" : "processed";
    const detectedAmount = extraction.total_amount ?? 0;

    console.log(`[Processor] ${isFlagged ? "⚠️ FLAGGED" : "✅ CLEAN"}: ${finalStatus} | Amount: ${detectedAmount} | Confidence: ${extraction.confidence_percent}%`);

    // ═══════════════════════════════════════════════════════
    // STEP 5: VAULT UPDATE — Upsert siphoned_invoices
    // ═══════════════════════════════════════════════════════
    const dedupKey = `${message_id}::${attachment_id}`;
    const rawJsonPayload = {
      dedup_key: dedupKey,
      message_id: message_id,
      attachment_id: attachment_id,
      sender_address: sender || "Unknown",
      sender_name: sender || "Unknown",
      extraction: {
        supplier_name: extraction.supplier_name,
        total_amount: extraction.total_amount,
        tax_amount: extraction.tax_amount,
        invoice_date: extraction.invoice_date,
        due_date: extraction.due_date,
        invoice_reference_number: extraction.invoice_reference_number,
        confidence_percent: extraction.confidence_percent,
        extraction_notes: extraction.extraction_notes,
      },
      processor_timestamp: new Date().toISOString(),
      processor_version: "1.0",
    };

    let siphonedRecord: { id: string; accrual_entry_id: string | null } | null = null;

    if (invoice_id) {
      // Update existing record
      const { data, error: updateError } = await supabase
        .from("siphoned_invoices")
        .update({
          status: finalStatus,
          amount_detected: detectedAmount,
          raw_json: rawJsonPayload,
        })
        .eq("id", invoice_id)
        .eq("user_id", userId)
        .select("id, accrual_entry_id")
        .maybeSingle();

      if (updateError) {
        console.error("[Processor] ❌ Vault update failed:", updateError.message);
      }
      siphonedRecord = data;
    } else {
      // Insert new record (from discovery — not yet in siphoned_invoices)
      const { data, error: insertError } = await supabase
        .from("siphoned_invoices")
        .insert({
          user_id: userId,
          sender: extraction.supplier_name || sender || "Unknown",
          subject: subject || "(No Subject)",
          attachment_name: filename,
          received_at: new Date().toISOString(),
          status: finalStatus,
          amount_detected: detectedAmount,
          raw_json: rawJsonPayload,
        })
        .select("id, accrual_entry_id")
        .maybeSingle();

      if (insertError) {
        console.error("[Processor] ❌ Vault insert failed:", insertError.message);
      }
      siphonedRecord = data;
    }

    // ═══════════════════════════════════════════════════════
    // STEP 6: THE ABSOLUTE TRUTH CONNECTION ($A$)
    // Only for successfully processed invoices with amounts
    // ═══════════════════════════════════════════════════════
    let accrualId: string | null = null;

    if (finalStatus === "processed" && detectedAmount > 0 && siphonedRecord) {
      // Check if accrual already exists for this invoice
      if (!siphonedRecord.accrual_entry_id) {
        const HAGGERSTON_TENANT_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
        const { data: accrual, error: accrualError } = await supabase
          .from("committed_accruals")
          .insert({
            user_id: userId,
            tenant_id: HAGGERSTON_TENANT_ID,
            vendor_name: extraction.supplier_name || sender || "Unknown Supplier",
            committed_amount: detectedAmount,
            commitment_date: extraction.invoice_date || new Date().toISOString().split("T")[0],
            due_date: extraction.due_date || null,
            description: `Ghost-extracted: ${filename || "PDF"} | Ref: ${extraction.invoice_reference_number || "N/A"}`,
            is_active: true,
            metadata: {
              source: "GHOST_PROCESSOR",
              siphoned_invoice_id: siphonedRecord.id,
              confidence: extraction.confidence_percent,
              tax_amount: extraction.tax_amount,
            },
          })
          .select("id")
          .maybeSingle();

        if (accrualError) {
          console.error("[Processor] ❌ Accrual creation failed:", accrualError.message);
        } else if (accrual) {
          accrualId = accrual.id;

          // Link accrual back to siphoned invoice
          await supabase
            .from("siphoned_invoices")
            .update({ accrual_entry_id: accrualId })
            .eq("id", siphonedRecord.id)
            .eq("user_id", userId);

          console.log(`[Processor] 💰 Accrual created: £${detectedAmount} → $A$ | ID: ${accrualId.slice(0, 8)}...`);

          // ═══════════════════════════════════════════════════
          // SOVEREIGN BRIDGE — Sync accrual to external DB
          // ═══════════════════════════════════════════════════
          try {
            const sovereign = createSovereignClient();
            await sovereign.from("committed_accruals").insert({
              id: accrualId,
              user_id: userId,
              vendor_name: extraction.supplier_name || sender || "Unknown Supplier",
              committed_amount: detectedAmount,
              commitment_date: extraction.invoice_date || new Date().toISOString().split("T")[0],
              due_date: extraction.due_date || null,
              description: `Ghost-extracted: ${filename || "PDF"}`,
              is_active: true,
              metadata: { source: "GHOST_PROCESSOR", sovereign_sync: true, synced_at: new Date().toISOString() },
            });
            console.log(`[Processor] 🔗 SOVEREIGN: Accrual synced to external DB`);
          } catch (sovErr) {
            console.error(`[Processor] ⚠️ SOVEREIGN SYNC FAILED (non-blocking):`, sovErr instanceof Error ? sovErr.message : sovErr);
          }
        }
      } else {
        accrualId = siphonedRecord.accrual_entry_id;
        console.log(`[Processor] ℹ️ Accrual already exists: ${accrualId?.slice(0, 8)}...`);
      }
    }

    // ═══════════════════════════════════════════════════════
    // STEP 7: Audit trail
    // ═══════════════════════════════════════════════════════
    try {
      await supabase.from("system_audit_log").insert({
        table_name: "siphoned_invoices",
        record_id: siphonedRecord?.id || "00000000-0000-0000-0000-000000000000",
        action_type: isFlagged ? "CONFIG_ERROR" : "SYNC_SUCCESS",
        old_data_hash: null,
        new_data_hash: JSON.stringify({
          phase: "GHOST_EXTRACTION",
          user_id: userId,
          status: finalStatus,
          amount: detectedAmount,
          confidence: extraction.confidence_percent,
          supplier: extraction.supplier_name,
          accrual_id: accrualId,
          timestamp: new Date().toISOString(),
          source: "GHOST_PROCESSOR",
        }),
        changed_by: null,
      });
    } catch (err) {
      console.error("[Processor] ⚠️ Audit log write failed:", err);
    }

    console.log(`[Processor] ✅ Complete: ${finalStatus} | £${detectedAmount}`);

    return new Response(
      JSON.stringify({
        status: finalStatus,
        extraction: {
          supplier_name: extraction.supplier_name,
          total_amount: extraction.total_amount,
          tax_amount: extraction.tax_amount,
          invoice_date: extraction.invoice_date,
          due_date: extraction.due_date,
          invoice_reference_number: extraction.invoice_reference_number,
          confidence_percent: extraction.confidence_percent,
          extraction_notes: extraction.extraction_notes,
        },
        amount_detected: detectedAmount,
        accrual_id: accrualId,
        invoice_id: siphonedRecord?.id || invoice_id || null,
        flagged: isFlagged,
        processor_version: "1.0",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Processor] ❌ Fatal: ${errMsg}`);

    try {
      await supabase.from("system_audit_log").insert({
        table_name: "siphoned_invoices",
        record_id: "00000000-0000-0000-0000-000000000000",
        action_type: "ENDPOINT_FAILURE",
        old_data_hash: null,
        new_data_hash: JSON.stringify({
          phase: "GHOST_EXTRACTION",
          user_id: userId,
          error: errMsg,
          timestamp: new Date().toISOString(),
          source: "GHOST_PROCESSOR",
        }),
        changed_by: null,
      });
    } catch (_) { /* silent */ }

    return new Response(
      JSON.stringify({ error: "PROCESSOR_FAILED", message: errMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
