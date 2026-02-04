-- Fix the permissive RLS policy for profile inserts
-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Service role can insert profiles" ON public.profiles;

-- The trigger runs with SECURITY DEFINER so it bypasses RLS
-- Regular users should not be able to insert profiles directly
-- Only the trigger should create profiles, so we don't need an INSERT policy