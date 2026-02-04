import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";

interface ProtectedRouteProps {
  children: ReactNode;
  requireApproval?: boolean;
  requireSuperAdmin?: boolean;
}

export function ProtectedRoute({
  children,
  requireApproval = true,
  requireSuperAdmin = false,
}: ProtectedRouteProps) {
  const { user, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading, isApproved, isSuperAdmin } = useProfile();

  // Show loading while checking auth and profile
  if (authLoading || profileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // Not authenticated - redirect to auth
  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  // No profile yet - might be loading
  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // Require super admin check
  if (requireSuperAdmin && !isSuperAdmin) {
    return <Navigate to="/" replace />;
  }

  // Require approval check - redirect to waiting room
  if (requireApproval && !isApproved) {
    return <Navigate to="/waiting-room" replace />;
  }

  return <>{children}</>;
}
