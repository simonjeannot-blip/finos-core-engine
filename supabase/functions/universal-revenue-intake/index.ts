import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface IntakePayload {
  amount_gross: number;
  amount_vat: number;
  vendor_name: string;
  payment_method?: string;
  transaction_date?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only accept POST requests
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: "Only POST requests accepted" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // ═══════════════════════════════════════════════════════════════
    // PASSPORT CHECK: Validate API Key
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

    const providedKey = req.headers.get("x-api-key");
    
    if (!providedKey) {
      console.warn("Request missing X-API-KEY header");
      return new Response(
        JSON.stringify({ 
          error: "UNAUTHORIZED", 
          message: "Missing X-API-KEY header" 
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (providedKey !== intakeApiKey) {
      console.warn("Invalid API key provided");
      return new Response(
        JSON.stringify({ 
          error: "FORBIDDEN", 
          message: "Invalid API key" 
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("✅ API Key validated successfully");

    // ═══════════════════════════════════════════════════════════════
    // PARSE REQUEST BODY
    // ═══════════════════════════════════════════════════════════════
    let payload: IntakePayload;
    
    try {
      payload = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ 
          error: "INVALID_JSON", 
          message: "Request body must be valid JSON" 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate required fields
    const { amount_gross, amount_vat, vendor_name, payment_method, transaction_date } = payload;

    if (typeof amount_gross !== "number" || isNaN(amount_gross)) {
      return new Response(
        JSON.stringify({ 
          error: "VALIDATION_ERROR", 
          message: "amount_gross must be a valid number" 
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
          message: "vendor_name is required" 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`📦 Intake received: £${amount_gross} from ${vendor_name}`);

    // ═══════════════════════════════════════════════════════════════
    // ABSOLUTE TRUTH LOGIC: Calculate Net Revenue
    // Formula: Net = Gross - VAT
    // This creates an 'R' (Revenue) entry
    // ═══════════════════════════════════════════════════════════════
    const net_amount = amount_gross - amount_vat;

    console.log(`💰 Calculated Net Revenue: £${net_amount} (Gross: £${amount_gross} - VAT: £${amount_vat})`);

    // ═══════════════════════════════════════════════════════════════
    // DATABASE INSERT: Write to financial_ledger
    // ═══════════════════════════════════════════════════════════════
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // For revenue intake, we need a user_id. 
    // Since this is middleware, we'll use a system approach - get the first super_admin
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

    const ledgerEntry = {
      user_id: adminProfile.id,
      transaction_date: transaction_date || new Date().toISOString().split("T")[0],
      vendor_name: vendor_name.trim(),
      category: "R" as const, // Revenue category
      net_amount: net_amount,
      vat_amount: amount_vat,
      gross_amount: amount_gross,
      metadata: {
        source: "universal-revenue-intake",
        payment_method: payment_method || "unknown",
        intake_timestamp: new Date().toISOString(),
      },
    };

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
      .select("s_value")
      .eq("user_id", adminProfile.id)
      .single();

    const currentSValue = truthData?.s_value ?? 0;

    console.log(`📊 New Absolute Truth (S): £${currentSValue}`);

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
          absolute_truth_s: currentSValue,
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
        message: error instanceof Error ? error.message : "Unknown error occurred" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
