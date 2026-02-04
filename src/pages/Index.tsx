import { useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LogOut, Shield } from "lucide-react";
import { CategoryCard } from "@/components/CategoryCard";
import { AbsoluteTruthDisplay } from "@/components/AbsoluteTruthDisplay";
import { LedgerTable } from "@/components/LedgerTable";
import { UploadButton } from "@/components/UploadButton";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useLedger, useAbsoluteTruth, LedgerCategory } from "@/hooks/useLedger";

const CATEGORIES: LedgerCategory[] = ["R", "P", "O", "V", "D", "A"];

export default function Index() {
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();
  const { isSuperAdmin } = useProfile();
  const { data: ledgerEntries, isLoading: ledgerLoading, refetch: refetchLedger } = useLedger();
  const { data: totals, refetch: refetchTotals } = useAbsoluteTruth();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  // Callback to refresh data after successful upload
  const handleUploadSuccess = useCallback(() => {
    refetchLedger();
    refetchTotals();
  }, [refetchLedger, refetchTotals]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const getCategoryTotal = (category: LedgerCategory): number => {
    if (!totals) return 0;
    const key = `${category.toLowerCase()}_total` as keyof typeof totals;
    return Number(totals[key]) || 0;
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-xl font-bold">Financial OS</h1>
            <p className="text-sm text-muted-foreground">
              Verification Dashboard
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isSuperAdmin && (
              <Link to="/admin">
                <Button variant="outline" size="sm">
                  <Shield className="mr-2 h-4 w-4" />
                  Admin
                </Button>
              </Link>
            )}
            <UploadButton userId={user.id} onSuccess={handleUploadSuccess} />
            <Button variant="outline" size="icon" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 space-y-6">
        {/* Category Summary Cards */}
        <section>
          <h2 className="mb-4 text-lg font-semibold">Category Totals</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {CATEGORIES.map((category) => (
              <CategoryCard
                key={category}
                category={category}
                total={getCategoryTotal(category)}
              />
            ))}
          </div>
        </section>

        {/* Absolute Truth Calculator */}
        <section className="max-w-md">
          <AbsoluteTruthDisplay totals={totals ?? null} />
        </section>

        {/* Ledger Table */}
        <section>
          <h2 className="mb-4 text-lg font-semibold">Ledger Entries</h2>
          <LedgerTable
            entries={ledgerEntries ?? []}
            isLoading={ledgerLoading}
          />
        </section>
      </main>
    </div>
  );
}
