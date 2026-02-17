-- ═══════════════════════════════════════════════════════════════════════
-- SOVEREIGN MIGRATION v1.0 — Full Schema Export
-- Target: External Supabase Pro project
-- Generated: 2026-02-17
--
-- PREREQUISITES:
--   1. Enable pgcrypto extension (for SHA-256 hashing in audit trail)
--   2. This script is idempotent where possible
--
-- EXTENSIONS REQUIRED:
--   - pgcrypto (digest function for SHA-256 hashing)
--   - uuid-ossp (optional, gen_random_uuid is built-in PG13+)
-- ═══════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- STEP 0: EXTENSIONS
-- ═══════════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ═══════════════════════════════════════════════════════════════
-- STEP 1: ENUMS
-- ═══════════════════════════════════════════════════════════════
DO $$ BEGIN
  CREATE TYPE public.ledger_category AS ENUM ('R', 'P', 'O', 'V', 'D', 'A');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM ('super_admin', 'manager', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- STEP 2: TABLES
-- ═══════════════════════════════════════════════════════════════

-- 1. profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid NOT NULL PRIMARY KEY,
  email text NOT NULL,
  role public.user_role NOT NULL DEFAULT 'viewer',
  is_approved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. app_settings
CREATE TABLE IF NOT EXISTS public.app_settings (
  id text NOT NULL DEFAULT 'global' PRIMARY KEY,
  disable_public_signups boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

-- 3. leads
CREATE TABLE IF NOT EXISTS public.leads (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  attribution_id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  lead_source text,
  logic_leaks text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. financial_ledger
CREATE TABLE IF NOT EXISTS public.financial_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  transaction_date date NOT NULL DEFAULT CURRENT_DATE,
  vendor_name text NOT NULL,
  category public.ledger_category NOT NULL,
  net_amount numeric NOT NULL DEFAULT 0,
  vat_amount numeric NOT NULL DEFAULT 0,
  gross_amount numeric NOT NULL DEFAULT 0,
  pot_id text,
  audit_id uuid,
  attribution_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5. ai_audit_log
CREATE TABLE IF NOT EXISTS public.ai_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  raw_json jsonb NOT NULL,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 6. raw_data_stream
CREATE TABLE IF NOT EXISTS public.raw_data_stream (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'UNKNOWN',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING',
  error_detail text,
  processed_at timestamptz,
  ledger_entry_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 7. bookings
CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id text NOT NULL,
  user_id uuid NOT NULL,
  guest_name text NOT NULL DEFAULT 'Unknown Guest',
  guest_email text,
  guest_phone text,
  party_size integer NOT NULL DEFAULT 1,
  reservation_time timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'UNKNOWN',
  status text NOT NULL DEFAULT 'CONFIRMED',
  attribution_id uuid,
  raw_stream_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 8. ad_campaigns
CREATE TABLE IF NOT EXISTS public.ad_campaigns (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  engine_id text NOT NULL,
  campaign_name text NOT NULL,
  spend_amount numeric NOT NULL DEFAULT 0,
  impressions bigint NOT NULL DEFAULT 0,
  clicks bigint NOT NULL DEFAULT 0,
  date date NOT NULL DEFAULT CURRENT_DATE,
  last_sync_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 9. siphoned_invoices
CREATE TABLE IF NOT EXISTS public.siphoned_invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  sender text NOT NULL DEFAULT 'Unknown',
  subject text NOT NULL DEFAULT '',
  attachment_name text,
  amount_detected numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  received_at timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb DEFAULT '{}'::jsonb,
  ledger_entry_id uuid,
  accrual_entry_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 10. discovered_invoices
CREATE TABLE IF NOT EXISTS public.discovered_invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  scan_id uuid NOT NULL DEFAULT gen_random_uuid(),
  message_id text NOT NULL,
  sender_name text NOT NULL DEFAULT 'Unknown',
  sender_address text NOT NULL DEFAULT 'unknown@unknown',
  sender_domain text NOT NULL DEFAULT 'unknown',
  subject text NOT NULL DEFAULT '',
  filename text NOT NULL DEFAULT '',
  file_size integer NOT NULL DEFAULT 0,
  confidence text NOT NULL DEFAULT 'LOW',
  confidence_reason text NOT NULL DEFAULT '',
  is_known_supplier boolean NOT NULL DEFAULT false,
  is_already_siphoned boolean NOT NULL DEFAULT false,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 11. committed_accruals
CREATE TABLE IF NOT EXISTS public.committed_accruals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  vendor_name text NOT NULL,
  committed_amount numeric NOT NULL DEFAULT 0,
  commitment_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  settled_ledger_id uuid,
  settled_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 12. microsoft_oauth_tokens
CREATE TABLE IF NOT EXISTS public.microsoft_oauth_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  scopes text NOT NULL DEFAULT 'openid offline_access Mail.Read Mail.ReadBasic',
  tenant_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 13. system_audit_log
CREATE TABLE IF NOT EXISTS public.system_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  action_type text NOT NULL,
  old_data_hash text,
  new_data_hash text,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════
-- STEP 3: FOREIGN KEYS
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE public.financial_ledger
  ADD CONSTRAINT financial_ledger_audit_id_fkey
  FOREIGN KEY (audit_id) REFERENCES public.ai_audit_log(id);

ALTER TABLE public.financial_ledger
  ADD CONSTRAINT financial_ledger_attribution_id_fkey
  FOREIGN KEY (attribution_id) REFERENCES public.leads(attribution_id);

ALTER TABLE public.raw_data_stream
  ADD CONSTRAINT raw_data_stream_ledger_entry_id_fkey
  FOREIGN KEY (ledger_entry_id) REFERENCES public.financial_ledger(id);

ALTER TABLE public.committed_accruals
  ADD CONSTRAINT committed_accruals_settled_ledger_id_fkey
  FOREIGN KEY (settled_ledger_id) REFERENCES public.financial_ledger(id);

ALTER TABLE public.siphoned_invoices
  ADD CONSTRAINT siphoned_invoices_ledger_entry_id_fkey
  FOREIGN KEY (ledger_entry_id) REFERENCES public.financial_ledger(id);

ALTER TABLE public.siphoned_invoices
  ADD CONSTRAINT siphoned_invoices_accrual_entry_id_fkey
  FOREIGN KEY (accrual_entry_id) REFERENCES public.committed_accruals(id);

-- Unique constraint on leads.attribution_id for FK reference
ALTER TABLE public.leads
  ADD CONSTRAINT leads_attribution_id_unique UNIQUE (attribution_id);

-- ═══════════════════════════════════════════════════════════════
-- STEP 4: FUNCTIONS
-- ═══════════════════════════════════════════════════════════════

-- 4a. update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 4b. is_super_admin
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = _user_id AND role = 'super_admin'
  )
$$;

-- 4c. get_user_profile
CREATE OR REPLACE FUNCTION public.get_user_profile(_user_id uuid)
RETURNS TABLE(id uuid, email text, role user_role, is_approved boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.id, p.email, p.role, p.is_approved
  FROM public.profiles p WHERE p.id = _user_id
$$;

-- 4d. calculate_s_number (Absolute Truth Protocol)
CREATE OR REPLACE FUNCTION public.calculate_s_number(p_user_id uuid)
RETURNS TABLE(r_total numeric, p_total numeric, o_total numeric, v_total numeric, d_total numeric, a_total numeric, s_value numeric, calculated_at timestamptz, hash text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_r numeric; v_p numeric; v_o numeric; v_v numeric; v_d numeric; v_a numeric;
  v_a_accruals numeric; v_s numeric; v_hash text;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN category = 'R' THEN net_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN category = 'P' THEN net_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN category = 'O' THEN net_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN category = 'V' THEN net_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN category = 'D' THEN net_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN category = 'A' THEN net_amount ELSE 0 END), 0)
  INTO v_r, v_p, v_o, v_v, v_d, v_a
  FROM public.financial_ledger WHERE user_id = p_user_id;

  SELECT COALESCE(SUM(committed_amount), 0) INTO v_a_accruals
  FROM public.committed_accruals WHERE user_id = p_user_id AND is_active = true;

  v_a := v_a + v_a_accruals;
  v_s := (v_r - v_p) - (v_o + v_v + v_d + v_a);

  v_hash := encode(
    extensions.digest(
      p_user_id::text || '|' || v_r::text || '|' || v_p::text || '|' ||
      v_o::text || '|' || v_v::text || '|' || v_d::text || '|' ||
      v_a::text || '|' || v_s::text || '|' || now()::text,
      'sha256'
    ), 'hex'
  );

  RETURN QUERY SELECT v_r, v_p, v_o, v_v, v_d, v_a, v_s, now(), v_hash;
END;
$$;

-- 4e. audit_hash_chain (SHA-256 forensic trail)
CREATE OR REPLACE FUNCTION public.audit_hash_chain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_old_hash text; v_new_hash text; v_record_id uuid; v_action text;
BEGIN
  v_action := TG_OP;
  IF TG_OP = 'DELETE' THEN
    v_record_id := OLD.id;
    v_old_hash := encode(extensions.digest(OLD::text, 'sha256'), 'hex');
    v_new_hash := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    v_record_id := NEW.id;
    v_old_hash := NULL;
    v_new_hash := encode(extensions.digest(NEW::text, 'sha256'), 'hex');
  ELSE
    v_record_id := NEW.id;
    v_old_hash := encode(extensions.digest(OLD::text, 'sha256'), 'hex');
    v_new_hash := encode(extensions.digest(NEW::text, 'sha256'), 'hex');
  END IF;

  INSERT INTO public.system_audit_log (table_name, record_id, action_type, old_data_hash, new_data_hash, changed_by)
  VALUES (TG_TABLE_NAME, v_record_id, v_action, v_old_hash, v_new_hash, auth.uid());

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

-- 4f. detective_probabilistic_match
CREATE OR REPLACE FUNCTION public.detective_probabilistic_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_match RECORD;
  v_ledger_timestamp timestamptz;
  v_covers int;
BEGIN
  IF NEW.category != 'R' THEN RETURN NEW; END IF;
  IF NEW.attribution_id IS NOT NULL THEN RETURN NEW; END IF;

  v_ledger_timestamp := (
    NEW.transaction_date + COALESCE(
      (NEW.metadata->>'transaction_time')::time,
      TIME '19:00:00'
    )
  )::timestamptz;

  v_covers := COALESCE(
    (NEW.metadata->>'covers')::int,
    (NEW.metadata->>'party_size')::int,
    NULL
  );

  SELECT
    b.id AS booking_db_id, b.attribution_id, b.booking_id,
    b.guest_name, b.party_size, b.reservation_time, b.source AS booking_source,
    (
      40
      + CASE WHEN NEW.metadata->>'table_number' IS NOT NULL AND b.metadata->>'table_number' IS NOT NULL AND NEW.metadata->>'table_number' = b.metadata->>'table_number' THEN 30 ELSE 0 END
      + CASE WHEN ABS(EXTRACT(EPOCH FROM (b.reservation_time - v_ledger_timestamp))) <= 3600 THEN 20 WHEN ABS(EXTRACT(EPOCH FROM (b.reservation_time - v_ledger_timestamp))) <= 10800 THEN 10 ELSE 0 END
      + CASE WHEN v_covers IS NOT NULL AND ABS(b.party_size - v_covers) <= 2 THEN 10 ELSE 0 END
      + CASE WHEN v_covers IS NOT NULL AND b.party_size = v_covers THEN 5 ELSE 0 END
    ) AS confidence_score
  INTO v_match
  FROM public.bookings b
  WHERE b.reservation_time::date = NEW.transaction_date
    AND b.user_id = NEW.user_id
    AND b.status IN ('CONFIRMED', 'SEATED', 'COMPLETED')
    AND ABS(EXTRACT(EPOCH FROM (b.reservation_time - v_ledger_timestamp))) <= 10800
  ORDER BY (
    40
    + CASE WHEN NEW.metadata->>'table_number' IS NOT NULL AND b.metadata->>'table_number' IS NOT NULL AND NEW.metadata->>'table_number' = b.metadata->>'table_number' THEN 30 ELSE 0 END
    + CASE WHEN ABS(EXTRACT(EPOCH FROM (b.reservation_time - v_ledger_timestamp))) <= 3600 THEN 20 WHEN ABS(EXTRACT(EPOCH FROM (b.reservation_time - v_ledger_timestamp))) <= 10800 THEN 10 ELSE 0 END
    + CASE WHEN v_covers IS NOT NULL AND ABS(b.party_size - v_covers) <= 2 THEN 10 ELSE 0 END
    + CASE WHEN v_covers IS NOT NULL AND b.party_size = v_covers THEN 5 ELSE 0 END
  ) DESC,
  ABS(EXTRACT(EPOCH FROM (b.reservation_time - v_ledger_timestamp))) ASC
  LIMIT 1;

  IF v_match.booking_db_id IS NOT NULL AND v_match.attribution_id IS NOT NULL THEN
    NEW.attribution_id := v_match.attribution_id;
    NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object(
      'match_status', 'MATCHED', 'match_method', 'PROBABILISTIC_DETECTIVE',
      'match_confidence', v_match.confidence_score, 'matched_booking_id', v_match.booking_id,
      'matched_guest', v_match.guest_name, 'matched_party_size', v_match.party_size,
      'matched_reservation', v_match.reservation_time::text, 'matched_booking_source', v_match.booking_source,
      'detective_timestamp', now()::text
    );
  ELSIF v_match.booking_db_id IS NOT NULL THEN
    NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object(
      'match_status', 'MATCHED_NO_ATTRIBUTION', 'match_method', 'PROBABILISTIC_DETECTIVE',
      'match_confidence', v_match.confidence_score, 'matched_booking_id', v_match.booking_id,
      'matched_guest', v_match.guest_name, 'detective_timestamp', now()::text,
      'detective_note', 'Booking found but has no ad-click attribution. Walk-in or organic.'
    );
  ELSE
    NEW.metadata := COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object(
      'match_status', 'UNMATCHED', 'match_method', 'PROBABILISTIC_DETECTIVE',
      'match_confidence', 0, 'detective_timestamp', now()::text,
      'detective_note', 'No booking found within 3-hour window. Cold case.'
    );
  END IF;

  RETURN NEW;
END;
$$;

-- 4g. handle_new_user (auth trigger)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  user_email TEXT;
  user_role user_role;
  user_approved BOOLEAN;
BEGIN
  user_email := NEW.email;
  IF user_email = 'simon.jeannot@flavorflowstrategy.uk' THEN
    user_role := 'super_admin';
    user_approved := true;
  ELSE
    user_role := 'viewer';
    user_approved := false;
  END IF;
  INSERT INTO public.profiles (id, email, role, is_approved)
  VALUES (NEW.id, user_email, user_role, user_approved);
  RETURN NEW;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- STEP 5: TRIGGERS
-- ═══════════════════════════════════════════════════════════════

-- Auth trigger (run manually in Supabase dashboard SQL editor)
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Updated_at triggers
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_bookings_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_ad_campaigns_updated_at BEFORE UPDATE ON public.ad_campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_siphoned_invoices_updated_at BEFORE UPDATE ON public.siphoned_invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_microsoft_oauth_tokens_updated_at BEFORE UPDATE ON public.microsoft_oauth_tokens FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Audit hash-chain triggers
CREATE TRIGGER audit_financial_ledger AFTER INSERT OR UPDATE OR DELETE ON public.financial_ledger FOR EACH ROW EXECUTE FUNCTION public.audit_hash_chain();
CREATE TRIGGER audit_committed_accruals AFTER INSERT OR UPDATE OR DELETE ON public.committed_accruals FOR EACH ROW EXECUTE FUNCTION public.audit_hash_chain();
CREATE TRIGGER audit_raw_data_stream AFTER INSERT OR UPDATE OR DELETE ON public.raw_data_stream FOR EACH ROW EXECUTE FUNCTION public.audit_hash_chain();
CREATE TRIGGER audit_bookings AFTER INSERT OR UPDATE OR DELETE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.audit_hash_chain();
CREATE TRIGGER audit_ad_campaigns AFTER INSERT OR UPDATE OR DELETE ON public.ad_campaigns FOR EACH ROW EXECUTE FUNCTION public.audit_hash_chain();

-- Detective trigger on ledger inserts
CREATE TRIGGER detective_match_on_revenue BEFORE INSERT ON public.financial_ledger FOR EACH ROW EXECUTE FUNCTION public.detective_probabilistic_match();

-- ═══════════════════════════════════════════════════════════════
-- STEP 6: VIEW — Absolute Truth Calculator
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.absolute_truth_calculator
WITH (security_invoker = true)
AS
SELECT
  fl.user_id,
  COALESCE(SUM(CASE WHEN fl.category = 'R' THEN fl.net_amount ELSE 0 END), 0) AS r_total,
  COALESCE(SUM(CASE WHEN fl.category = 'P' THEN fl.net_amount ELSE 0 END), 0) AS p_total,
  COALESCE(SUM(CASE WHEN fl.category = 'O' THEN fl.net_amount ELSE 0 END), 0) AS o_total,
  COALESCE(SUM(CASE WHEN fl.category = 'V' THEN fl.net_amount ELSE 0 END), 0) AS v_total,
  COALESCE(SUM(CASE WHEN fl.category = 'D' THEN fl.net_amount ELSE 0 END), 0) AS d_total,
  COALESCE(SUM(CASE WHEN fl.category = 'A' THEN fl.net_amount ELSE 0 END), 0)
    + COALESCE(ca.accrual_total, 0) AS a_total,
  COALESCE(SUM(CASE WHEN fl.category = 'R' THEN fl.net_amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN fl.category = 'P' THEN fl.net_amount ELSE 0 END), 0)
    - (
      COALESCE(SUM(CASE WHEN fl.category = 'O' THEN fl.net_amount ELSE 0 END), 0)
      + COALESCE(SUM(CASE WHEN fl.category = 'V' THEN fl.net_amount ELSE 0 END), 0)
      + COALESCE(SUM(CASE WHEN fl.category = 'D' THEN fl.net_amount ELSE 0 END), 0)
      + COALESCE(SUM(CASE WHEN fl.category = 'A' THEN fl.net_amount ELSE 0 END), 0)
      + COALESCE(ca.accrual_total, 0)
    ) AS s_value
FROM public.financial_ledger fl
LEFT JOIN (
  SELECT user_id, SUM(committed_amount) AS accrual_total
  FROM public.committed_accruals
  WHERE is_active = true
  GROUP BY user_id
) ca ON ca.user_id = fl.user_id
GROUP BY fl.user_id, ca.accrual_total;

-- ═══════════════════════════════════════════════════════════════
-- STEP 7: ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_data_stream ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siphoned_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discovered_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.committed_accruals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.microsoft_oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_audit_log ENABLE ROW LEVEL SECURITY;

-- ── profiles ──
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Super admins can view all profiles" ON public.profiles FOR SELECT USING (is_super_admin(auth.uid()));
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Super admins can update all profiles" ON public.profiles FOR UPDATE USING (is_super_admin(auth.uid()));

-- ── app_settings ──
CREATE POLICY "Authenticated users can view settings" ON public.app_settings FOR SELECT USING (true);
CREATE POLICY "Super admins can update settings" ON public.app_settings FOR UPDATE USING (is_super_admin(auth.uid()));

-- ── leads ──
CREATE POLICY "Users can view their own leads" ON public.leads FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own leads" ON public.leads FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own leads" ON public.leads FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own leads" ON public.leads FOR DELETE USING (auth.uid() = user_id);

-- ── financial_ledger ──
CREATE POLICY "Users can view their own ledger entries" ON public.financial_ledger FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own ledger entries" ON public.financial_ledger FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own ledger entries" ON public.financial_ledger FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own ledger entries" ON public.financial_ledger FOR DELETE USING (auth.uid() = user_id);

-- ── ai_audit_log ──
CREATE POLICY "Users can view their own audit logs" ON public.ai_audit_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own audit logs" ON public.ai_audit_log FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own audit logs" ON public.ai_audit_log FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own audit logs" ON public.ai_audit_log FOR DELETE USING (auth.uid() = user_id);

-- ── raw_data_stream ──
CREATE POLICY "Users can view their own stream data" ON public.raw_data_stream FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own stream data" ON public.raw_data_stream FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own stream data" ON public.raw_data_stream FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Super admins can view all stream data" ON public.raw_data_stream FOR SELECT USING (is_super_admin(auth.uid()));

-- ── bookings ──
CREATE POLICY "Users can view their own bookings" ON public.bookings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Super admins can view all bookings" ON public.bookings FOR SELECT USING (is_super_admin(auth.uid()));
CREATE POLICY "Users can insert their own bookings" ON public.bookings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Super admins can insert any booking" ON public.bookings FOR INSERT WITH CHECK (is_super_admin(auth.uid()));
CREATE POLICY "Users can update their own bookings" ON public.bookings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Super admins can update any booking" ON public.bookings FOR UPDATE USING (is_super_admin(auth.uid()));
CREATE POLICY "Users can delete their own bookings" ON public.bookings FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Super admins can delete any booking" ON public.bookings FOR DELETE USING (is_super_admin(auth.uid()));

-- ── ad_campaigns ──
CREATE POLICY "Users can view their own ad campaigns" ON public.ad_campaigns FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Super admins can view all ad campaigns" ON public.ad_campaigns FOR SELECT USING (is_super_admin(auth.uid()));
CREATE POLICY "Users can insert their own ad campaigns" ON public.ad_campaigns FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own ad campaigns" ON public.ad_campaigns FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Super admins can update all ad campaigns" ON public.ad_campaigns FOR UPDATE USING (is_super_admin(auth.uid()));
CREATE POLICY "Users can delete their own ad campaigns" ON public.ad_campaigns FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Super admins can delete all ad campaigns" ON public.ad_campaigns FOR DELETE USING (is_super_admin(auth.uid()));

-- ── siphoned_invoices ──
CREATE POLICY "Users can view their own siphoned invoices" ON public.siphoned_invoices FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Super admins can view all siphoned invoices" ON public.siphoned_invoices FOR SELECT USING (is_super_admin(auth.uid()));
CREATE POLICY "Users can update their own siphoned invoices" ON public.siphoned_invoices FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Super admins can update all siphoned invoices" ON public.siphoned_invoices FOR UPDATE USING (is_super_admin(auth.uid()));

-- ── discovered_invoices ──
CREATE POLICY "Users can view their own discovered invoices" ON public.discovered_invoices FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Super admins can view all discovered invoices" ON public.discovered_invoices FOR SELECT USING (is_super_admin(auth.uid()));
CREATE POLICY "Users can delete their own discovered invoices" ON public.discovered_invoices FOR DELETE USING (auth.uid() = user_id);

-- ── committed_accruals ──
CREATE POLICY "Users can view their own accruals" ON public.committed_accruals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own accruals" ON public.committed_accruals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own accruals" ON public.committed_accruals FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own accruals" ON public.committed_accruals FOR DELETE USING (auth.uid() = user_id);

-- ── microsoft_oauth_tokens ──
CREATE POLICY "Super admins can view oauth tokens" ON public.microsoft_oauth_tokens FOR SELECT USING (is_super_admin(auth.uid()));

-- ── system_audit_log ──
CREATE POLICY "Super admins can view audit log" ON public.system_audit_log FOR SELECT USING (is_super_admin(auth.uid()));

-- ═══════════════════════════════════════════════════════════════
-- STEP 8: SEED DATA
-- ═══════════════════════════════════════════════════════════════
INSERT INTO public.app_settings (id, disable_public_signups)
VALUES ('global', false)
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- STEP 9: STORAGE BUCKET
-- ═══════════════════════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public) VALUES ('receipts', 'receipts', true)
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- MIGRATION COMPLETE
-- ═══════════════════════════════════════════════════════════════
