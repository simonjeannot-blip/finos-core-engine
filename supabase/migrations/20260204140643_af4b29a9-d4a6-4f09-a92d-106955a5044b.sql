-- Drop any potentially misconfigured policies on profiles table
DROP POLICY IF EXISTS "Authenticated users can view settings" ON public.profiles;

-- Ensure the correct restrictive policies are in place
-- Users can only view their own profile
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = id);

-- Super admins can view all profiles (for User Management HUD)
DROP POLICY IF EXISTS "Super admins can view all profiles" ON public.profiles;
CREATE POLICY "Super admins can view all profiles" 
ON public.profiles 
FOR SELECT 
USING (is_super_admin(auth.uid()));