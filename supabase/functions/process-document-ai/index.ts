import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// V5.7 System Instructions for the Absolute Truth Protocol
const SYSTEM_PROMPT = `You are a financial document parser for the Absolute Truth Protocol.

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
5. If VAT is included, extract it. UK VAT is typically 20% (so VAT = Gross / 6).
6. Use pot_id for sub-categorization (e.g., P1 for food, P2 for packaging, O1 for utilities).
7. Deduct tips from Revenue entries.

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
    "description": "brief item description"
  }
]

Return ONLY the JSON array. No explanations, no markdown code blocks.`;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Validate request method
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const { document_url, user_id } = await req.json();
    
    if (!document_url) {
      console.error("Missing document_url in request body");
      return new Response(
        JSON.stringify({ error: "document_url is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!user_id) {
      console.error("Missing user_id in request body");
      return new Response(
        JSON.stringify({ error: "user_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing document for user ${user_id}: ${document_url}`);

    // Get secrets
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY is not configured");
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY is not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("Supabase configuration missing");
      return new Response(
        JSON.stringify({ error: "Supabase configuration missing" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with service role (bypasses RLS)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch the image and convert to base64
    console.log("Fetching document image...");
    const imageResponse = await fetch(document_url);
    if (!imageResponse.ok) {
      console.error(`Failed to fetch image: ${imageResponse.status}`);
      return new Response(
        JSON.stringify({ error: "Failed to fetch document image" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = btoa(
      new Uint8Array(imageBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
    );

    // Determine mime type from URL or default to jpeg
    const mimeType = document_url.toLowerCase().includes(".png") ? "image/png" : "image/jpeg";

    // Call Gemini 1.5 Pro API
    console.log("Calling Gemini API for document analysis...");
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: SYSTEM_PROMPT },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: base64Image,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            topP: 0.95,
            maxOutputTokens: 4096,
          },
        }),
      }
    );

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error(`Gemini API error: ${geminiResponse.status} - ${errorText}`);
      return new Response(
        JSON.stringify({ error: "Gemini API error", details: errorText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const geminiData = await geminiResponse.json();
    console.log("Gemini response received");

    // Extract the text response
    const textResponse = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textResponse) {
      console.error("No text response from Gemini", geminiData);
      return new Response(
        JSON.stringify({ error: "No response from Gemini", details: geminiData }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse the JSON response (handle potential markdown code blocks)
    let parsedItems;
    try {
      // Remove markdown code blocks if present
      let cleanJson = textResponse.trim();
      if (cleanJson.startsWith("```json")) {
        cleanJson = cleanJson.slice(7);
      } else if (cleanJson.startsWith("```")) {
        cleanJson = cleanJson.slice(3);
      }
      if (cleanJson.endsWith("```")) {
        cleanJson = cleanJson.slice(0, -3);
      }
      cleanJson = cleanJson.trim();

      parsedItems = JSON.parse(cleanJson);
      console.log(`Parsed ${parsedItems.length} items from document`);
    } catch (parseError) {
      console.error("Failed to parse Gemini response as JSON:", textResponse);
      return new Response(
        JSON.stringify({ error: "Failed to parse AI response", raw: textResponse }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate it's an array
    if (!Array.isArray(parsedItems)) {
      parsedItems = [parsedItems]; // Wrap single object in array
    }

    // THE HANDSHAKE - Step 1: Create ai_audit_log entry
    console.log("Creating audit log entry...");
    const { data: auditLog, error: auditError } = await supabase
      .from("ai_audit_log")
      .insert({
        user_id,
        image_url: document_url,
        raw_json: parsedItems,
      })
      .select()
      .single();

    if (auditError) {
      console.error("Failed to create audit log:", auditError);
      return new Response(
        JSON.stringify({ error: "Failed to create audit log", details: auditError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Audit log created with ID: ${auditLog.id}`);

    // THE HANDSHAKE - Step 2: Create financial_ledger entries
    console.log("Creating ledger entries...");
    const ledgerEntries = parsedItems.map((item: any) => ({
      user_id,
      audit_id: auditLog.id,
      transaction_date: item.transaction_date || new Date().toISOString().split("T")[0],
      vendor_name: item.vendor_name || "Unknown",
      category: item.category,
      pot_id: item.pot_id || null,
      net_amount: parseFloat(item.net_amount) || 0,
      vat_amount: parseFloat(item.vat_amount) || 0,
      gross_amount: parseFloat(item.gross_amount) || 0,
      metadata: { description: item.description || null },
    }));

    const { data: ledgerData, error: ledgerError } = await supabase
      .from("financial_ledger")
      .insert(ledgerEntries)
      .select();

    if (ledgerError) {
      console.error("Failed to create ledger entries:", ledgerError);
      // Rollback: Delete the audit log entry
      await supabase.from("ai_audit_log").delete().eq("id", auditLog.id);
      return new Response(
        JSON.stringify({ error: "Failed to create ledger entries", details: ledgerError }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Created ${ledgerData.length} ledger entries`);

    // Success response
    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully processed document. Created ${ledgerData.length} ledger entries.`,
        audit_id: auditLog.id,
        entries_count: ledgerData.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
