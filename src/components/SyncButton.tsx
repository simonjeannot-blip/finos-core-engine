import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function SyncButton() {
  const [isSyncing, setIsSyncing] = useState(false);

  const handleForceSync = async () => {
    setIsSyncing(true);

    try {
      // Step 1: Unregister all service workers
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations.map((registration) => registration.unregister())
        );
      }

      // Step 2: Clear all cache storage
      if ("caches" in window) {
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames.map((cacheName) => caches.delete(cacheName))
        );
      }

      // Step 3: Wait a moment for visual feedback
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Step 4: Force hard reload from server
      window.location.reload();
    } catch (error) {
      console.error("Force sync failed:", error);
      setIsSyncing(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleForceSync}
        disabled={isSyncing}
        className="gap-2 border-primary/50 hover:border-primary hover:bg-primary/10"
      >
        {isSyncing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
        {isSyncing ? "Syncing..." : "Sync System Logic"}
      </Button>

      <Dialog open={isSyncing} onOpenChange={() => {}}>
        <DialogContent className="sm:max-w-md" hideCloseButton>
          <DialogHeader className="items-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
            <DialogTitle className="text-xl">Purging Legacy Cache...</DialogTitle>
            <DialogDescription className="text-center">
              Synchronizing system logic with the latest Financial OS version.
              <br />
              Please wait.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}
