import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// V5.8 System Instructions for the Absolute Truth Protocol - With Graceful Degradation
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
    "description": "brief item description"
  }
]

Return ONLY the JSON array. No explanations, no markdown code blocks.`;

/**
 * Robust JSON Extraction with Error Recovery
 * Handles malformed AI responses gracefully
 */
function extractJsonFromResponse(response: string): unknown {
  // Step 1: Remove markdown code blocks
  let cleaned = response
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  // Step 2: Find JSON boundaries
  const jsonStart = cleaned.indexOf("[");
  const jsonEnd = cleaned.lastIndexOf("]");
  const objStart = cleaned.indexOf("{");
  const objEnd = cleaned.lastIndexOf("}");

  // Prefer array, fall back to object
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
  } else if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
    cleaned = "[" + cleaned.substring(objStart, objEnd + 1) + "]";
  } else {
    throw new Error("MALFORMED_AI_RESPONSE: No JSON object or array found in response");
  }

  // Step 3: Try to fix common issues
  cleaned = cleaned
    .replace(/,\s*}/g, "}") // Remove trailing commas in objects
    .replace(/,\s*]/g, "]") // Remove trailing commas in arrays
    .replace(/'/g, '"')     // Replace single quotes with double quotes
    .replace(/\n/g, " ")    // Remove newlines
    .replace(/\r/g, "");    // Remove carriage returns

  // Step 4: Attempt parse
  try {
    return JSON.parse(cleaned);
  } catch (parseError) {
    console.error("JSON parse failed after cleanup:", cleaned.substring(0, 500));
    throw new Error(`MALFORMED_AI_RESPONSE: JSON parse failed - ${parseError instanceof Error ? parseError.message : "Unknown parse error"}`);
  }
}

/**
 * Create Error Response with Specific Status Code
 */
function errorResponse(
  errorCode: string,
  message: string,
  statusCode: number,
  details?: unknown
): Response {
  console.error(`[${errorCode}] ${message}`, details || "");
  return new Response(
    JSON.stringify({
      error: errorCode,
      message,
      details: details || null,
      status_code: statusCode,
    }),
    {
      status: statusCode,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Validate request method
    if (req.method !== "POST") {
      return errorResponse("METHOD_NOT_ALLOWED", "Only POST requests are accepted", 405);
    }

    // Parse request body
    let document_url: string;
    let user_id: string;
    
    try {
      const body = await req.json();
      document_url = body.document_url;
      user_id = body.user_id;
    } catch {
      return errorResponse("INVALID_REQUEST", "Request body must be valid JSON", 400);
    }
    
    if (!document_url) {
      return errorResponse("MISSING_DOCUMENT_URL", "document_url is required in request body", 400);
    }

    if (!user_id) {
      return errorResponse("MISSING_USER_ID", "user_id is required in request body", 400);
    }

    console.log(`Processing document for user ${user_id}: ${document_url}`);

    // THE PASSPORT CHECK - Validate all secrets exist
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!GEMINI_API_KEY) {
      console.error("CRITICAL: GEMINI_API_KEY is not configured in Supabase Secrets");
      return errorResponse("AUTH_KEY_MISSING", "GEMINI_API_KEY is not configured. Contact system administrator.", 500);
    }

    if (!SUPABASE_URL) {
      return errorResponse("AUTH_KEY_MISSING", "SUPABASE_URL is not configured. Contact system administrator.", 500);
    }

    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return errorResponse("AUTH_KEY_MISSING", "SUPABASE_SERVICE_ROLE_KEY is not configured. Contact system administrator.", 500);
    }

    // Create Supabase client with service role (bypasses RLS)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch the image and convert to base64
    console.log("Fetching document image...");
    let imageResponse: Response;
    try {
      imageResponse = await fetch(document_url);
    } catch (fetchError) {
      return errorResponse(
        "IMAGE_FETCH_FAILED",
        "Failed to fetch document image from storage",
        400,
        fetchError instanceof Error ? fetchError.message : "Network error"
      );
    }

    if (!imageResponse.ok) {
      return errorResponse(
        "IMAGE_FETCH_FAILED",
        `Failed to fetch document image: HTTP ${imageResponse.status}`,
        400,
        { http_status: imageResponse.status }
      );
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = btoa(
      new Uint8Array(imageBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
    );

    // Determine mime type from URL or default to jpeg
    const mimeType = document_url.toLowerCase().includes(".png") ? "image/png" : "image/jpeg";

    // Call Gemini API - Using gemini-2.0-flash model (stable and available)
    console.log("Calling Gemini API for document analysis...");
    let geminiResponse: Response;
    
    try {
      geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
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
    } catch (geminiError) {
      return errorResponse(
        "GEMINI_NETWORK_ERR",
        "Failed to connect to Gemini API",
        503,
        geminiError instanceof Error ? geminiError.message : "Network error"
      );
    }

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error(`Gemini API error: ${geminiResponse.status} - ${errorText}`);
      
      // Map Gemini status codes to meaningful errors
      if (geminiResponse.status === 401 || geminiResponse.status === 403) {
        return errorResponse("GEMINI_AUTH_ERR", "Gemini API key is invalid or expired", geminiResponse.status, errorText);
      }
      if (geminiResponse.status === 429) {
        return errorResponse("GEMINI_RATE_LIMIT", "Gemini API rate limit exceeded. Wait and retry.", 429, errorText);
      }
      if (geminiResponse.status === 404) {
        return errorResponse("GEMINI_MODEL_ERR", "Gemini model not available", 404, errorText);
      }
      
      return errorResponse("GEMINI_API_ERR", `Gemini API returned HTTP ${geminiResponse.status}`, geminiResponse.status, errorText);
    }

    const geminiData = await geminiResponse.json();
    console.log("Gemini response received");

    // Extract the text response
    const textResponse = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textResponse) {
      console.error("No text response from Gemini", JSON.stringify(geminiData).substring(0, 500));
      return errorResponse(
        "GEMINI_EMPTY_RESPONSE",
        "Gemini returned no text response",
        500,
        { raw_response: JSON.stringify(geminiData).substring(0, 200) }
      );
    }

    // JSON SHIELD - Parse with robust error handling
    let parsedItems: unknown[];
    try {
      const extracted = extractJsonFromResponse(textResponse);
      parsedItems = Array.isArray(extracted) ? extracted : [extracted];
      console.log(`Parsed ${parsedItems.length} items from document`);
    } catch (parseError) {
      console.error("JSON extraction failed:", textResponse.substring(0, 500));
      return errorResponse(
        "MALFORMED_AI_RESPONSE",
        parseError instanceof Error ? parseError.message : "Failed to parse AI response as JSON",
        500,
        { raw_response: textResponse.substring(0, 300) }
      );
    }

    // Validate and sanitize each item with graceful defaults
    const sanitizedItems = parsedItems.map((item: unknown, index: number) => {
      const i = item as Record<string, unknown>;
      return {
        transaction_date: typeof i.transaction_date === "string" ? i.transaction_date : new Date().toISOString().split("T")[0],
        vendor_name: typeof i.vendor_name === "string" && i.vendor_name.trim() ? i.vendor_name : "Unknown Vendor",
        category: ["R", "P", "O", "V", "D", "A"].includes(i.category as string) ? i.category : "O",
        pot_id: typeof i.pot_id === "string" ? i.pot_id : null,
        net_amount: typeof i.net_amount === "number" ? i.net_amount : parseFloat(String(i.net_amount)) || 0,
        vat_amount: typeof i.vat_amount === "number" ? i.vat_amount : parseFloat(String(i.vat_amount)) || 0,
        gross_amount: typeof i.gross_amount === "number" ? i.gross_amount : parseFloat(String(i.gross_amount)) || 0,
        description: typeof i.description === "string" ? i.description : `Item ${index + 1}`,
      };
    });

    // THE HANDSHAKE - Step 1: Create ai_audit_log entry
    console.log("Creating audit log entry...");
    const { data: auditLog, error: auditError } = await supabase
      .from("ai_audit_log")
      .insert({
        user_id,
        image_url: document_url,
        raw_json: sanitizedItems,
      })
      .select()
      .single();

    if (auditError) {
      console.error("Failed to create audit log:", auditError);
      return errorResponse("DB_AUDIT_ERR", "Failed to create audit log entry", 500, auditError);
    }

    console.log(`Audit log created with ID: ${auditLog.id}`);

    // THE HANDSHAKE - Step 2: Create financial_ledger entries
    console.log("Creating ledger entries...");
    const HAGGERSTON_TENANT_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    const ledgerEntries = sanitizedItems.map((item) => ({
      user_id,
      tenant_id: HAGGERSTON_TENANT_ID,
      audit_id: auditLog.id,
      transaction_date: item.transaction_date,
      vendor_name: item.vendor_name,
      category: item.category,
      pot_id: item.pot_id,
      net_amount: item.net_amount,
      vat_amount: item.vat_amount,
      gross_amount: item.gross_amount,
      metadata: { description: item.description },
    }));

    const { data: ledgerData, error: ledgerError } = await supabase
      .from("financial_ledger")
      .insert(ledgerEntries)
      .select();

    if (ledgerError) {
      console.error("Failed to create ledger entries:", ledgerError);
      // Rollback: Delete the audit log entry
      await supabase.from("ai_audit_log").delete().eq("id", auditLog.id);
      return errorResponse("DB_LEDGER_ERR", "Failed to create ledger entries", 500, ledgerError);
    }

    console.log(`Created ${ledgerData.length} ledger entries`);

    // Success response with full diagnostic info
    return new Response(
      JSON.stringify({
        success: true,
        message: `Successfully processed document. Created ${ledgerData.length} ledger entries.`,
        audit_id: auditLog.id,
        entries_count: ledgerData.length,
        status_code: 200,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Unexpected error:", error);
    return errorResponse(
      "INTERNAL_ERR",
      "An unexpected error occurred",
      500,
      error instanceof Error ? error.message : String(error)
    );
  }
});
