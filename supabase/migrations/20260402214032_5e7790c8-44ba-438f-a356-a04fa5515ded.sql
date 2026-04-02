
-- ═══════════════════════════════════════════════════════════
-- Security definer function for tenant resolution
-- Future: replace body with tenant_members lookup
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_user_tenant_id(_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Phase 1: Single-tenant hardcode (Haggerston)
  -- Phase 2: SELECT tenant_id FROM tenant_members WHERE user_id = _user_id LIMIT 1
  SELECT '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid
$$;

-- ═══════════════════════════════════════════════════════════
-- FINANCIAL_LEDGER — Drop old, create tenant-aware
-- ═══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Users can view their own ledger entries" ON public.financial_ledger;
DROP POLICY IF EXISTS "Users can insert their own ledger entries" ON public.financial_ledger;
DROP POLICY IF EXISTS "Users can update their own ledger entries" ON public.financial_ledger;
DROP POLICY IF EXISTS "Users can delete their own ledger entries" ON public.financial_ledger;

CREATE POLICY "Users can view their own tenant ledger"
  ON public.financial_ledger FOR SELECT
  USING (auth.uid() = user_id AND tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can insert into their own tenant ledger"
  ON public.financial_ledger FOR INSERT
  WITH CHECK (auth.uid() = user_id AND tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can update their own tenant ledger"
  ON public.financial_ledger FOR UPDATE
  USING (auth.uid() = user_id AND tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can delete their own tenant ledger"
  ON public.financial_ledger FOR DELETE
  USING (auth.uid() = user_id AND tenant_id = public.get_user_tenant_id(auth.uid()));

-- ═══════════════════════════════════════════════════════════
-- BOOKINGS — Drop old, create tenant-aware
-- ═══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Users can view their own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Users can insert their own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Users can update their own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Users can delete their own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Super admins can view all bookings" ON public.bookings;
DROP POLICY IF EXISTS "Super admins can insert any booking" ON public.bookings;
DROP POLICY IF EXISTS "Super admins can update any booking" ON public.bookings;
DROP POLICY IF EXISTS "Super admins can delete any booking" ON public.bookings;

CREATE POLICY "Users can view their own tenant bookings"
  ON public.bookings FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can insert their own tenant bookings"
  ON public.bookings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can update their own tenant bookings"
  ON public.bookings FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can delete their own tenant bookings"
  ON public.bookings FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Super admins can view tenant bookings"
  ON public.bookings FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) AND tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Super admins can insert tenant bookings"
  ON public.bookings FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()) AND tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Super admins can update tenant bookings"
  ON public.bookings FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()) AND tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Super admins can delete tenant bookings"
  ON public.bookings FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()) AND tenant_id = public.get_user_tenant_id(auth.uid()));

-- ═══════════════════════════════════════════════════════════
-- COMMITTED_ACCRUALS — Drop old, create tenant-aware
-- ═══════════════════════════════════════════════════════════
DROP POLICY IF EXISTS "Users can view their own accruals" ON public.committed_accruals;
DROP POLICY IF EXISTS "Users can insert their own accruals" ON public.committed_accruals;
DROP POLICY IF EXISTS "Users can update their own accruals" ON public.committed_accruals;
DROP POLICY IF EXISTS "Users can delete their own accruals" ON public.committed_accruals;

CREATE POLICY "Users can view their own tenant accruals"
  ON public.committed_accruals FOR SELECT
  USING (auth.uid() = user_id AND tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can insert their own tenant accruals"
  ON public.committed_accruals FOR INSERT
  WITH CHECK (auth.uid() = user_id AND tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can update their own tenant accruals"
  ON public.committed_accruals FOR UPDATE
  USING (auth.uid() = user_id AND tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can delete their own tenant accruals"
  ON public.committed_accruals FOR DELETE
  USING (auth.uid() = user_id AND tenant_id = public.get_user_tenant_id(auth.uid()));
