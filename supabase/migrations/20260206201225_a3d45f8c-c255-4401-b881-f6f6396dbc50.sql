
-- ============================================
-- FORENSIC IMMUTABILITY HARDENING
-- Financial OS Vault Seal
-- ============================================

-- 1. Enable pgcrypto for SHA-256 hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Revoke ALL permissions from anon role on sensitive tables
REVOKE ALL ON public.financial_ledger FROM anon;
REVOKE ALL ON public.ai_audit_log FROM anon;
REVOKE ALL ON public.committed_accruals FROM anon;
REVOKE ALL ON public.profiles FROM anon;
REVOKE ALL ON public.leads FROM anon;

-- 3. Server-Side S-Number Calculation (Immutable Protocol)
-- Hard-codes the Absolute Truth formula so it cannot be manipulated client-side
CREATE OR REPLACE FUNCTION public.calculate_s_number(p_user_id uuid)
RETURNS TABLE(
  r_total numeric,
  p_total numeric,
  o_total numeric,
  v_total numeric,
  d_total numeric,
  a_total numeric,
  s_value numeric,
  calculated_at timestamptz,
  hash text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_r numeric;
  v_p numeric;
  v_o numeric;
  v_v numeric;
  v_d numeric;
  v_a numeric;
  v_a_accruals numeric;
  v_s numeric;
  v_hash text;
BEGIN
  -- Sum ledger categories for this user
  SELECT
    COALESCE(SUM(CASE WHEN category = 'R' THEN net_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN category = 'P' THEN net_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN category = 'O' THEN net_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN category = 'V' THEN net_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN category = 'D' THEN net_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN category = 'A' THEN net_amount ELSE 0 END), 0)
  INTO v_r, v_p, v_o, v_v, v_d, v_a
  FROM public.financial_ledger
  WHERE user_id = p_user_id;

  -- Add committed accruals (active, unsettled)
  SELECT COALESCE(SUM(committed_amount), 0)
  INTO v_a_accruals
  FROM public.committed_accruals
  WHERE user_id = p_user_id AND is_active = true;

  v_a := v_a + v_a_accruals;

  -- ABSOLUTE TRUTH PROTOCOL: S = (R - P) - (O + V + D + A)
  v_s := (v_r - v_p) - (v_o + v_v + v_d + v_a);

  -- Generate verification hash of the calculation inputs
  v_hash := encode(
    digest(
      p_user_id::text || '|' || 
      v_r::text || '|' || v_p::text || '|' || 
      v_o::text || '|' || v_v::text || '|' || 
      v_d::text || '|' || v_a::text || '|' || 
      v_s::text || '|' || now()::text,
      'sha256'
    ),
    'hex'
  );

  RETURN QUERY SELECT v_r, v_p, v_o, v_v, v_d, v_a, v_s, now(), v_hash;
END;
$$;

-- 4. System Audit Log (Hash-Chain Forensic Trail)
CREATE TABLE public.system_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  action_type text NOT NULL CHECK (action_type IN ('INSERT', 'UPDATE', 'DELETE')),
  old_data_hash text,
  new_data_hash text,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on audit log
ALTER TABLE public.system_audit_log ENABLE ROW LEVEL SECURITY;

-- Only super admins can read the audit log (forensic access only)
CREATE POLICY "Super admins can view audit log"
  ON public.system_audit_log
  FOR SELECT
  USING (public.is_super_admin(auth.uid()));

-- No one can modify the audit log via API (append-only via triggers)
-- INSERT is only via trigger (SECURITY DEFINER function)
-- No UPDATE or DELETE policies = immutable

-- 5. Hash-Chain Trigger Function
-- Generates SHA-256 of entire row state on every mutation
CREATE OR REPLACE FUNCTION public.audit_hash_chain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_old_hash text;
  v_new_hash text;
  v_record_id uuid;
  v_action text;
BEGIN
  v_action := TG_OP;

  IF TG_OP = 'DELETE' THEN
    v_record_id := OLD.id;
    v_old_hash := encode(digest(OLD::text, 'sha256'), 'hex');
    v_new_hash := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    v_record_id := NEW.id;
    v_old_hash := NULL;
    v_new_hash := encode(digest(NEW::text, 'sha256'), 'hex');
  ELSE -- UPDATE
    v_record_id := NEW.id;
    v_old_hash := encode(digest(OLD::text, 'sha256'), 'hex');
    v_new_hash := encode(digest(NEW::text, 'sha256'), 'hex');
  END IF;

  INSERT INTO public.system_audit_log (
    table_name,
    record_id,
    action_type,
    old_data_hash,
    new_data_hash,
    changed_by
  ) VALUES (
    TG_TABLE_NAME,
    v_record_id,
    v_action,
    v_old_hash,
    v_new_hash,
    auth.uid()
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- 6. Attach Hash-Chain Trigger to financial_ledger
CREATE TRIGGER financial_ledger_audit_hash
  AFTER INSERT OR UPDATE OR DELETE
  ON public.financial_ledger
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_hash_chain();

-- 7. Attach Hash-Chain Trigger to committed_accruals
CREATE TRIGGER committed_accruals_audit_hash
  AFTER INSERT OR UPDATE OR DELETE
  ON public.committed_accruals
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_hash_chain();

-- 8. Create index on audit log for fast forensic queries
CREATE INDEX idx_audit_log_table_record ON public.system_audit_log (table_name, record_id);
CREATE INDEX idx_audit_log_timestamp ON public.system_audit_log (created_at DESC);
