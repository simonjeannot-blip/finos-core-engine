import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export type UserRole = "super_admin" | "manager" | "viewer";

export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  is_approved: boolean;
}

export function useProfile() {
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    const fetchProfile = async () => {
      try {
        // Use the security definer function to get profile
        const { data, error } = await supabase
          .rpc('get_user_profile', { _user_id: user.id });

        if (error) {
          console.error("Error fetching profile:", error);
          setProfile(null);
        } else if (data && data.length > 0) {
          const profileData = data[0];
          setProfile({
            id: profileData.id,
            email: profileData.email,
            role: profileData.role as UserRole,
            is_approved: profileData.is_approved,
          });
        } else {
          setProfile(null);
        }
      } catch (err) {
        console.error("Error fetching profile:", err);
        setProfile(null);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [user, authLoading]);

  const isSuperAdmin = profile?.role === "super_admin";
  const isApproved = profile?.is_approved === true;

  return {
    profile,
    loading: authLoading || loading,
    isSuperAdmin,
    isApproved,
  };
}
