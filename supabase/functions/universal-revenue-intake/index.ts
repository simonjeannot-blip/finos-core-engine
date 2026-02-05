import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

interface IntakePayload {
  amount_gross?: number;
  amount_vat?: number;
  vendor_name?: string;
  payment_method?: string;
  transaction_date?: string;
  image_path?: string; // Storage path for receipt image
  attribution_id?: string;
}

// ═══════════════════════════════════════════════════════════════
// URL PARAMETER MAPPING
// ?ts=<gross> → Standard Tax Revenue (20% VAT calculated)
// ?tz=<gross> → Zero Tax Revenue (0% VAT)
// ?aid=<uuid> → Attribution ID for Click-to-Cover
// ?key=<api_key> → Fallback auth for header-less hardware
// ?vendor=<name> → Vendor name
// ?date=<YYYY-MM-DD> → Transaction date
// ═══════════════════════════════════════════════════════════════

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Accept both POST and GET (for URL-based intake)
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(
      JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: "Only POST and GET requests accepted" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const url = new URL(req.url);
    
    // ═══════════════════════════════════════════════════════════════
    // PASSPORT CHECK: Validate API Key (Header OR URL Fallback)
    // ═══════════════════════════════════════════════════════════════
    const intakeApiKey = Deno.env.get("INTAKE_ARM_KEY");
    
    if (!intakeApiKey) {
      console.error("INTAKE_ARM_KEY secret is not configured");
      return new Response(
        JSON.stringify({ 
          error: "AUTH_KEY_MISSING", 
          message: "Server configuration error: API key not set" 
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // URL Parameter Fallback: Check header first, then URL param
    const headerKey = req.headers.get("x-api-key");
    const urlKey = url.searchParams.get("key");
    const providedKey = headerKey || urlKey;
    
    if (!providedKey) {
      console.warn("Request missing authentication - no X-API-KEY header or ?key= param");
      return new Response(
        JSON.stringify({ 
          error: "UNAUTHORIZED", 
          message: "Missing authentication. Provide X-API-KEY header or ?key= parameter" 
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (providedKey !== intakeApiKey) {
      console.warn("Invalid API key provided via", headerKey ? "header" : "URL param");
      return new Response(
        JSON.stringify({ 
          error: "FORBIDDEN", 
          message: "Invalid API key" 
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authMethod = headerKey ? "header" : "url_param";
    console.log(`✅ API Key validated via ${authMethod}`);

    // ═══════════════════════════════════════════════════════════════
    // PARSE PAYLOAD: Body (POST) OR URL Parameters (GET)
    // ═══════════════════════════════════════════════════════════════
    let payload: IntakePayload = {};
    
    if (req.method === "POST") {
      try {
        const body = await req.json();
        payload = body;
      } catch {
        // Allow empty body if URL params are provided
        console.log("No JSON body, checking URL parameters");
      }
    }

    // URL Parameter Mapping - override/supplement body values
    const tsParam = url.searchParams.get("ts"); // Standard Tax (20% VAT)
    const tzParam = url.searchParams.get("tz"); // Zero Tax (0% VAT)
    const aidParam = url.searchParams.get("aid"); // Attribution ID
    const vendorParam = url.searchParams.get("vendor");
    const dateParam = url.searchParams.get("date");
    const imageParam = url.searchParams.get("image");

    // Process ?ts= (Standard Tax - calculate 20% VAT)
    if (tsParam) {
      const grossAmount = parseFloat(tsParam);
      if (!isNaN(grossAmount)) {
        payload.amount_gross = grossAmount;
        // Standard UK VAT: gross includes 20% VAT, so VAT = gross * (20/120)
        payload.amount_vat = Math.round((grossAmount * (20 / 120)) * 100) / 100;
        console.log(`📊 Standard Tax intake: Gross £${grossAmount}, VAT £${payload.amount_vat}`);
      }
    }

    // Process ?tz= (Zero Tax - 0% VAT)
    if (tzParam) {
      const grossAmount = parseFloat(tzParam);
      if (!isNaN(grossAmount)) {
        payload.amount_gross = grossAmount;
        payload.amount_vat = 0;
        console.log(`📊 Zero Tax intake: Gross £${grossAmount}, VAT £0`);
      }
    }

    // Process other URL params
    if (aidParam) payload.attribution_id = aidParam;
    if (vendorParam) payload.vendor_name = vendorParam;
    if (dateParam) payload.transaction_date = dateParam;
    if (imageParam) payload.image_path = imageParam;

    // ═══════════════════════════════════════════════════════════════
    // VALIDATION: Required fields
    // ═══════════════════════════════════════════════════════════════
    const { amount_gross, amount_vat, vendor_name, payment_method, transaction_date, image_path, attribution_id } = payload;

    if (typeof amount_gross !== "number" || isNaN(amount_gross)) {
      return new Response(
        JSON.stringify({ 
          error: "VALIDATION_ERROR", 
          message: "amount_gross must be a valid number (or use ?ts= or ?tz= params)" 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (typeof amount_vat !== "number" || isNaN(amount_vat)) {
      return new Response(
        JSON.stringify({ 
          error: "VALIDATION_ERROR", 
          message: "amount_vat must be a valid number" 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!vendor_name || typeof vendor_name !== "string") {
      return new Response(
        JSON.stringify({ 
          error: "VALIDATION_ERROR", 
          message: "vendor_name is required (body or ?vendor= param)" 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📦 Intake received: £${amount_gross} from ${vendor_name}`);

    // ═══════════════════════════════════════════════════════════════
    // SUPABASE CLIENT INIT
    // ═══════════════════════════════════════════════════════════════
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // ═══════════════════════════════════════════════════════════════
    // SEQUENTIAL IMAGE LOCK: Verify image URL before proceeding
    // ═══════════════════════════════════════════════════════════════
    let verified_image_url: string | null = null;

    if (image_path) {
      console.log(`🖼️ Verifying image: ${image_path}`);
      
      try {
        const { data: urlData } = supabase.storage
          .from("receipts")
          .getPublicUrl(image_path);

        if (!urlData?.publicUrl || typeof urlData.publicUrl !== "string") {
          console.error("IMAGE_VERIFICATION_FAILED: getPublicUrl returned invalid data");
          return new Response(
            JSON.stringify({ 
              error: "IMAGE_VERIFICATION_FAILED", 
              message: "Unable to verify image URL. Upload may have failed.",
              code: "IMG_URL_INVALID"
            }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Additional verification: Check if the file exists by making a HEAD request
        const verifyResponse = await fetch(urlData.publicUrl, { method: "HEAD" });
        
        if (!verifyResponse.ok) {
          console.error(`IMAGE_NOT_FOUND: HEAD request returned ${verifyResponse.status}`);
          return new Response(
            JSON.stringify({ 
              error: "IMAGE_NOT_FOUND", 
              message: "Image file does not exist in storage. Upload may have failed.",
              code: "IMG_404",
              attempted_path: image_path
            }),
            { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        verified_image_url = urlData.publicUrl;
        console.log(`✅ Image verified: ${verified_image_url}`);
        
      } catch (imgError) {
        console.error("Image verification error:", imgError);
        return new Response(
          JSON.stringify({ 
            error: "IMAGE_VERIFICATION_ERROR", 
            message: "Failed to verify image. Network or storage error.",
            code: "IMG_VERIFY_ERR",
            details: imgError instanceof Error ? imgError.message : "Unknown error"
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // ABSOLUTE TRUTH LOGIC: Calculate Net Revenue
    // ═══════════════════════════════════════════════════════════════
    const net_amount = amount_gross - amount_vat;
    console.log(`💰 Calculated Net Revenue: £${net_amount} (Gross: £${amount_gross} - VAT: £${amount_vat})`);

    // ═══════════════════════════════════════════════════════════════
    // GET ADMIN USER FOR LEDGER ENTRY
    // ═══════════════════════════════════════════════════════════════
    const { data: adminProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "super_admin")
      .limit(1)
      .single();

    if (profileError || !adminProfile) {
      console.error("Failed to find admin user for ledger entry:", profileError);
      return new Response(
        JSON.stringify({ 
          error: "SYSTEM_ERROR", 
          message: "No admin user configured to receive intake" 
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ═══════════════════════════════════════════════════════════════
    // ATTRIBUTION VALIDATION (Click-to-Cover)
    // ═══════════════════════════════════════════════════════════════
    let validated_attribution_id: string | null = null;

    if (attribution_id) {
      // Verify the attribution_id exists in the leads table
      const { data: leadData, error: leadError } = await supabase
        .from("leads")
        .select("attribution_id")
        .eq("attribution_id", attribution_id)
        .single();

      if (leadError || !leadData) {
        console.warn(`Attribution ID ${attribution_id} not found in leads table, proceeding without link`);
      } else {
        validated_attribution_id = attribution_id;
        console.log(`🔗 Attribution linked: ${validated_attribution_id}`);
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // DATABASE GUARD: Only commit after all verifications pass
    // ═══════════════════════════════════════════════════════════════
    const ledgerEntry = {
      user_id: adminProfile.id,
      transaction_date: transaction_date || new Date().toISOString().split("T")[0],
      vendor_name: vendor_name.trim(),
      category: "R" as const,
      net_amount: net_amount,
      vat_amount: amount_vat,
      gross_amount: amount_gross,
      attribution_id: validated_attribution_id,
      metadata: {
        source: "universal-revenue-intake",
        payment_method: payment_method || "unknown",
        intake_timestamp: new Date().toISOString(),
        auth_method: authMethod,
        image_url: verified_image_url,
        url_params_used: {
          ts: tsParam || null,
          tz: tzParam || null,
          aid: aidParam || null,
        },
      },
    };

    console.log("📝 Committing ledger entry...");

    const { data: insertedEntry, error: insertError } = await supabase
      .from("financial_ledger")
      .insert(ledgerEntry)
      .select()
      .single();

    if (insertError) {
      console.error("Failed to insert ledger entry:", insertError);
      return new Response(
        JSON.stringify({ 
          error: "DATABASE_ERROR", 
          message: "Failed to insert ledger entry",
          code: "DB_INSERT_FAIL",
          details: insertError.message 
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`✅ Ledger entry created: ${insertedEntry.id}`);

    // ═══════════════════════════════════════════════════════════════
    // FETCH UPDATED ABSOLUTE TRUTH VALUE
    // ═══════════════════════════════════════════════════════════════
    const { data: truthData } = await supabase
      .from("absolute_truth_calculator")
      .select("s_value, r_total, a_total")
      .eq("user_id", adminProfile.id)
      .single();

    const currentSValue = truthData?.s_value ?? 0;
    const currentRTotal = truthData?.r_total ?? 0;

    console.log(`📊 New Absolute Truth (S): £${currentSValue} | Revenue Total: £${currentRTotal}`);

    // ═══════════════════════════════════════════════════════════════
    // SUCCESS RESPONSE
    // ═══════════════════════════════════════════════════════════════
    return new Response(
      JSON.stringify({
        success: true,
        message: "Revenue intake processed successfully",
        data: {
          entry_id: insertedEntry.id,
          net_revenue: net_amount,
          gross_amount: amount_gross,
          vat_amount: amount_vat,
          vendor: vendor_name,
          attribution_id: validated_attribution_id,
          image_url: verified_image_url,
          absolute_truth: {
            s_value: currentSValue,
            r_total: currentRTotal,
          },
          auth_method: authMethod,
          timestamp: new Date().toISOString(),
        },
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (error) {
    console.error("Unexpected error in universal-revenue-intake:", error);
    return new Response(
      JSON.stringify({ 
        error: "INTERNAL_ERROR", 
        message: error instanceof Error ? error.message : "Unknown error occurred",
        code: "UNEXPECTED_ERR"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
