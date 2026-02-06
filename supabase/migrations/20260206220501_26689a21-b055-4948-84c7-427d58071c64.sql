
-- ═══════════════════════════════════════════════════════════════
-- SOVEREIGN SECURITY HARDENING — bookings table RLS
-- 
-- ISSUE: All existing policies are RESTRICTIVE (created with 
-- ALTER POLICY ... AS RESTRICTIVE or via migration bug).
-- PostgreSQL requires at least one PERMISSIVE policy to grant
-- access. RESTRICTIVE policies only further narrow — they 
-- cannot grant access on their own.
--
-- FIX: Drop all existing restrictive policies and recreate
-- as PERMISSIVE with proper access control.
-- ═══════════════════════════════════════════════════════════════

-- Step 1: Drop all existing restrictive policies
DROP POLICY IF EXISTS "Super admins can manage all bookings" ON public.bookings;
DROP POLICY IF EXISTS "Super admins can view all bookings" ON public.bookings;
DROP POLICY IF EXISTS "Users can delete their own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Users can insert their own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Users can update their own bookings" ON public.bookings;
DROP POLICY IF EXISTS "Users can view their own bookings" ON public.bookings;

-- Step 2: Ensure RLS is enabled (idempotent)
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Step 3: Recreate as PERMISSIVE policies

-- SELECT: Users can view their own bookings
CREATE POLICY "Users can view their own bookings"
ON public.bookings
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- SELECT: Super admins can view ALL bookings
CREATE POLICY "Super admins can view all bookings"
ON public.bookings
FOR SELECT
TO authenticated
USING (public.is_super_admin(auth.uid()));

-- INSERT: Users can insert their own bookings
CREATE POLICY "Users can insert their own bookings"
ON public.bookings
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- INSERT: Super admins can insert bookings for any user
CREATE POLICY "Super admins can insert any booking"
ON public.bookings
FOR INSERT
TO authenticated
WITH CHECK (public.is_super_admin(auth.uid()));

-- UPDATE: Users can update their own bookings
CREATE POLICY "Users can update their own bookings"
ON public.bookings
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

-- UPDATE: Super admins can update any booking
CREATE POLICY "Super admins can update any booking"
ON public.bookings
FOR UPDATE
TO authenticated
USING (public.is_super_admin(auth.uid()));

-- DELETE: Users can delete their own bookings
CREATE POLICY "Users can delete their own bookings"
ON public.bookings
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- DELETE: Super admins can delete any booking
CREATE POLICY "Super admins can delete any booking"
ON public.bookings
FOR DELETE
TO authenticated
USING (public.is_super_admin(auth.uid()));
