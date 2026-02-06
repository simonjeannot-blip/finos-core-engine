
-- ═══════════════════════════════════════════════════════════════
-- THE DETECTIVE — Probabilistic Matching Engine v1.0
--
-- ARCHITECTURE: BEFORE INSERT trigger on financial_ledger
-- Automatically links revenue entries to booking intent via
-- probabilistic matching on date, table number, and party size.
--
-- MATCHING HIERARCHY (confidence-weighted):
--   1. Table Number Match (90% confidence)
--   2. Time Proximity ≤1hr (75% confidence)  
--   3. Time Proximity ≤3hr (60% confidence)
--   4. Same-Day Fallback (40% confidence)
--
-- COLD CASE: Unmatched entries tagged for manual director review.
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.detective_probabilistic_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_match RECORD;
  v_ledger_timestamp timestamptz;
  v_covers int;
BEGIN
  -- ═══════════════════════════════════════════════════════════
  -- GATE: Only operate on Revenue entries without existing attribution
  -- Skip if category != 'R' or attribution already stamped
  -- ═══════════════════════════════════════════════════════════
  IF NEW.category != 'R' THEN
    RETURN NEW;
  END IF;

  IF NEW.attribution_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- ═══════════════════════════════════════════════════════════
  -- EXTRACT CONTEXT from ledger metadata
  -- transaction_date is DATE only, so we construct a timestamp
  -- using metadata.time if available, else default to 19:00
  -- ═══════════════════════════════════════════════════════════
  v_ledger_timestamp := (
    NEW.transaction_date + COALESCE(
      (NEW.metadata->>'transaction_time')::time,
      TIME '19:00:00'
    )
  )::timestamptz;

  -- Extract covers/party size hint from metadata if available
  v_covers := COALESCE(
    (NEW.metadata->>'covers')::int,
    (NEW.metadata->>'party_size')::int,
    NULL
  );

  -- ═══════════════════════════════════════════════════════════
  -- THE FORENSIC SEARCH — Probabilistic Matching
  --
  -- Score each candidate booking and pick the best match.
  -- Matching criteria (additive confidence scoring):
  --   +40 base: Same-day reservation
  --   +30 table number match
  --   +20 time proximity ≤1hr
  --   +10 time proximity ≤3hr  
  --   +10 party size within ±2 of covers
  --   +5  exact party size match
  -- ═══════════════════════════════════════════════════════════
  SELECT
    b.id AS booking_db_id,
    b.attribution_id,
    b.booking_id,
    b.guest_name,
    b.party_size,
    b.reservation_time,
    b.source AS booking_source,
    -- Confidence score (additive)
    (
      40  -- Base: same-day match
      + CASE
          WHEN NEW.metadata->>'table_number' IS NOT NULL
            AND b.metadata->>'table_number' IS NOT NULL
            AND NEW.metadata->>'table_number' = b.metadata->>'table_number'
          THEN 30
          ELSE 0
        END
      + CASE
          WHEN ABS(EXTRACT(EPOCH FROM (b.reservation_time - v_ledger_timestamp))) <= 3600
          THEN 20
          WHEN ABS(EXTRACT(EPOCH FROM (b.reservation_time - v_ledger_timestamp))) <= 10800
          THEN 10
          ELSE 0
        END
      + CASE
          WHEN v_covers IS NOT NULL AND ABS(b.party_size - v_covers) <= 2
          THEN 10
          ELSE 0
        END
      + CASE
          WHEN v_covers IS NOT NULL AND b.party_size = v_covers
          THEN 5
          ELSE 0
        END
    ) AS confidence_score
  INTO v_match
  FROM public.bookings b
  WHERE
    -- Same-day: reservation falls on the ledger transaction date
    b.reservation_time::date = NEW.transaction_date
    -- Same tenant
    AND b.user_id = NEW.user_id
    -- Active bookings only
    AND b.status IN ('CONFIRMED', 'SEATED', 'COMPLETED')
    -- Within 3-hour window of estimated transaction time
    AND ABS(EXTRACT(EPOCH FROM (b.reservation_time - v_ledger_timestamp))) <= 10800
  ORDER BY
    -- Highest confidence first
    (
      40
      + CASE
          WHEN NEW.metadata->>'table_number' IS NOT NULL
            AND b.metadata->>'table_number' IS NOT NULL
            AND NEW.metadata->>'table_number' = b.metadata->>'table_number'
          THEN 30
          ELSE 0
        END
      + CASE
          WHEN ABS(EXTRACT(EPOCH FROM (b.reservation_time - v_ledger_timestamp))) <= 3600
          THEN 20
          WHEN ABS(EXTRACT(EPOCH FROM (b.reservation_time - v_ledger_timestamp))) <= 10800
          THEN 10
          ELSE 0
        END
      + CASE
          WHEN v_covers IS NOT NULL AND ABS(b.party_size - v_covers) <= 2
          THEN 10
          ELSE 0
        END
      + CASE
          WHEN v_covers IS NOT NULL AND b.party_size = v_covers
          THEN 5
          ELSE 0
        END
    ) DESC,
    -- Tiebreaker: closest reservation time
    ABS(EXTRACT(EPOCH FROM (b.reservation_time - v_ledger_timestamp))) ASC
  LIMIT 1;

  -- ═══════════════════════════════════════════════════════════
  -- THE ATTRIBUTION STAMP
  -- ═══════════════════════════════════════════════════════════
  IF v_match.booking_db_id IS NOT NULL AND v_match.attribution_id IS NOT NULL THEN
    -- FULL MATCH: Booking found with attribution — link the chain
    NEW.attribution_id := v_match.attribution_id;
    NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object(
      'match_status', 'MATCHED',
      'match_method', 'PROBABILISTIC_DETECTIVE',
      'match_confidence', v_match.confidence_score,
      'matched_booking_id', v_match.booking_id,
      'matched_guest', v_match.guest_name,
      'matched_party_size', v_match.party_size,
      'matched_reservation', v_match.reservation_time::text,
      'matched_booking_source', v_match.booking_source,
      'detective_timestamp', now()::text
    );

  ELSIF v_match.booking_db_id IS NOT NULL THEN
    -- PARTIAL MATCH: Booking found but no attribution_id on it
    NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object(
      'match_status', 'MATCHED_NO_ATTRIBUTION',
      'match_method', 'PROBABILISTIC_DETECTIVE',
      'match_confidence', v_match.confidence_score,
      'matched_booking_id', v_match.booking_id,
      'matched_guest', v_match.guest_name,
      'matched_party_size', v_match.party_size,
      'matched_reservation', v_match.reservation_time::text,
      'detective_timestamp', now()::text,
      'detective_note', 'Booking found but has no ad-click attribution. Walk-in or organic.'
    );

  ELSE
    -- ═══════════════════════════════════════════════════════
    -- COLD CASE — No match found
    -- Tagged for manual director review
    -- ═══════════════════════════════════════════════════════
    NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object(
      'match_status', 'UNMATCHED',
      'match_method', 'PROBABILISTIC_DETECTIVE',
      'match_confidence', 0,
      'detective_timestamp', now()::text,
      'detective_note', 'No booking found within 3-hour window. Cold case — flagged for manual review.'
    );
  END IF;

  RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- TRIGGER: Fire Detective on every revenue ledger INSERT
-- BEFORE INSERT so we can modify NEW directly (no extra UPDATE)
-- ═══════════════════════════════════════════════════════════════
CREATE TRIGGER detective_probabilistic_match_trigger
BEFORE INSERT ON public.financial_ledger
FOR EACH ROW
EXECUTE FUNCTION public.detective_probabilistic_match();
