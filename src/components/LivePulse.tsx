import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface LivePulseProps {
  className?: string;
}

export function LivePulse({ className }: LivePulseProps) {
  const [isPulsing, setIsPulsing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    // Subscribe to realtime changes on financial_ledger
    const channel = supabase
      .channel("live-pulse-ledger")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "financial_ledger",
        },
        (payload) => {
          console.log("🟢 Live Pulse triggered:", payload);
          
          // Check if this is from the intake arm (Revenue category with intake source)
          const metadata = payload.new?.metadata as Record<string, unknown> | null;
          if (
            payload.new?.category === "R" && 
            metadata?.source === "universal-revenue-intake"
          ) {
            triggerPulse();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const triggerPulse = () => {
    setIsPulsing(true);
    setLastUpdate(new Date());
    
    // Flash for 3 seconds
    setTimeout(() => {
      setIsPulsing(false);
    }, 3000);
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative flex items-center">
        {/* Base dot */}
        <div
          className={cn(
            "h-3 w-3 rounded-full transition-colors duration-300",
            isPulsing ? "bg-category-r" : "bg-muted-foreground/30"
          )}
        />
        
        {/* Pulse ring animation */}
        {isPulsing && (
          <>
            <div className="absolute inset-0 h-3 w-3 animate-ping rounded-full bg-category-r opacity-75" />
            <div className="absolute -inset-1 h-5 w-5 animate-pulse rounded-full bg-category-r/20" />
          </>
        )}
      </div>
      
      <span className={cn(
        "text-xs font-medium transition-colors duration-300",
        isPulsing ? "text-category-r" : "text-muted-foreground"
      )}>
        {isPulsing ? "LIVE" : "Standby"}
      </span>
      
      {lastUpdate && !isPulsing && (
        <span className="text-xs text-muted-foreground/60">
          Last: {lastUpdate.toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}
