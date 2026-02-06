import { useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { LogOut, Shield } from "lucide-react";
import { CategoryCard } from "@/components/CategoryCard";
import { AbsoluteTruthDisplay } from "@/components/AbsoluteTruthDisplay";
import { LedgerTable } from "@/components/LedgerTable";
import { UploadButton } from "@/components/UploadButton";
import { SyncButton } from "@/components/SyncButton";
import { LivePulse } from "@/components/LivePulse";
import { CompliancePulse } from "@/components/CompliancePulse";
import { StrategyToggle } from "@/components/StrategyToggle";
import { SNumberHUD } from "@/components/SNumberHUD";
import { StressTestChart } from "@/components/StressTestChart";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useLedger, useAbsoluteTruth, LedgerCategory } from "@/hooks/useLedger";
import { useIsMobile } from "@/hooks/use-mobile";
import { useStrategy } from "@/hooks/useStrategy";

const CATEGORIES: LedgerCategory[] = ["R", "P", "O", "V", "D", "A"];

export default function Index() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { user, loading: authLoading, signOut } = useAuth();
  const { isSuperAdmin } = useProfile();
  const { data: ledgerEntries, isLoading: ledgerLoading, refetch: refetchLedger } = useLedger();
  const { data: totals, refetch: refetchTotals } = useAbsoluteTruth();
  const { strategy, setStrategy, result, allResults } = useStrategy();

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
    <div className="min-h-screen bg-background pb-24 md:pb-6">
      {/* Header - Compact on mobile */}
      <header className="border-b bg-card sticky top-0 z-40">
        <div className="container mx-auto flex items-center justify-between px-4 py-3 md:py-4">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-lg md:text-xl font-bold">Financial OS</h1>
              {!isMobile && (
                <p className="text-sm text-muted-foreground">
                  Verification Dashboard
                </p>
              )}
            </div>
            {/* Live Pulse Indicator */}
            <LivePulse />
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            {/* Sync Button */}
            {!isMobile && <SyncButton />}
            {isSuperAdmin && (
              <Link to="/admin">
                <Button variant="outline" size={isMobile ? "icon" : "sm"}>
                  <Shield className={isMobile ? "h-4 w-4" : "mr-2 h-4 w-4"} />
                  {!isMobile && "Admin"}
                </Button>
              </Link>
            )}
            {/* Upload button only in header on desktop */}
            {!isMobile && (
              <UploadButton userId={user.id} onSuccess={handleUploadSuccess} />
            )}
            <Button variant="outline" size="icon" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-4 md:py-6 space-y-6">
        {/* Mobile: Absolute Truth first and prominent */}
        {isMobile && (
          <section className="space-y-3">
            <AbsoluteTruthDisplay totals={totals ?? null} prominent />
            <div className="flex justify-center">
              <SyncButton />
            </div>
          </section>
        )}

        {/* Category Summary Cards */}
        <section>
          <h2 className="mb-3 md:mb-4 text-base md:text-lg font-semibold">
            Category Totals
          </h2>
          {/* Mobile: Single column, Desktop: Grid */}
          <div className={
            isMobile 
              ? "flex flex-col gap-3" 
              : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
          }>
            {CATEGORIES.map((category) => (
              <CategoryCard
                key={category}
                category={category}
                total={getCategoryTotal(category)}
              />
            ))}
          </div>
        </section>

        {/* Strategy Engine Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base md:text-lg font-semibold">
              Reality Mirror™ Engine
            </h2>
            <StrategyToggle value={strategy} onChange={setStrategy} compact />
          </div>
          
          <div className={isMobile ? "space-y-4" : "grid gap-6 md:grid-cols-2"}>
            <SNumberHUD 
              result={result} 
              allResults={allResults} 
              showBreakdown={!isMobile}
            />
            <StressTestChart results={allResults} activeStrategy={strategy} />
          </div>
        </section>

        {/* Absolute Truth Calculator - Desktop only (mobile shows at top) */}
        {!isMobile && (
          <section className="grid gap-6 md:grid-cols-2">
            <AbsoluteTruthDisplay totals={totals ?? null} />
            <CompliancePulse totals={totals ?? null} />
          </section>
        )}

        {/* Ledger Table / Card View */}
        <section>
          <h2 className="mb-3 md:mb-4 text-base md:text-lg font-semibold">
            {isMobile ? "Recent Transactions" : "Ledger Entries"}
          </h2>
          <LedgerTable
            entries={ledgerEntries ?? []}
            isLoading={ledgerLoading}
          />
        </section>
      </main>

      {/* Mobile: Floating Upload Button - Thumb Zone */}
      {isMobile && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-background via-background to-transparent pointer-events-none z-50">
          <div className="pointer-events-auto flex justify-center">
            <UploadButton 
              userId={user.id} 
              onSuccess={handleUploadSuccess} 
              variant="floating"
            />
          </div>
        </div>
      )}
    </div>
  );
}
