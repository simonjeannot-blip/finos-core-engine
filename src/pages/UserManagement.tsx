import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Shield, Users, Settings } from "lucide-react";
import { SiphonControl } from "@/components/SiphonControl";
import { DiscoveryView } from "@/components/DiscoveryView";
import { OAuthCallbackCatcher } from "@/components/OAuthCallbackCatcher";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useProfile, UserRole } from "@/hooks/useProfile";
import { useAppSettings } from "@/hooks/useAppSettings";
import { supabase } from "@/integrations/supabase/client";

interface ProfileRow {
  id: string;
  email: string;
  role: UserRole;
  is_approved: boolean;
  created_at: string;
}

export default function UserManagement() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading, isSuperAdmin } = useProfile();
  const { settings, loading: settingsLoading, updateSettings } = useAppSettings();
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
      return;
    }

    if (!profileLoading && !isSuperAdmin) {
      navigate("/");
      return;
    }
  }, [user, authLoading, profileLoading, isSuperAdmin, navigate]);

  useEffect(() => {
    if (isSuperAdmin) {
      fetchUsers();
    }
  }, [isSuperAdmin]);

  const fetchUsers = async () => {
    setLoadingUsers(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      toast({
        title: "Error loading users",
        description: error.message,
        variant: "destructive",
      });
    } else {
      setUsers(data as ProfileRow[]);
    }
    setLoadingUsers(false);
  };

  const handleApprovalToggle = async (userId: string, currentApproved: boolean) => {
    const { error } = await supabase
      .from("profiles")
      .update({ is_approved: !currentApproved })
      .eq("id", userId);

    if (error) {
      toast({
        title: "Error updating user",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "User updated",
        description: `User ${!currentApproved ? "approved" : "unapproved"} successfully.`,
      });
      fetchUsers();
    }
  };

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    const { error } = await supabase
      .from("profiles")
      .update({ role: newRole })
      .eq("id", userId);

    if (error) {
      toast({
        title: "Error updating role",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Role updated",
        description: `User role changed to ${newRole}.`,
      });
      fetchUsers();
    }
  };

  const handleSignupsToggle = async () => {
    if (!settings) return;

    const { error } = await updateSettings({
      disable_public_signups: !settings.disable_public_signups,
    });

    if (error) {
      toast({
        title: "Error updating settings",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Settings updated",
        description: `Public sign-ups ${!settings.disable_public_signups ? "disabled" : "enabled"}.`,
      });
    }
  };

  const getRoleBadgeVariant = (role: UserRole) => {
    switch (role) {
      case "super_admin":
        return "default";
      case "manager":
        return "secondary";
      default:
        return "outline";
    }
  };

  if (authLoading || profileLoading || settingsLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isSuperAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Admin Console
              </h1>
              <p className="text-sm text-muted-foreground">
                Sovereign Access Control
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* OAuth Callback Catcher — intercepts Microsoft redirects */}
        <OAuthCallbackCatcher />

        {/* Settings Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              System Settings
            </CardTitle>
            <CardDescription>
              Configure access control for the Financial OS
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="invite-only">Invite-Only Mode</Label>
                <p className="text-sm text-muted-foreground">
                  When enabled, only users manually invited can create accounts
                </p>
              </div>
              <Switch
                id="invite-only"
                checked={settings?.disable_public_signups ?? false}
                onCheckedChange={handleSignupsToggle}
              />
            </div>
          </CardContent>
        </Card>

        {/* Ghost Siphon — Inbox Control */}
        <SiphonControl />

        {/* Ghost Siphon — Deep Discovery Scanner */}
        <DiscoveryView />

        {/* Users Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              User Management
            </CardTitle>
            <CardDescription>
              Manage user access and roles
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingUsers ? (
              <div className="flex justify-center py-8">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell className="font-medium">{u.email}</TableCell>
                        <TableCell>
                          <Select
                            value={u.role}
                            onValueChange={(value) =>
                              handleRoleChange(u.id, value as UserRole)
                            }
                            disabled={u.id === profile?.id}
                          >
                            <SelectTrigger className="w-32">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="viewer">Viewer</SelectItem>
                              <SelectItem value="manager">Manager</SelectItem>
                              <SelectItem value="super_admin">Super Admin</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={u.is_approved ? "default" : "secondary"}
                          >
                            {u.is_approved ? "Approved" : "Pending"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Switch
                            checked={u.is_approved}
                            onCheckedChange={() =>
                              handleApprovalToggle(u.id, u.is_approved)
                            }
                            disabled={u.id === profile?.id}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
