import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, Shield, LogOut } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export default function WaitingRoom() {
  const navigate = useNavigate();
  const { signOut, user } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg text-center">
        <CardHeader className="space-y-4">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Clock className="h-8 w-8 text-muted-foreground" />
          </div>
          <CardTitle className="text-2xl font-bold">Access Pending</CardTitle>
          <CardDescription className="text-base">
            Your account is awaiting approval from the Architect
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg border bg-muted/50 p-4 text-left">
            <div className="flex items-start gap-3">
              <Shield className="mt-0.5 h-5 w-5 text-primary" />
              <div className="space-y-1">
                <p className="text-sm font-medium">Sovereign Access Control Active</p>
                <p className="text-sm text-muted-foreground">
                  The Financial OS operates under strict access control. Only verified 
                  and approved users may access the Absolute Truth Protocol dashboard.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              <strong>Signed in as:</strong> {user?.email}
            </p>
            <p>
              You will be granted access once the system administrator reviews 
              and approves your account. This typically happens within 24-48 hours.
            </p>
          </div>

          <Button variant="outline" onClick={handleSignOut} className="w-full">
            <LogOut className="mr-2 h-4 w-4" />
            Sign Out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
