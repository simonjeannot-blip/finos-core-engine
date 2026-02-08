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
import { GhostSiphonPulse } from "@/components/GhostSiphonPulse";
import { SiphonScanStatus } from "@/components/SiphonScanStatus";
import { CompliancePulse } from "@/components/CompliancePulse";
import { StrategyToggle } from "@/components/StrategyToggle";
import { SNumberHUD } from "@/components/SNumberHUD";
import { StressTestChart } from "@/components/StressTestChart";
import { OfflineModeIndicator } from "@/components/OfflineModeIndicator";
import { ManualZReportForm, PendingReportsList } from "@/components/ManualZReportForm";
import { BookingForm } from "@/components/BookingForm";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { useAbsoluteTruth, LedgerCategory } from "@/hooks/useLedger";
import { useIsMobile } from "@/hooks/use-mobile";
import { useOfflineStrategy } from "@/hooks/useOfflineStrategy";

const CATEGORIES: LedgerCategory[] = ["R", "P", "O", "V", "D", "A"];

export default function Index() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { user, loading: authLoading, signOut } = useAuth();
  const { isSuperAdmin } = useProfile();
  const { data: totals, refetch: refetchTotals } = useAbsoluteTruth();
  
  // Use the new offline-aware strategy hook
  const {
    strategy,
    setStrategy,
    result,
    allResults,
    isOffline,
    isUsingCache,
    lastSyncTime,
    latencyMs,
    manualReports,
    ledgerEntries,
    isLoading: ledgerLoading,
    refreshData,
  } = useOfflineStrategy();

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
    refreshData();
    refetchTotals();
  }, [refreshData, refetchTotals]);

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

  const pendingReportsCount = manualReports.filter((r) => !r.synced).length;

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
            {/* Status Indicators */}
            <div className="flex items-center gap-2">
              <LivePulse />
              <GhostSiphonPulse />
              <SiphonScanStatus />
              <OfflineModeIndicator
                isOffline={isOffline}
                isUsingCache={isUsingCache}
                lastSyncTime={lastSyncTime}
                latencyMs={latencyMs}
                pendingReports={pendingReportsCount}
                onRefresh={refreshData}
                compact
              />
            </div>
          </div>
          <div className="flex items-center gap-2 md:gap-3">
            {/* Sync Button */}
            {!isMobile && <SyncButton />}
            {/* Manual Z-Report Button */}
            {!isMobile && (
              <ManualZReportForm 
                onSuccess={refreshData} 
                isOffline={isOffline} 
              />
            )}
            {!isMobile && <BookingForm onSuccess={refreshData} />}
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

      {/* Offline Banner - Full width when offline */}
      {(isOffline || isUsingCache) && (
        <div className="container mx-auto px-4 pt-4">
          <OfflineModeIndicator
            isOffline={isOffline}
            isUsingCache={isUsingCache}
            lastSyncTime={lastSyncTime}
            latencyMs={latencyMs}
            pendingReports={pendingReportsCount}
            onRefresh={refreshData}
          />
        </div>
      )}

      <main className="container mx-auto px-4 py-4 md:py-6 space-y-6">
        {/* Mobile: Absolute Truth first and prominent */}
        {isMobile && (
          <section className="space-y-3">
            <AbsoluteTruthDisplay totals={totals ?? null} prominent />
            <div className="flex justify-center gap-2">
              <SyncButton />
              <ManualZReportForm 
                onSuccess={refreshData} 
                isOffline={isOffline} 
              />
              <BookingForm onSuccess={refreshData} />
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

        {/* Absolute Truth Calculator + Compliance Pulse + Pending Reports */}
        {!isMobile && (
          <section className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <AbsoluteTruthDisplay totals={totals ?? null} />
            <CompliancePulse totals={totals ?? null} />
            {manualReports.length > 0 && (
              <PendingReportsList reports={manualReports} />
            )}
          </section>
        )}

        {/* Mobile: Pending Reports */}
        {isMobile && manualReports.length > 0 && (
          <section>
            <PendingReportsList reports={manualReports} />
          </section>
        )}

        {/* Ledger Table / Card View */}
        <section>
          <h2 className="mb-3 md:mb-4 text-base md:text-lg font-semibold">
            {isMobile ? "Recent Transactions" : "Ledger Entries"}
            {isUsingCache && (
              <span className="ml-2 text-xs text-muted-foreground font-normal">
                (cached)
              </span>
            )}
          </h2>
          <LedgerTable
            entries={ledgerEntries}
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
