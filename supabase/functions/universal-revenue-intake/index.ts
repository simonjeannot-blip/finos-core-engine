import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ═══════════════════════════════════════════════════════════════
// MODUS ARMS — SOVEREIGN INTAKE ENGINE v4.1
//
// ARCHITECTURE: Raw-First, Parse-Second, AI-Enhanced
// 1. Authenticate (Header OR URL fallback)
// 2. LAND raw payload into raw_data_stream (PENDING)
// 3. BRANCH:
//    A) Structured data (?ts/?tz + vendor) → direct ledger write
//    B) Image only → Lovable AI Gateway parsing → ledger write
//    B-FALLBACK) AI fails → placeholder ledger entry (never ERROR)
// 4. Return 200 with status — data is ALWAYS safe
//
// V4.1 PATCH: Merchant & Non-VAT Protocol
// - Accepts vat_amount: 0 for non-VAT-registered vendors
// - Merchant card slips: AI deduces VAT as Gross / 6
// - Metadata: vat_status tag (STANDARD, ZERO_OR_EXEMPT, DEDUCED)
// ═══════════════════════════════════════════════════════════════

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// ═══════════════════════════════════════════════════════════════
// URL PARAMETER MAPPING
// ?ts=<gross> → Standard Tax Revenue (20% VAT auto-calculated)
// ?tz=<gross> → Zero Tax Revenue (0% VAT)
// ?aid=<uuid> → Attribution ID for Click-to-Cover
// ?key=<api_key> → Fallback auth for header-less hardware
// ?vendor=<name> → Vendor name
// ?date=<YYYY-MM-DD> → Transaction date
// ?source=<name> → Data source identifier (DOJO, EPOS, BANK)
// ?image=<path> → Storage path to receipt image
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// AI RECEIPT PARSING — Gemini System Prompt
// ═══════════════════════════════════════════════════════════════
const RECEIPT_SYSTEM_PROMPT = `You are a financial document parser for the Absolute Truth Protocol.

Your task is to analyze receipt/invoice images and extract structured financial data.

CATEGORIES (the six variables of the Absolute Truth formula S = (R-P) - (O+V+D+A)):
- R (Revenue): Income received. IMPORTANT: Deduct any tips from gross revenue.
- P (Product/COGS): Direct costs of goods sold - food, materials, inventory.
- O (Operations): Operating expenses - utilities, rent, software, services.
- V (VAT): Value Added Tax amounts.
- D (Director's Loan Account): Owner drawings or loan repayments.
- A (Accruals/Assets): Prepaid expenses, equipment, or deferred costs.

RULES:
1. Identify the vendor name and transaction date.
2. Categorize each line item into R, P, O, V, D, or A.
3. For multi-item receipts, split items appropriately (e.g., food → P, cleaning supplies → O).
4. Calculate net_amount (before VAT), vat_amount, and gross_amount for each item.
5. Use pot_id for sub-categorization (e.g., P1 for food, P2 for packaging, O1 for utilities).
6. Deduct tips from Revenue entries.

VAT HANDLING — CRITICAL:
- If VAT is explicitly listed on the receipt, extract those figures directly.
- If the receipt is a MERCHANT CARD SLIP (e.g., Manhattan, SumUp, Zettle, iZettle, Square, Dojo, WorldPay) that shows only a total with no VAT breakdown, DEDUCE VAT as: vat_amount = gross_amount / 6, net_amount = gross_amount - vat_amount. Set vat_status to "DEDUCED".
- If the vendor is clearly NOT VAT REGISTERED (e.g., small market stall, no VAT number on receipt, receipt states "not VAT registered"), return vat_amount: 0 and net_amount = gross_amount. Set vat_status to "ZERO_OR_EXEMPT".
- Otherwise, assume standard UK VAT at 20% (VAT = Gross / 6). Set vat_status to "STANDARD".

GRACEFUL DEGRADATION - CRITICAL:
- If the receipt is unclear, messy, or missing data points, DO NOT FAIL.
- If you cannot determine a numerical value (net_amount, vat_amount, gross_amount), return 0.
- If you cannot determine the vendor name, return "Unknown Vendor".
- If you cannot determine the transaction date, return today's date.
- If you cannot determine the category, default to "O" (Operations).
- ALWAYS return at least one item, even if all values are 0.

OUTPUT FORMAT (JSON array only, no markdown):
[
  {
    "transaction_date": "YYYY-MM-DD",
    "vendor_name": "string",
    "category": "R" | "P" | "O" | "V" | "D" | "A",
    "pot_id": "string or null",
    "net_amount": number,
    "vat_amount": number,
    "gross_amount": number,
    "description": "brief item description",
    "vat_status": "STANDARD" | "DEDUCED" | "ZERO_OR_EXEMPT"
  }
]

Return ONLY the JSON array. No explanations, no markdown code blocks.`;

// ═══════════════════════════════════════════════════════════════
// JSON SHIELD — Robust extraction with error recovery
// ═══════════════════════════════════════════════════════════════
function extractJsonFromResponse(response: string): unknown {
  let cleaned = response
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  const jsonStart = cleaned.indexOf("[");
  const jsonEnd = cleaned.lastIndexOf("]");
  const objStart = cleaned.indexOf("{");
  const objEnd = cleaned.lastIndexOf("}");

  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
  } else if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
    cleaned = "[" + cleaned.substring(objStart, objEnd + 1) + "]";
  } else {
    throw new Error("MALFORMED_AI_RESPONSE: No JSON found in response");
  }

  cleaned = cleaned
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    .replace(/'/g, '"')
    .replace(/\n/g, " ")
    .replace(/\r/g, "");

  try {
    return JSON.parse(cleaned);
  } catch (parseError) {
    console.error("JSON parse failed after cleanup:", cleaned.substring(0, 500));
    throw new Error(`MALFORMED_AI_RESPONSE: ${parseError instanceof Error ? parseError.message : "Parse error"}`);
  }
}

interface RawStreamRecord {
  id: string;
  source: string;
  payload: Record<string, unknown>;
  status: string;
  error_detail: string | null;
  processed_at: string | null;
  ledger_entry_id: string | null;
  user_id: string;
  created_at: string;
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: "Only POST and GET accepted" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const url = new URL(req.url);

    // ═══════════════════════════════════════════════════════════
    // STEP 1: ZERO-FRICTION AUTH (Header OR URL Fallback)
    // ═══════════════════════════════════════════════════════════
    const intakeApiKey = Deno.env.get("INTAKE_ARM_KEY");

    if (!intakeApiKey) {
      console.error("❌ INTAKE_ARM_KEY secret is not configured");
      return new Response(
        JSON.stringify({ error: "AUTH_KEY_MISSING", message: "Server config error: API key not set" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const headerKey = req.headers.get("x-api-key");
    const urlKey = url.searchParams.get("key");
    const providedKey = headerKey || urlKey;

    if (!providedKey || providedKey !== intakeApiKey) {
      console.warn("🚫 Auth failed:", providedKey ? "invalid key" : "no key provided");
      return new Response(
        JSON.stringify({
          error: providedKey ? "FORBIDDEN" : "UNAUTHORIZED",
          message: providedKey
            ? "Invalid API key"
            : "Missing auth. Provide X-API-KEY header or ?key= parameter",
        }),
        { status: providedKey ? 403 : 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authMethod = headerKey ? "header" : "url_param";
    console.log(`✅ Auth validated via ${authMethod}`);

    // ═══════════════════════════════════════════════════════════
    // STEP 2: CAPTURE EVERYTHING — Build Raw Payload
    // ═══════════════════════════════════════════════════════════
    let bodyPayload: Record<string, unknown> = {};

    if (req.method === "POST") {
      try {
        bodyPayload = await req.json();
      } catch {
        console.log("ℹ️ No JSON body, using URL parameters only");
      }
    }

    const urlParams: Record<string, string | null> = {
      ts: url.searchParams.get("ts"),
      tz: url.searchParams.get("tz"),
      aid: url.searchParams.get("aid"),
      vendor: url.searchParams.get("vendor"),
      date: url.searchParams.get("date"),
      image: url.searchParams.get("image"),
      source: url.searchParams.get("source"),
    };

    const rawPayload: Record<string, unknown> = {
      ...bodyPayload,
      _url_params: urlParams,
      _auth_method: authMethod,
      _received_at: new Date().toISOString(),
      _method: req.method,
    };

    const dataSource = (
      urlParams.source ||
      (bodyPayload.source as string) ||
      "UNKNOWN"
    ).toUpperCase();

    // ═══════════════════════════════════════════════════════════
    // STEP 3: LAND RAW DATA (The Safety Net)
    // ═══════════════════════════════════════════════════════════
    const { data: adminProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "super_admin")
      .limit(1)
      .single();

    if (profileError || !adminProfile) {
      console.error("❌ No admin user found:", profileError);
      return new Response(
        JSON.stringify({ error: "SYSTEM_ERROR", message: "No admin user configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: streamRecord, error: streamError } = await supabase
      .from("raw_data_stream")
      .insert({
        source: dataSource,
        payload: rawPayload,
        status: "PENDING",
        user_id: adminProfile.id,
      })
      .select()
      .single();

    if (streamError || !streamRecord) {
      console.error("❌ CRITICAL: Failed to land raw data:", streamError);
      return new Response(
        JSON.stringify({
          error: "STREAM_WRITE_FAILED",
          message: "Failed to capture raw data. Retry the request.",
          details: streamError?.message,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const streamId = (streamRecord as RawStreamRecord).id;
    console.log(`📦 Raw data landed: stream_id=${streamId}, source=${dataSource}`);

    // ═══════════════════════════════════════════════════════════
    // STEP 4: THE SEQUENTIAL LOCK — Parse & Write to Ledger
    // Branches into: A) Structured Data  B) AI Image Parsing
    // ═══════════════════════════════════════════════════════════

    try {
      // --- Parse amounts from URL params or body ---
      let amountGross: number | undefined;
      let amountVat: number | undefined;

      if (urlParams.ts) {
        const gross = parseFloat(urlParams.ts);
        if (!isNaN(gross)) {
          amountGross = gross;
          amountVat = Math.round((gross * (20 / 120)) * 100) / 100;
          console.log(`📊 Standard Tax: Gross £${gross}, VAT £${amountVat}`);
        }
      }

      if (urlParams.tz) {
        const gross = parseFloat(urlParams.tz);
        if (!isNaN(gross)) {
          amountGross = gross;
          amountVat = 0;
          console.log(`📊 Zero Tax: Gross £${gross}, VAT £0`);
        }
      }

      if (amountGross === undefined) {
        amountGross = typeof bodyPayload.amount_gross === "number" ? bodyPayload.amount_gross : undefined;
      }
      if (amountVat === undefined) {
        amountVat = typeof bodyPayload.amount_vat === "number" ? bodyPayload.amount_vat : undefined;
      }

      const vendorName = (
        urlParams.vendor ||
        (bodyPayload.vendor_name as string) ||
        ""
      ).trim();

      const imagePath = urlParams.image || (bodyPayload.image_path as string) || null;
      const transactionDate = urlParams.date || (bodyPayload.transaction_date as string) || new Date().toISOString().split("T")[0];

      // --- Determine pathway ---
      const hasStructuredData = amountGross !== undefined && !isNaN(amountGross) && amountVat !== undefined && !!vendorName;

      // ═════════════════════════════════════════════════════════
      // BRANCH A: STRUCTURED DATA PATHWAY
      // Direct ledger write from URL params or body data
      // ═════════════════════════════════════════════════════════
      if (hasStructuredData) {
        console.log("📋 BRANCH A: Structured data pathway");

        const netAmount = amountGross! - amountVat!;

        // Image verification (optional)
        let verifiedImageUrl: string | null = null;
        if (imagePath) {
          const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(imagePath);
          if (urlData?.publicUrl) {
            const verifyResponse = await fetch(urlData.publicUrl, { method: "HEAD" });
            if (verifyResponse.ok) {
              verifiedImageUrl = urlData.publicUrl;
              console.log(`✅ Image verified`);
            }
          }
        }

        // Attribution validation (optional)
        let validatedAttributionId: string | null = null;
        const attributionId = urlParams.aid || (bodyPayload.attribution_id as string);
        if (attributionId) {
          const { data: leadData } = await supabase
            .from("leads")
            .select("attribution_id")
            .eq("attribution_id", attributionId)
            .single();
          if (leadData) {
            validatedAttributionId = attributionId;
            console.log(`🔗 Attribution linked: ${validatedAttributionId}`);
          }
        }

        // Determine VAT status for metadata
        const vatStatus = amountVat === 0 ? "ZERO_OR_EXEMPT" : urlParams.tz ? "ZERO_OR_EXEMPT" : "STANDARD";

        // Commit to ledger
        const { data: ledgerEntry, error: ledgerError } = await supabase
          .from("financial_ledger")
          .insert({
            user_id: adminProfile.id,
            transaction_date: transactionDate,
            vendor_name: vendorName,
            category: "R" as const,
            net_amount: netAmount,
            vat_amount: amountVat,
            gross_amount: amountGross,
            attribution_id: validatedAttributionId,
            metadata: {
              source: "universal-revenue-intake",
              data_source: dataSource,
              stream_id: streamId,
              payment_method: (bodyPayload.payment_method as string) || "unknown",
              intake_timestamp: new Date().toISOString(),
              auth_method: authMethod,
              image_url: verifiedImageUrl,
              url_params: urlParams,
              vat_status: vatStatus,
            },
          })
          .select("id")
          .single();

        if (ledgerError || !ledgerEntry) {
          throw new Error(`LEDGER_WRITE_FAILED: ${ledgerError?.message || "Unknown insert error"}`);
        }

        console.log(`✅ Ledger entry created: ${ledgerEntry.id}`);

        // Mark stream as PROCESSED
        await supabase
          .from("raw_data_stream")
          .update({
            status: "PROCESSED",
            processed_at: new Date().toISOString(),
            ledger_entry_id: ledgerEntry.id,
          })
          .eq("id", streamId);

        // Fetch updated S-Value
        const { data: truthData } = await supabase
          .from("absolute_truth_calculator")
          .select("s_value, r_total")
          .eq("user_id", adminProfile.id)
          .single();

        return new Response(
          JSON.stringify({
            success: true,
            message: "Revenue intake processed — Absolute Truth updated",
            entries_count: 1,
            data: {
              stream_id: streamId,
              entry_id: ledgerEntry.id,
              entries_count: 1,
              net_revenue: netAmount,
              gross_amount: amountGross,
              vat_amount: amountVat,
              vendor: vendorName,
              source: dataSource,
              attribution_id: validatedAttributionId,
              image_url: verifiedImageUrl,
              absolute_truth: {
                s_value: truthData?.s_value ?? 0,
                r_total: truthData?.r_total ?? 0,
              },
              pipeline: "COMPLETE",
              auth_method: authMethod,
              timestamp: new Date().toISOString(),
            },
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ═════════════════════════════════════════════════════════
      // BRANCH B: AI RECEIPT PARSING PATHWAY
      // Image provided → Lovable AI Gateway → ledger write
      // FALLBACK: If AI fails, create placeholder entry
      // ═════════════════════════════════════════════════════════
      if (imagePath) {
        console.log("🤖 BRANCH B: AI receipt parsing pathway");

        const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
        if (!LOVABLE_API_KEY) {
          console.error("❌ LOVABLE_API_KEY not configured — using fallback");
        }

        // 1. Resolve image public URL from storage path
        const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(imagePath);
        if (!urlData?.publicUrl) {
          throw new Error(`IMAGE_RESOLVE_FAILED: Could not resolve public URL for ${imagePath}`);
        }

        const imagePublicUrl = urlData.publicUrl;
        console.log(`🖼️ Image resolved: ${imagePublicUrl}`);

        // 2. Fetch image and convert to base64
        console.log("📥 Fetching image for AI analysis...");
        const imageResponse = await fetch(imagePublicUrl);
        if (!imageResponse.ok) {
          throw new Error(`IMAGE_FETCH_FAILED: HTTP ${imageResponse.status} fetching ${imagePublicUrl}`);
        }

        const imageBuffer = await imageResponse.arrayBuffer();
        const base64Image = btoa(
          new Uint8Array(imageBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
        );

        const mimeType = imagePath.toLowerCase().includes(".png") ? "image/png" : "image/jpeg";
        const dataUri = `data:${mimeType};base64,${base64Image}`;
        console.log(`📦 Image encoded: ${(imageBuffer.byteLength / 1024).toFixed(0)}KB as ${mimeType}`);

        // 3. AI PARSING — Try Lovable AI Gateway, then fallback
        let sanitizedItems: Array<{
          transaction_date: string;
          vendor_name: string;
          category: string;
          pot_id: string | null;
          net_amount: number;
          vat_amount: number;
          gross_amount: number;
          description: string;
          vat_status: string;
        }>;
        let aiParsed = false;
        let aiError: string | null = null;

        if (LOVABLE_API_KEY) {
          try {
            console.log("🧠 Calling Lovable AI Gateway (google/gemini-2.5-flash) with 60s timeout...");

            const aiController = new AbortController();
            const aiTimeout = setTimeout(() => aiController.abort(), 60000);

            const aiResponse = await fetch(
              "https://ai.gateway.lovable.dev/v1/chat/completions",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${LOVABLE_API_KEY}`,
                },
                body: JSON.stringify({
                  model: "google/gemini-2.5-flash",
                  messages: [
                    {
                      role: "user",
                      content: [
                        { type: "text", text: RECEIPT_SYSTEM_PROMPT },
                        { type: "image_url", image_url: { url: dataUri } },
                      ],
                    },
                  ],
                  temperature: 0.1,
                  max_tokens: 4096,
                }),
                signal: aiController.signal,
              }
            );

            clearTimeout(aiTimeout);

            if (!aiResponse.ok) {
              const errorText = await aiResponse.text();
              console.error(`❌ AI Gateway error: ${aiResponse.status}`, errorText.substring(0, 300));
              throw new Error(`AI_GATEWAY_ERR: HTTP ${aiResponse.status}`);
            }

            const aiData = await aiResponse.json();
            const textResponse = aiData.choices?.[0]?.message?.content;

            if (!textResponse) {
              console.error("❌ No content from AI Gateway", JSON.stringify(aiData).substring(0, 300));
              throw new Error("AI_EMPTY_RESPONSE: Gateway returned no content");
            }

            console.log("📄 AI Gateway response received, parsing...");

            // JSON Shield — Parse with robust error handling
            const extracted = extractJsonFromResponse(textResponse);
            const parsedItems = Array.isArray(extracted) ? extracted : [extracted];
            console.log(`✅ Parsed ${parsedItems.length} items from receipt`);

            // Sanitize with graceful defaults
            sanitizedItems = parsedItems.map((item: unknown, index: number) => {
              const i = item as Record<string, unknown>;
              const vatAmt = typeof i.vat_amount === "number" ? i.vat_amount : parseFloat(String(i.vat_amount)) || 0;
              const grossAmt = typeof i.gross_amount === "number" ? i.gross_amount : parseFloat(String(i.gross_amount)) || 0;
              const netAmt = typeof i.net_amount === "number" ? i.net_amount : parseFloat(String(i.net_amount)) || 0;

              // Determine vat_status from AI response or deduce
              let vatStatus = typeof i.vat_status === "string" ? i.vat_status : "STANDARD";
              if (vatAmt === 0 && grossAmt > 0) {
                vatStatus = "ZERO_OR_EXEMPT";
              }

              return {
                transaction_date: typeof i.transaction_date === "string" ? i.transaction_date : transactionDate,
                vendor_name: typeof i.vendor_name === "string" && i.vendor_name.trim() ? i.vendor_name : "Manual Entry Needed",
                category: ["R", "P", "O", "V", "D", "A"].includes(i.category as string) ? (i.category as string) : "O",
                pot_id: typeof i.pot_id === "string" ? i.pot_id : null,
                net_amount: netAmt,
                vat_amount: vatAmt,
                gross_amount: grossAmt,
                description: typeof i.description === "string" ? i.description : `Item ${index + 1}`,
                vat_status: vatStatus,
              };
            });

            aiParsed = true;

          } catch (aiErr) {
            const errMsg = aiErr instanceof Error ? aiErr.message : String(aiErr);

            // Detect abort/timeout
            if (aiErr instanceof Error && aiErr.name === "AbortError") {
              aiError = "AI_TIMEOUT_60S: AI Gateway did not respond within 60 seconds";
            } else {
              aiError = errMsg;
            }

            console.warn(`⚠️ AI parsing failed: ${aiError} — using FALLBACK`);
          }
        }

        // ═══════════════════════════════════════════════════════
        // FALLBACK: AI failed — create placeholder ledger entry
        // The receipt image is preserved; human review needed
        // ═══════════════════════════════════════════════════════
        if (!aiParsed) {
          console.log("🔄 BRANCH B FALLBACK: Creating placeholder ledger entry");
          sanitizedItems = [{
            transaction_date: transactionDate,
            vendor_name: "Manual Entry Needed",
            category: "O",
            pot_id: null,
            net_amount: 0,
            vat_amount: 0,
            gross_amount: 0,
            description: `Receipt captured — AI review pending. ${aiError ? `Reason: ${aiError}` : "No AI key available."}`,
            vat_status: "ZERO_OR_EXEMPT",
          }];

        }

        // 4. Create audit log entry
        console.log("📝 Creating audit log entry...");
        const { data: auditLog, error: auditError } = await supabase
          .from("ai_audit_log")
          .insert({
            user_id: adminProfile.id,
            image_url: imagePublicUrl,
            raw_json: sanitizedItems,
          })
          .select()
          .single();

        if (auditError) {
          console.error("❌ Audit log failed:", auditError);
          throw new Error(`DB_AUDIT_ERR: ${auditError.message}`);
        }

        console.log(`✅ Audit log created: ${auditLog.id}`);

        // 5. Create ledger entries
        console.log("📊 Creating ledger entries...");
        const ledgerEntries = sanitizedItems.map((item) => ({
          user_id: adminProfile.id,
          audit_id: auditLog.id,
          transaction_date: item.transaction_date,
          vendor_name: item.vendor_name,
          category: item.category,
          pot_id: item.pot_id,
          net_amount: item.net_amount,
          vat_amount: item.vat_amount,
          gross_amount: item.gross_amount,
          metadata: {
            description: item.description,
            source: "universal-revenue-intake",
            data_source: dataSource,
            stream_id: streamId,
            ai_parsed: aiParsed,
            ai_error: aiError,
            image_url: imagePublicUrl,
            intake_timestamp: new Date().toISOString(),
            vat_status: item.vat_status || "STANDARD",
          },
        }));

        const { data: ledgerData, error: ledgerError } = await supabase
          .from("financial_ledger")
          .insert(ledgerEntries)
          .select("id");

        if (ledgerError || !ledgerData) {
          console.error("❌ Ledger insert failed:", ledgerError);
          await supabase.from("ai_audit_log").delete().eq("id", auditLog.id);
          throw new Error(`LEDGER_WRITE_FAILED: ${ledgerError?.message || "Insert error"}`);
        }

        const pipelineStatus = aiParsed ? "AI_COMPLETE" : "FALLBACK_COMPLETE";
        console.log(`✅ Created ${ledgerData.length} ledger entries (${pipelineStatus})`);

        // 6. Mark stream as PROCESSED — always, even for fallback
        await supabase
          .from("raw_data_stream")
          .update({
            status: "PROCESSED",
            processed_at: new Date().toISOString(),
            ledger_entry_id: ledgerData[0]?.id || null,
          })
          .eq("id", streamId);

        // Fetch updated S-Value
        const { data: truthData } = await supabase
          .from("absolute_truth_calculator")
          .select("s_value, r_total")
          .eq("user_id", adminProfile.id)
          .single();

        return new Response(
          JSON.stringify({
            success: true,
            message: aiParsed
              ? `AI parsed receipt: ${ledgerData.length} ledger entries created`
              : `Receipt captured with placeholder — manual review needed`,
            entries_count: ledgerData.length,
            data: {
              stream_id: streamId,
              audit_id: auditLog.id,
              entry_ids: ledgerData.map((e) => e.id),
              entries_count: ledgerData.length,
              source: dataSource,
              image_url: imagePublicUrl,
              ai_parsed: aiParsed,
              ai_error: aiError,
              absolute_truth: {
                s_value: truthData?.s_value ?? 0,
                r_total: truthData?.r_total ?? 0,
              },
              pipeline: pipelineStatus,
              auth_method: authMethod,
              timestamp: new Date().toISOString(),
            },
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ═════════════════════════════════════════════════════════
      // BRANCH C: NO USABLE DATA
      // ═════════════════════════════════════════════════════════
      throw new Error("PARSE_ERROR: No amounts (?ts/?tz), vendor, or image_path provided. Cannot process.");

    } catch (parseError) {
      // ═══════════════════════════════════════════════════════════
      // PARSE/LEDGER FAILURE — Data is SAFE in raw_data_stream
      // ═══════════════════════════════════════════════════════════
      const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
      console.error(`⚠️ Parse/Ledger failed for stream ${streamId}: ${errorMessage}`);

      await supabase
        .from("raw_data_stream")
        .update({
          status: "ERROR",
          error_detail: errorMessage,
        })
        .eq("id", streamId);

      return new Response(
        JSON.stringify({
          success: false,
          message: "Raw data captured but processing failed. Data preserved for retry.",
          entries_count: 0,
          data: {
            stream_id: streamId,
            status: "ERROR",
            error: errorMessage,
            pipeline: "PARTIAL",
            retry_available: true,
            timestamp: new Date().toISOString(),
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

  } catch (error) {
    // ═══════════════════════════════════════════════════════════
    // CATASTROPHIC FAILURE — Before raw data could be saved
    // ═══════════════════════════════════════════════════════════
    console.error("💥 Catastrophic intake error:", error);
    return new Response(
      JSON.stringify({
        error: "CATASTROPHIC_ERROR",
        message: error instanceof Error ? error.message : "Unknown critical failure",
        entries_count: 0,
        code: "INTAKE_FATAL",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
