import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ═══════════════════════════════════════════════════════════════
// MODUS ARMS — SOVEREIGN INTAKE ENGINE v2.0
// 
// ARCHITECTURE: Raw-First, Parse-Second
// 1. Authenticate (Header OR URL fallback)
// 2. LAND raw payload into raw_data_stream (PENDING)
// 3. Return 200 immediately — data is safe
// 4. Attempt parse + ledger write (Sequential Lock)
// 5. If parse fails → mark stream record as ERROR (data preserved)
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
// ═══════════════════════════════════════════════════════════════

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

    // Extract all URL parameters
    const urlParams: Record<string, string | null> = {
      ts: url.searchParams.get("ts"),
      tz: url.searchParams.get("tz"),
      aid: url.searchParams.get("aid"),
      vendor: url.searchParams.get("vendor"),
      date: url.searchParams.get("date"),
      image: url.searchParams.get("image"),
      source: url.searchParams.get("source"),
    };

    // Build the complete raw payload (body + URL params)
    const rawPayload: Record<string, unknown> = {
      ...bodyPayload,
      _url_params: urlParams,
      _auth_method: authMethod,
      _received_at: new Date().toISOString(),
      _method: req.method,
    };

    // Determine source identifier
    const dataSource = (urlParams.source || (bodyPayload.source as string) || "UNKNOWN").toUpperCase();

    // ═══════════════════════════════════════════════════════════
    // STEP 3: LAND RAW DATA (The Safety Net)
    // Write to raw_data_stream BEFORE any parsing/processing.
    // This guarantees 100% data retention regardless of what
    // happens downstream.
    // ═══════════════════════════════════════════════════════════

    // Resolve admin user for data ownership
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
      // This is the only true failure — we couldn't save the data at all
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
    // Only after raw data is safely stored do we attempt parsing.
    // If parsing fails, data is preserved with ERROR status.
    // ═══════════════════════════════════════════════════════════

    try {
      // --- Parse amounts from URL params or body ---
      let amountGross: number | undefined;
      let amountVat: number | undefined;

      // ?ts= Standard Tax (20% VAT auto-calculated)
      if (urlParams.ts) {
        const gross = parseFloat(urlParams.ts);
        if (!isNaN(gross)) {
          amountGross = gross;
          amountVat = Math.round((gross * (20 / 120)) * 100) / 100;
          console.log(`📊 Standard Tax: Gross £${gross}, VAT £${amountVat}`);
        }
      }

      // ?tz= Zero Tax (0% VAT)
      if (urlParams.tz) {
        const gross = parseFloat(urlParams.tz);
        if (!isNaN(gross)) {
          amountGross = gross;
          amountVat = 0;
          console.log(`📊 Zero Tax: Gross £${gross}, VAT £0`);
        }
      }

      // Fallback to body values
      if (amountGross === undefined) {
        amountGross = typeof bodyPayload.amount_gross === "number" ? bodyPayload.amount_gross : undefined;
      }
      if (amountVat === undefined) {
        amountVat = typeof bodyPayload.amount_vat === "number" ? bodyPayload.amount_vat : undefined;
      }

      // Vendor name
      const vendorName = (
        urlParams.vendor ||
        (bodyPayload.vendor_name as string) ||
        ""
      ).trim();

      // Validation gate
      if (amountGross === undefined || isNaN(amountGross)) {
        throw new Error("PARSE_ERROR: amount_gross is missing or invalid. Use ?ts=, ?tz=, or body.amount_gross");
      }
      if (amountVat === undefined || isNaN(amountVat)) {
        throw new Error("PARSE_ERROR: amount_vat could not be determined");
      }
      if (!vendorName) {
        throw new Error("PARSE_ERROR: vendor_name is required (body or ?vendor= param)");
      }

      // Calculate net
      const netAmount = amountGross - amountVat;

      // --- Sequential Image Lock ---
      let verifiedImageUrl: string | null = null;
      const imagePath = urlParams.image || (bodyPayload.image_path as string);

      if (imagePath) {
        console.log(`🖼️ Verifying image: ${imagePath}`);
        const { data: urlData } = supabase.storage.from("receipts").getPublicUrl(imagePath);

        if (urlData?.publicUrl) {
          const verifyResponse = await fetch(urlData.publicUrl, { method: "HEAD" });
          if (verifyResponse.ok) {
            verifiedImageUrl = urlData.publicUrl;
            console.log(`✅ Image verified`);
          } else {
            console.warn(`⚠️ Image not found (HTTP ${verifyResponse.status}), proceeding without image`);
          }
        }
      }

      // --- Attribution validation ---
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
        } else {
          console.warn(`⚠️ Attribution ID ${attributionId} not found, proceeding without`);
        }
      }

      // --- Commit to financial_ledger ---
      const transactionDate = urlParams.date || (bodyPayload.transaction_date as string) || new Date().toISOString().split("T")[0];

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
          },
        })
        .select("id")
        .single();

      if (ledgerError || !ledgerEntry) {
        throw new Error(`LEDGER_WRITE_FAILED: ${ledgerError?.message || "Unknown insert error"}`);
      }

      console.log(`✅ Ledger entry created: ${ledgerEntry.id}`);

      // --- Mark stream record as PROCESSED ---
      await supabase
        .from("raw_data_stream")
        .update({
          status: "PROCESSED",
          processed_at: new Date().toISOString(),
          ledger_entry_id: ledgerEntry.id,
        })
        .eq("id", streamId);

      console.log(`✅ Stream record ${streamId} → PROCESSED`);

      // --- Fetch updated S-Value ---
      const { data: truthData } = await supabase
        .from("absolute_truth_calculator")
        .select("s_value, r_total")
        .eq("user_id", adminProfile.id)
        .single();

      // ═══════════════════════════════════════════════════════════
      // SUCCESS: Full pipeline completed
      // ═══════════════════════════════════════════════════════════
      return new Response(
        JSON.stringify({
          success: true,
          message: "Revenue intake processed — Absolute Truth updated",
          data: {
            stream_id: streamId,
            entry_id: ledgerEntry.id,
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

    } catch (parseError) {
      // ═══════════════════════════════════════════════════════════
      // PARSE/LEDGER FAILURE — Data is SAFE in raw_data_stream
      // Mark as ERROR with detail, return 200 (data landed)
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

      // Return 200 — raw data is safely stored for forensic audit / retry
      return new Response(
        JSON.stringify({
          success: false,
          message: "Raw data captured but parsing/ledger write failed. Data preserved for retry.",
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
        code: "INTAKE_FATAL",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
