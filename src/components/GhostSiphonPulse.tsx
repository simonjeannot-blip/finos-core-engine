import { cn } from "@/lib/utils";
import { useSiphonStatus, SiphonConnectionState } from "@/hooks/useSiphonStatus";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface GhostSiphonPulseProps {
  className?: string;
}

const STATE_CONFIG: Record<
  SiphonConnectionState,
  { color: string; pulseColor: string; label: string; description: string }
> = {
  connected: {
    color: "bg-siphon-connected",
    pulseColor: "bg-siphon-connected",
    label: "Siphon",
    description: "Connected & Siphoning",
  },
  expiring: {
    color: "bg-siphon-scanning",
    pulseColor: "bg-siphon-scanning",
    label: "Siphon",
    description: "Token expiring — re-auth soon",
  },
  error: {
    color: "bg-destructive",
    pulseColor: "bg-destructive",
    label: "Siphon",
    description: "Re-authentication required",
  },
  disconnected: {
    color: "bg-muted-foreground/30",
    pulseColor: "",
    label: "Siphon",
    description: "Not connected",
  },
};

export function GhostSiphonPulse({ className }: GhostSiphonPulseProps) {
  const { state, loading } = useSiphonStatus();

  if (loading) return null;

  // Don't render if disconnected — only show when there's a connection
  if (state === "disconnected") return null;

  const config = STATE_CONFIG[state];
  const isAnimating = state === "connected" || state === "expiring";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("flex items-center gap-1.5 cursor-default", className)}>
          <div className="relative flex items-center">
            {/* Base dot */}
            <div
              className={cn(
                "h-2.5 w-2.5 rounded-full transition-colors duration-300",
                config.color
              )}
            />
            {/* Pulse ring */}
            {isAnimating && (
              <div
                className={cn(
                  "absolute inset-0 h-2.5 w-2.5 rounded-full opacity-75",
                  state === "connected" ? "animate-ping" : "animate-pulse",
                  config.pulseColor
                )}
              />
            )}
            {/* Error static ring */}
            {state === "error" && (
              <div className="absolute -inset-0.5 h-3.5 w-3.5 rounded-full bg-destructive/20" />
            )}
          </div>
          <span
            className={cn(
              "text-xs font-mono uppercase tracking-wider",
              state === "connected" && "text-siphon-connected",
              state === "expiring" && "text-siphon-scanning",
              state === "error" && "text-destructive"
            )}
          >
            {config.label}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {config.description}
      </TooltipContent>
    </Tooltip>
  );
}
