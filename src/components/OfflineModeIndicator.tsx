/**
 * Offline Mode Indicator Component
 * 
 * Displays connection status and cache age when operating in offline mode.
 * Shows "Viewing Cached Truth" when Supabase heartbeat fails.
 */

import { WifiOff, Wifi, RefreshCw, Clock, Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface OfflineModeIndicatorProps {
  isOffline: boolean;
  isUsingCache: boolean;
  lastSyncTime: Date | null;
  latencyMs: number | null;
  pendingReports: number;
  onRefresh?: () => void;
  compact?: boolean;
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export function OfflineModeIndicator({
  isOffline,
  isUsingCache,
  lastSyncTime,
  latencyMs,
  pendingReports,
  onRefresh,
  compact = false,
}: OfflineModeIndicatorProps) {
  // When online and not using cache, show minimal indicator
  if (!isOffline && !isUsingCache && pendingReports === 0) {
    if (compact) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-category-r animate-pulse" />
              <span className="text-xs text-muted-foreground">Live</span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">
              Connected • {latencyMs ? `${latencyMs}ms` : "Healthy"}
            </p>
          </TooltipContent>
        </Tooltip>
      );
    }

    return (
      <div className="flex items-center gap-2 rounded-md bg-category-r/10 px-3 py-1.5">
        <Wifi className="h-4 w-4 text-category-r" />
        <span className="text-sm font-medium text-category-r">Live Data</span>
        {latencyMs && (
          <Badge variant="outline" className="text-xs font-mono">
            {latencyMs}ms
          </Badge>
        )}
      </div>
    );
  }

  // Offline or using cached data
  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5">
            <WifiOff className="h-4 w-4 text-sentinel-warning animate-pulse" />
            <span className="text-xs font-medium text-sentinel-warning">
              Cached
            </span>
            {pendingReports > 0 && (
              <Badge variant="secondary" className="h-5 w-5 p-0 text-xs">
                {pendingReports}
              </Badge>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="space-y-1 text-xs">
            <p className="font-medium">Offline: Viewing Cached Truth</p>
            {lastSyncTime && (
              <p className="text-muted-foreground">
                Last sync: {formatRelativeTime(lastSyncTime)}
              </p>
            )}
            {pendingReports > 0 && (
              <p className="text-sentinel-warning">
                {pendingReports} manual report(s) pending sync
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className={cn(
      "flex items-center gap-3 rounded-lg border-2 px-4 py-2",
      isOffline 
        ? "border-sentinel-warning bg-sentinel-warning/10" 
        : "border-muted bg-muted/50"
    )}>
      <div className="flex items-center gap-2">
        <WifiOff className={cn(
          "h-5 w-5",
          isOffline ? "text-sentinel-warning animate-pulse" : "text-muted-foreground"
        )} />
        <div>
          <p className={cn(
            "text-sm font-semibold",
            isOffline ? "text-sentinel-warning" : "text-muted-foreground"
          )}>
            {isOffline ? "Offline Mode" : "Viewing Cache"}
          </p>
          <p className="text-xs text-muted-foreground">
            {isOffline 
              ? "Supabase unreachable • Using cached truth" 
              : "Data may be stale"
            }
          </p>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Last sync time */}
        {lastSyncTime && (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                <span>{formatRelativeTime(lastSyncTime)}</span>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">
                Last synced: {lastSyncTime.toLocaleString()}
              </p>
            </TooltipContent>
          </Tooltip>
        )}

        {/* Pending reports indicator */}
        {pendingReports > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge 
                variant="secondary" 
                className="gap-1 bg-sentinel-warning/20 text-sentinel-warning"
              >
                <Database className="h-3 w-3" />
                {pendingReports}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">
                {pendingReports} manual Z-Report(s) pending sync
              </p>
            </TooltipContent>
          </Tooltip>
        )}

        {/* Refresh button */}
        {onRefresh && (
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            className="gap-1"
          >
            <RefreshCw className="h-3 w-3" />
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}
