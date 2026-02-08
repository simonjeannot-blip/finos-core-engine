import { cn } from "@/lib/utils";
import { useSiphonStatus } from "@/hooks/useSiphonStatus";
import { useSiphonScanner } from "@/hooks/useSiphonScanner";
import { useEffect } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Scan } from "lucide-react";

interface SiphonScanStatusProps {
  className?: string;
}

/**
 * Compact dashboard widget showing siphoned count + last scan time.
 * Only renders when Ghost Siphon is connected.
 */
export function SiphonScanStatus({ className }: SiphonScanStatusProps) {
  const { state, loading } = useSiphonStatus();
  const { todayCount, todayCountLoading, lastScanTime, fetchTodayCount } = useSiphonScanner();

  useEffect(() => {
    if (state === "connected") {
      fetchTodayCount();
    }
  }, [state, fetchTodayCount]);

  if (loading || state === "disconnected") return null;

  const formatTime = (date: Date | null): string => {
    if (!date) return "Not scanned";
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    return `${diffHr}h ago`;
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("flex items-center gap-1.5 cursor-default", className)}>
          <Scan className="h-3.5 w-3.5 text-siphon-connected" />
          <span className="text-xs font-mono text-siphon-connected tabular-nums">
            {todayCountLoading ? "…" : todayCount}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs font-mono">
        <div className="space-y-1">
          <div>{todayCount} invoice{todayCount !== 1 ? "s" : ""} siphoned today</div>
          <div className="text-muted-foreground">Last scan: {formatTime(lastScanTime)}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
