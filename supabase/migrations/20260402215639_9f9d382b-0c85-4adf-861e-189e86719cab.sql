-- Step 1: Add tenant_id column
ALTER TABLE public.siphoned_invoices
ADD COLUMN tenant_id uuid DEFAULT NULL;

-- Step 2: Index for performance
CREATE INDEX idx_siphoned_invoices_tenant_id ON public.siphoned_invoices(tenant_id);

-- Step 3: Backfill existing rows
UPDATE public.siphoned_invoices
SET tenant_id = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
WHERE tenant_id IS NULL;

-- Step 4: Drop old RLS policies
DROP POLICY IF EXISTS "Users can view their own siphoned invoices" ON public.siphoned_invoices;
DROP POLICY IF EXISTS "Users can update their own siphoned invoices" ON public.siphoned_invoices;
DROP POLICY IF EXISTS "Super admins can view all siphoned invoices" ON public.siphoned_invoices;
DROP POLICY IF EXISTS "Super admins can update all siphoned invoices" ON public.siphoned_invoices;

-- Step 5: New tenant-enforced RLS policies
CREATE POLICY "Users can view their own tenant siphoned invoices"
ON public.siphoned_invoices FOR SELECT
TO authenticated
USING (auth.uid() = user_id AND tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Users can update their own tenant siphoned invoices"
ON public.siphoned_invoices FOR UPDATE
TO authenticated
USING (auth.uid() = user_id AND tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Super admins can view tenant siphoned invoices"
ON public.siphoned_invoices FOR SELECT
TO authenticated
USING (public.is_super_admin(auth.uid()) AND tenant_id = public.get_user_tenant_id(auth.uid()));

CREATE POLICY "Super admins can update tenant siphoned invoices"
ON public.siphoned_invoices FOR UPDATE
TO authenticated
USING (public.is_super_admin(auth.uid()) AND tenant_id = public.get_user_tenant_id(auth.uid()));