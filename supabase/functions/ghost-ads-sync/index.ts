import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ═══════════════════════════════════════════════════════════════
// THE GHOST — Autonomous Google Ads Ingestion Engine v1.0
//
// ARCHITECTURE: Fetch → Filter → Inject → Audit
// 1. OAuth2 token refresh via Google's token endpoint
// 2. Google Ads API SearchStream for cost_micros + campaign.name
// 3. Sovereign Selection: OFFICE / SHOWROOM / EVENT campaigns only
// 4. Upsert into ad_campaigns vault with micros→currency conversion
// 5. Error taxonomy: ENDPOINT_FAILURE logged to system_audit_log
//
// SCHEDULE: Daily cron via pg_cron + pg_net
// ═══════════════════════════════════════════════════════════════

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// Engine IDs — only campaigns containing these tags are ingested
const ENGINE_IDS = ["OFFICE", "SHOWROOM", "EVENT"];

// ═══════════════════════════════════════════════════════════════
// STEP 1: OAuth2 Token Refresh
// ═══════════════════════════════════════════════════════════════
async function refreshAccessToken(): Promise<string> {
  const clientId = Deno.env.get("GOOGLE_ADS_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_ADS_CLIENT_SECRET")!;
  const refreshToken = Deno.env.get("GOOGLE_ADS_REFRESH_TOKEN")!;

  console.log("[Ghost] 🔑 Refreshing OAuth2 access token...");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const body = await response.text();

  if (!response.ok) {
    console.error("[Ghost] ❌ Token refresh failed:", body);
    throw new Error(`OAUTH_REFRESH_FAILED: ${response.status} — ${body}`);
  }

  const tokenData = JSON.parse(body);
  console.log("[Ghost] ✅ Access token acquired");
  return tokenData.access_token;
}

// ═══════════════════════════════════════════════════════════════
// STEP 2: Google Ads API — SearchStream Query
// ═══════════════════════════════════════════════════════════════
interface GoogleAdsCampaignRow {
  campaign: { name: string; id: string };
  metrics: {
    costMicros: string;
    impressions: string;
    clicks: string;
  };
  segments: { date: string };
}

async function fetchAdsCampaignData(
  accessToken: string,
  dateFrom: string,
  dateTo: string
): Promise<GoogleAdsCampaignRow[]> {
  const customerId = Deno.env.get("GOOGLE_ADS_CUSTOMER_ID")!.replace(/-/g, "");
  const developerToken = Deno.env.get("GOOGLE_ADS_DEVELOPER_TOKEN")!;

  const query = `
    SELECT
      campaign.name,
      campaign.id,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      segments.date
    FROM campaign
    WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
      AND campaign.status = 'ENABLED'
    ORDER BY segments.date DESC
  `;

  console.log(`[Ghost] 📡 Querying Google Ads API for ${dateFrom} → ${dateTo}`);

  const response = await fetch(
    `https://googleads.googleapis.com/v18/customers/${customerId}/googleAds:searchStream`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );

  const body = await response.text();

  if (!response.ok) {
    console.error("[Ghost] ❌ Google Ads API error:", body);
    throw new Error(`GOOGLE_ADS_API_FAILED: ${response.status} — ${body}`);
  }

  // SearchStream returns an array of result batches
  const batches = JSON.parse(body);
  const rows: GoogleAdsCampaignRow[] = [];

  for (const batch of batches) {
    if (batch.results) {
      rows.push(...batch.results);
    }
  }

  console.log(`[Ghost] 📊 Received ${rows.length} campaign rows from Google Ads`);
  return rows;
}

// ═══════════════════════════════════════════════════════════════
// STEP 3: Sovereign Filter — Extract Engine ID campaigns only
// ═══════════════════════════════════════════════════════════════
interface FilteredCampaign {
  campaign_name: string;
  campaign_id: string;
  engine_id: string;
  spend_amount: number; // micros → standard currency
  impressions: number;
  clicks: number;
  date: string;
}

function filterAndTransform(rows: GoogleAdsCampaignRow[]): FilteredCampaign[] {
  const filtered: FilteredCampaign[] = [];

  for (const row of rows) {
    const campaignName = row.campaign?.name || "";
    const upperName = campaignName.toUpperCase();

    // Sovereign Selection: only ingest campaigns matching Engine IDs
    const matchedEngine = ENGINE_IDS.find((id) => upperName.includes(id));
    if (!matchedEngine) continue;

    const costMicros = parseInt(row.metrics?.costMicros || "0", 10);
    const spendAmount = Math.round((costMicros / 1_000_000) * 100) / 100; // micros → £ with 2dp

    filtered.push({
      campaign_name: campaignName,
      campaign_id: row.campaign?.id || "unknown",
      engine_id: matchedEngine,
      spend_amount: spendAmount,
      impressions: parseInt(row.metrics?.impressions || "0", 10),
      clicks: parseInt(row.metrics?.clicks || "0", 10),
      date: row.segments?.date || new Date().toISOString().split("T")[0],
    });
  }

  console.log(`[Ghost] 🔍 Filtered to ${filtered.length} sovereign campaigns (${ENGINE_IDS.join(", ")})`);
  return filtered;
}

// ═══════════════════════════════════════════════════════════════
// STEP 4: Vault Injection — Upsert into ad_campaigns
// ═══════════════════════════════════════════════════════════════
async function upsertCampaigns(
  supabase: ReturnType<typeof createClient>,
  campaigns: FilteredCampaign[],
  userId: string
): Promise<{ upserted: number; errors: string[] }> {
  let upserted = 0;
  const errors: string[] = [];

  for (const campaign of campaigns) {
    const { error } = await supabase
      .from("ad_campaigns")
      .upsert(
        {
          campaign_name: campaign.campaign_name,
          engine_id: campaign.engine_id,
          spend_amount: campaign.spend_amount,
          impressions: campaign.impressions,
          clicks: campaign.clicks,
          date: campaign.date,
          last_sync_at: new Date().toISOString(),
          user_id: userId,
          metadata: {
            campaign_id: campaign.campaign_id,
            source: "GHOST_ADS_SYNC",
            sync_timestamp: new Date().toISOString(),
          },
        },
        {
          onConflict: "campaign_name,date,user_id",
        }
      );

    if (error) {
      const errMsg = `Failed to upsert ${campaign.campaign_name} (${campaign.date}): ${error.message}`;
      console.error(`[Ghost] ❌ ${errMsg}`);
      errors.push(errMsg);
    } else {
      upserted++;
    }
  }

  console.log(`[Ghost] 💾 Upserted ${upserted}/${campaigns.length} campaigns`);
  return { upserted, errors };
}

// ═══════════════════════════════════════════════════════════════
// STEP 5: Error Taxonomy — Log failures to system_audit_log
// ═══════════════════════════════════════════════════════════════
async function logEndpointFailure(
  supabase: ReturnType<typeof createClient>,
  errorMessage: string,
  context: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from("system_audit_log").insert({
      table_name: "ad_campaigns",
      record_id: "00000000-0000-0000-0000-000000000000",
      action_type: "ENDPOINT_FAILURE",
      old_data_hash: null,
      new_data_hash: JSON.stringify({
        error: errorMessage,
        context,
        timestamp: new Date().toISOString(),
        source: "GHOST_ADS_SYNC",
      }),
      changed_by: null,
    });
    console.log("[Ghost] 📝 ENDPOINT_FAILURE logged to system_audit_log");
  } catch (auditError) {
    console.error("[Ghost] ⚠️ Failed to write audit log:", auditError);
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const startTime = Date.now();
  console.log("[Ghost] 👻 === THE GHOST AWAKENS ===");

  try {
    // ═══════════════════════════════════════════════
    // Validate all required secrets are present
    // ═══════════════════════════════════════════════
    const requiredSecrets = [
      "GOOGLE_ADS_DEVELOPER_TOKEN",
      "GOOGLE_ADS_CLIENT_ID",
      "GOOGLE_ADS_CLIENT_SECRET",
      "GOOGLE_ADS_REFRESH_TOKEN",
      "GOOGLE_ADS_CUSTOMER_ID",
    ];

    const missingSecrets = requiredSecrets.filter((s) => !Deno.env.get(s));
    if (missingSecrets.length > 0) {
      const errMsg = `Missing required secrets: ${missingSecrets.join(", ")}`;
      console.error(`[Ghost] ❌ ${errMsg}`);
      await logEndpointFailure(supabase, errMsg, { phase: "SECRET_VALIDATION" });
      return new Response(
        JSON.stringify({ error: "CONFIG_ERROR", message: errMsg }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ═══════════════════════════════════════════════
    // Resolve admin user for RLS-bypassed writes
    // ═══════════════════════════════════════════════
    const { data: adminProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "super_admin")
      .limit(1)
      .single();

    if (profileError || !adminProfile) {
      const errMsg = "No super_admin profile found";
      console.error(`[Ghost] ❌ ${errMsg}`);
      await logEndpointFailure(supabase, errMsg, { phase: "ADMIN_RESOLUTION" });
      return new Response(
        JSON.stringify({ error: "SYSTEM_ERROR", message: errMsg }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ═══════════════════════════════════════════════
    // Determine date range (default: yesterday)
    // Supports ?from=YYYY-MM-DD&to=YYYY-MM-DD override
    // ═══════════════════════════════════════════════
    const url = new URL(req.url);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const defaultDate = yesterday.toISOString().split("T")[0];

    const dateFrom = url.searchParams.get("from") || defaultDate;
    const dateTo = url.searchParams.get("to") || defaultDate;

    console.log(`[Ghost] 📅 Date range: ${dateFrom} → ${dateTo}`);

    // ═══════════════════════════════════════════════
    // Execute the pipeline
    // ═══════════════════════════════════════════════
    const accessToken = await refreshAccessToken();
    const rawRows = await fetchAdsCampaignData(accessToken, dateFrom, dateTo);
    const filtered = filterAndTransform(rawRows);

    if (filtered.length === 0) {
      console.log("[Ghost] ℹ️ No sovereign campaigns found for this period");
      return new Response(
        JSON.stringify({
          status: "OK",
          message: "No matching campaigns found",
          date_range: { from: dateFrom, to: dateTo },
          engine_ids: ENGINE_IDS,
          duration_ms: Date.now() - startTime,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await upsertCampaigns(supabase, filtered, adminProfile.id);

    const summary = {
      status: result.errors.length === 0 ? "SUCCESS" : "PARTIAL_SUCCESS",
      campaigns_found: rawRows.length,
      campaigns_filtered: filtered.length,
      campaigns_upserted: result.upserted,
      errors: result.errors,
      date_range: { from: dateFrom, to: dateTo },
      engine_ids: ENGINE_IDS,
      duration_ms: Date.now() - startTime,
    };

    console.log(`[Ghost] 👻 === SYNC COMPLETE === ${JSON.stringify(summary)}`);

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Ghost] ❌ FATAL: ${errMsg}`);

    // Log the failure to the Sentinel
    await logEndpointFailure(supabase, errMsg, {
      phase: "EXECUTION",
      duration_ms: Date.now() - startTime,
    });

    return new Response(
      JSON.stringify({
        error: "ENDPOINT_FAILURE",
        message: errMsg,
        duration_ms: Date.now() - startTime,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
