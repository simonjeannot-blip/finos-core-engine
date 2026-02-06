
-- Fix audit_hash_chain to use schema-qualified digest function
CREATE OR REPLACE FUNCTION public.audit_hash_chain()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_old_hash text;
  v_new_hash text;
  v_record_id uuid;
  v_action text;
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
  ELSE -- UPDATE
    v_record_id := NEW.id;
    v_old_hash := encode(extensions.digest(OLD::text, 'sha256'), 'hex');
    v_new_hash := encode(extensions.digest(NEW::text, 'sha256'), 'hex');
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
$function$;

-- Also fix calculate_s_number to use schema-qualified digest
CREATE OR REPLACE FUNCTION public.calculate_s_number(p_user_id uuid)
 RETURNS TABLE(r_total numeric, p_total numeric, o_total numeric, v_total numeric, d_total numeric, a_total numeric, s_value numeric, calculated_at timestamp with time zone, hash text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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

  SELECT COALESCE(SUM(committed_amount), 0)
  INTO v_a_accruals
  FROM public.committed_accruals
  WHERE user_id = p_user_id AND is_active = true;

  v_a := v_a + v_a_accruals;
  v_s := (v_r - v_p) - (v_o + v_v + v_d + v_a);

  v_hash := encode(
    extensions.digest(
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
$function$;
