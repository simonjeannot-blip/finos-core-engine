import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ═══════════════════════════════════════════════════════════════
// MODUS ARMS — SOVEREIGN BOOKING INTAKE v1.0
//
// ARCHITECTURE: Raw-First, Parse-Second (mirrors Revenue Intake)
// 1. Authenticate (Header OR URL fallback: ?key=)
// 2. LAND raw payload into raw_data_stream (PENDING)
// 3. Parse booking payload → write to bookings table
// 4. Mark stream as PROCESSED
//
// SOURCES:
//   - MO_MANGIO_BOOKING  (Internal app, carries attribution_id)
//   - OPENTABLE          (Third-party webhook)
//   - SEVENROOMS         (Third-party webhook)
//   - MANUAL_BOOKING     (Manual entry fallback)
//
// THE DETECTIVE BRIDGE:
//   Mo' Mangio! bookings carry attribution_id from ad clicks,
//   enabling Click-to-Cover revenue attribution.
//   Third-party bookings use guest_email + reservation_time
//   for matching.
// ═══════════════════════════════════════════════════════════════

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

// ═══════════════════════════════════════════════════════════════
// BOOKING PAYLOAD INTERFACE
// ═══════════════════════════════════════════════════════════════
interface BookingPayload {
  booking_id?: string;
  guest_name?: string;
  guest_email?: string;
  guest_phone?: string;
  party_size?: number;
  reservation_time?: string;
  source?: string;
  status?: string;
  attribution_id?: string;
  metadata?: Record<string, unknown>;
  // OpenTable/SevenRooms webhook fields
  covers?: number;
  date?: string;
  time?: string;
  customer?: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
  };
  confirmation_number?: string;
  reservation_id?: string;
}

// ═══════════════════════════════════════════════════════════════
// NORMALIZER — Unify all booking formats into canonical shape
// ═══════════════════════════════════════════════════════════════
function normalizeBooking(payload: BookingPayload, source: string): {
  booking_id: string;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  party_size: number;
  reservation_time: string;
  status: string;
  attribution_id: string | null;
  metadata: Record<string, unknown>;
} {
  switch (source) {
    case "OPENTABLE": {
      // OpenTable webhook normalization
      const guestName = payload.customer
        ? `${payload.customer.first_name || ""} ${payload.customer.last_name || ""}`.trim()
        : payload.guest_name || "Unknown Guest";

      const reservationTime = payload.reservation_time
        || (payload.date && payload.time ? `${payload.date}T${payload.time}` : null)
        || new Date().toISOString();

      return {
        booking_id: payload.confirmation_number || payload.booking_id || `OT-${Date.now()}`,
        guest_name: guestName,
        guest_email: payload.customer?.email || payload.guest_email || null,
        guest_phone: payload.customer?.phone || payload.guest_phone || null,
        party_size: payload.covers || payload.party_size || 1,
        reservation_time: reservationTime,
        status: payload.status || "CONFIRMED",
        attribution_id: null, // Third-party — no attribution
        metadata: {
          original_source: "OPENTABLE",
          raw_confirmation: payload.confirmation_number,
          ...(payload.metadata || {}),
        },
      };
    }

    case "SEVENROOMS": {
      // SevenRooms webhook normalization
      const guestName = payload.customer
        ? `${payload.customer.first_name || ""} ${payload.customer.last_name || ""}`.trim()
        : payload.guest_name || "Unknown Guest";

      const reservationTime = payload.reservation_time
        || (payload.date && payload.time ? `${payload.date}T${payload.time}` : null)
        || new Date().toISOString();

      return {
        booking_id: payload.reservation_id || payload.booking_id || `SR-${Date.now()}`,
        guest_name: guestName,
        guest_email: payload.customer?.email || payload.guest_email || null,
        guest_phone: payload.customer?.phone || payload.guest_phone || null,
        party_size: payload.covers || payload.party_size || 1,
        reservation_time: reservationTime,
        status: payload.status || "CONFIRMED",
        attribution_id: null, // Third-party — no attribution
        metadata: {
          original_source: "SEVENROOMS",
          raw_reservation_id: payload.reservation_id,
          ...(payload.metadata || {}),
        },
      };
    }

    case "MO_MANGIO_BOOKING":
    default: {
      // Mo' Mangio! internal bookings — carry attribution_id
      return {
        booking_id: payload.booking_id || `MM-${Date.now()}`,
        guest_name: payload.guest_name || "Unknown Guest",
        guest_email: payload.guest_email || null,
        guest_phone: payload.guest_phone || null,
        party_size: payload.party_size || 1,
        reservation_time: payload.reservation_time || new Date().toISOString(),
        status: payload.status || "CONFIRMED",
        attribution_id: payload.attribution_id || null,
        metadata: {
          original_source: source,
          ...(payload.metadata || {}),
        },
      };
    }
  }
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "METHOD_NOT_ALLOWED", message: "Only POST accepted" }),
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
    // Same passport as Revenue Intake
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
      console.warn("🚫 Booking intake auth failed:", providedKey ? "invalid key" : "no key provided");
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
    console.log(`✅ Booking intake auth validated via ${authMethod}`);

    // ═══════════════════════════════════════════════════════════
    // STEP 2: CAPTURE EVERYTHING — Parse Body
    // ═══════════════════════════════════════════════════════════
    let bodyPayload: BookingPayload = {};

    try {
      bodyPayload = await req.json();
    } catch {
      console.log("ℹ️ No JSON body received");
      return new Response(
        JSON.stringify({ error: "INVALID_BODY", message: "Request body must be valid JSON" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine source from URL param, body, or default
    const urlSource = url.searchParams.get("source");
    const dataSource = (
      urlSource || bodyPayload.source || "MANUAL_BOOKING"
    ).toUpperCase();

    // Validate source is one of the accepted types
    const ACCEPTED_SOURCES = [
      "MO_MANGIO_BOOKING",
      "OPENTABLE",
      "SEVENROOMS",
      "MANUAL_BOOKING",
    ];
    const normalizedSource = ACCEPTED_SOURCES.includes(dataSource)
      ? dataSource
      : "MANUAL_BOOKING";

    console.log(`📋 Booking source: ${normalizedSource}`);

    // ═══════════════════════════════════════════════════════════
    // STEP 3: LAND RAW DATA (The Safety Net)
    // Every booking hits raw_data_stream FIRST
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

    const rawPayload = {
      ...bodyPayload,
      _url_source: urlSource,
      _normalized_source: normalizedSource,
      _auth_method: authMethod,
      _received_at: new Date().toISOString(),
    };

    const { data: streamRecord, error: streamError } = await supabase
      .from("raw_data_stream")
      .insert({
        source: normalizedSource,
        payload: rawPayload,
        status: "PENDING",
        user_id: adminProfile.id,
      })
      .select()
      .single();

    if (streamError || !streamRecord) {
      console.error("❌ CRITICAL: Failed to land booking raw data:", streamError);
      return new Response(
        JSON.stringify({
          error: "STREAM_WRITE_FAILED",
          message: "Failed to capture booking data. Retry the request.",
          details: streamError?.message,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const streamId = (streamRecord as Record<string, unknown>).id as string;
    console.log(`📦 Booking raw data landed: stream_id=${streamId}, source=${normalizedSource}`);

    // ═══════════════════════════════════════════════════════════
    // STEP 4: NORMALIZE & WRITE TO BOOKINGS TABLE
    // ═══════════════════════════════════════════════════════════
    try {
      const normalized = normalizeBooking(bodyPayload, normalizedSource);
      console.log(`📝 Normalized booking: ${normalized.booking_id} for ${normalized.guest_name}`);

      // THE DETECTIVE BRIDGE — Validate attribution_id if present
      let validatedAttributionId: string | null = null;
      if (normalized.attribution_id) {
        const { data: leadData } = await supabase
          .from("leads")
          .select("attribution_id")
          .eq("attribution_id", normalized.attribution_id)
          .single();

        if (leadData) {
          validatedAttributionId = normalized.attribution_id;
          console.log(`🔗 Attribution bridge linked: ${validatedAttributionId}`);
        } else {
          console.warn(`⚠️ Attribution ID not found in leads: ${normalized.attribution_id}`);
          // Still store it in metadata for manual reconciliation
          normalized.metadata.unvalidated_attribution_id = normalized.attribution_id;
        }
      }

      // Write to bookings table
      const { data: bookingEntry, error: bookingError } = await supabase
        .from("bookings")
        .insert({
          booking_id: normalized.booking_id,
          guest_name: normalized.guest_name,
          guest_email: normalized.guest_email,
          guest_phone: normalized.guest_phone,
          party_size: normalized.party_size,
          reservation_time: normalized.reservation_time,
          source: normalizedSource,
          status: normalized.status,
          attribution_id: validatedAttributionId,
          user_id: adminProfile.id,
          raw_stream_id: streamId,
          metadata: {
            ...normalized.metadata,
            intake_timestamp: new Date().toISOString(),
            auth_method: authMethod,
          },
        })
        .select("id, booking_id")
        .single();

      if (bookingError) {
        // Check for duplicate booking (unique constraint violation)
        if (bookingError.code === "23505") {
          console.warn(`⚠️ Duplicate booking detected: ${normalized.booking_id}`);

          // Mark stream as DUPLICATE instead of ERROR
          await supabase
            .from("raw_data_stream")
            .update({
              status: "PROCESSED",
              processed_at: new Date().toISOString(),
              error_detail: `DUPLICATE: Booking ${normalized.booking_id} already exists for source ${normalizedSource}`,
            })
            .eq("id", streamId);

          return new Response(
            JSON.stringify({
              success: true,
              status: "DUPLICATE",
              message: `Booking ${normalized.booking_id} already exists`,
              stream_id: streamId,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        throw new Error(`BOOKING_WRITE_FAILED: ${bookingError.message}`);
      }

      console.log(`✅ Booking created: ${bookingEntry.id} (${bookingEntry.booking_id})`);

      // ═══════════════════════════════════════════════════════════
      // STEP 5: MARK STREAM AS PROCESSED
      // ═══════════════════════════════════════════════════════════
      await supabase
        .from("raw_data_stream")
        .update({
          status: "PROCESSED",
          processed_at: new Date().toISOString(),
          ledger_entry_id: bookingEntry.id,
        })
        .eq("id", streamId);

      console.log(`✅ Stream ${streamId} → PROCESSED`);

      return new Response(
        JSON.stringify({
          success: true,
          status: "PROCESSED",
          message: `Booking ${normalized.booking_id} created for ${normalized.guest_name}`,
          booking_id: bookingEntry.booking_id,
          booking_db_id: bookingEntry.id,
          stream_id: streamId,
          attribution_linked: !!validatedAttributionId,
          source: normalizedSource,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );

    } catch (processingError) {
      // ═══════════════════════════════════════════════════════════
      // GRACEFUL FALLBACK — Never lose data
      // Mark stream with error but preserve all raw data
      // ═══════════════════════════════════════════════════════════
      const errorMessage = processingError instanceof Error
        ? processingError.message
        : String(processingError);

      console.error(`❌ Booking processing failed: ${errorMessage}`);

      await supabase
        .from("raw_data_stream")
        .update({
          status: "ERROR",
          error_detail: errorMessage,
          processed_at: new Date().toISOString(),
        })
        .eq("id", streamId);

      return new Response(
        JSON.stringify({
          success: false,
          status: "ERROR",
          message: "Booking data captured but processing failed. Data is safe in raw stream.",
          stream_id: streamId,
          error: errorMessage,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

  } catch (outerError) {
    const errorMessage = outerError instanceof Error ? outerError.message : String(outerError);
    console.error(`❌ CRITICAL booking intake error: ${errorMessage}`);

    return new Response(
      JSON.stringify({
        error: "INTERNAL_ERROR",
        message: errorMessage,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
