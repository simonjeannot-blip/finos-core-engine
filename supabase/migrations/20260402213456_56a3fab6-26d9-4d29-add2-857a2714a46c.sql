
-- ═══════════════════════════════════════════════════════════
-- STEP 1: Create tenants table
-- ═══════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.tenants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can view all tenants"
  ON public.tenants FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Super admins can manage tenants"
  ON public.tenants FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE TRIGGER update_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ═══════════════════════════════════════════════════════════
-- STEP 2: Add tenant_id columns (BEFORE any view changes)
-- ═══════════════════════════════════════════════════════════
ALTER TABLE public.financial_ledger
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);

ALTER TABLE public.committed_accruals
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);

CREATE INDEX IF NOT EXISTS idx_financial_ledger_tenant_id ON public.financial_ledger(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bookings_tenant_id ON public.bookings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_committed_accruals_tenant_id ON public.committed_accruals(tenant_id);

-- ═══════════════════════════════════════════════════════════
-- STEP 3: Drop and recreate absolute_truth_calculator view
-- ═══════════════════════════════════════════════════════════
DROP VIEW IF EXISTS public.absolute_truth_calculator;

CREATE VIEW public.absolute_truth_calculator
WITH (security_invoker = true)
AS
SELECT
  fl.user_id,
  fl.tenant_id,
  COALESCE(SUM(CASE WHEN fl.category = 'R' THEN fl.net_amount ELSE 0 END), 0) AS r_total,
  COALESCE(SUM(CASE WHEN fl.category = 'P' THEN fl.net_amount ELSE 0 END), 0) AS p_total,
  COALESCE(SUM(CASE WHEN fl.category = 'O' THEN fl.net_amount ELSE 0 END), 0) AS o_total,
  COALESCE(SUM(CASE WHEN fl.category = 'V' THEN fl.net_amount ELSE 0 END), 0) AS v_total,
  COALESCE(SUM(CASE WHEN fl.category = 'D' THEN fl.net_amount ELSE 0 END), 0) AS d_total,
  COALESCE(SUM(CASE WHEN fl.category = 'A' THEN fl.net_amount ELSE 0 END), 0)
    + COALESCE(ca.accrual_total, 0) AS a_total,
  COALESCE(SUM(CASE WHEN fl.category = 'R' THEN fl.net_amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN fl.category = 'P' THEN fl.net_amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN fl.category = 'O' THEN fl.net_amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN fl.category = 'V' THEN fl.net_amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN fl.category = 'D' THEN fl.net_amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN fl.category = 'A' THEN fl.net_amount ELSE 0 END), 0)
    - COALESCE(ca.accrual_total, 0) AS s_value
FROM public.financial_ledger fl
LEFT JOIN (
  SELECT user_id, tenant_id, SUM(committed_amount) AS accrual_total
  FROM public.committed_accruals
  WHERE is_active = true
  GROUP BY user_id, tenant_id
) ca ON ca.user_id = fl.user_id AND ca.tenant_id IS NOT DISTINCT FROM fl.tenant_id
GROUP BY fl.user_id, fl.tenant_id, ca.accrual_total;

-- ═══════════════════════════════════════════════════════════
-- STEP 4: Create sales_ledger view
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW public.sales_ledger
WITH (security_invoker = true)
AS
SELECT
  fl.id,
  fl.user_id,
  fl.tenant_id,
  fl.transaction_date,
  fl.vendor_name,
  fl.net_amount,
  fl.vat_amount,
  fl.gross_amount,
  fl.attribution_id,
  fl.metadata,
  fl.created_at
FROM public.financial_ledger fl
WHERE fl.category = 'R';

-- ═══════════════════════════════════════════════════════════
-- STEP 5: Seed Haggerston tenant
-- ═══════════════════════════════════════════════════════════
INSERT INTO public.tenants (id, name, slug)
VALUES ('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'Haggerston', 'haggerston')
ON CONFLICT (slug) DO NOTHING;
