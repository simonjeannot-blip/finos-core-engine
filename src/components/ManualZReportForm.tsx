/**
 * Manual Z-Report Entry Form
 * 
 * Allows managers to manually enter revenue figures when the EPOS API is down.
 * Entries are saved to local IndexedDB and synced when back online.
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { FileText, Save, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { saveManualZReport, ManualZReport } from "@/lib/offlineCache";
import { cn } from "@/lib/utils";

interface ManualZReportFormData {
  revenue: string;
  purchases: string;
  laborHours: string;
  energyCosts: string;
  notes: string;
}

interface ManualZReportFormProps {
  onSuccess?: () => void;
  isOffline?: boolean;
}

export function ManualZReportForm({ onSuccess, isOffline = false }: ManualZReportFormProps) {
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ManualZReportFormData>({
    defaultValues: {
      revenue: "",
      purchases: "",
      laborHours: "",
      energyCosts: "",
      notes: "",
    },
  });

  const onSubmit = async (data: ManualZReportFormData) => {
    setIsSaving(true);

    try {
      const report = await saveManualZReport({
        revenue: parseFloat(data.revenue) || 0,
        purchases: parseFloat(data.purchases) || 0,
        laborHours: parseFloat(data.laborHours) || 0,
        energyCosts: parseFloat(data.energyCosts) || 0,
        notes: data.notes,
        tenant_id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      });

      toast({
        title: "✓ Z-Report Saved Locally",
        description: isOffline 
          ? "Will sync when connection is restored."
          : "Added to S-Number calculation.",
      });

      reset();
      setOpen(false);
      onSuccess?.();
    } catch (error) {
      console.error("Failed to save Z-Report:", error);
      toast({
        variant: "destructive",
        title: "Save Failed",
        description: "Could not save Z-Report to local storage.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="outline" 
          className={cn(
            "gap-2",
            isOffline && "border-sentinel-warning text-sentinel-warning hover:bg-sentinel-warning/10"
          )}
        >
          <FileText className="h-4 w-4" />
          Manual Z-Report
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Manual Z-Report Entry
          </DialogTitle>
          <DialogDescription>
            Enter today's figures manually when EPOS API is unavailable.
            Data will be included in the S-Number calculation.
          </DialogDescription>
        </DialogHeader>

        {isOffline && (
          <div className="flex items-center gap-2 rounded-md bg-sentinel-warning/10 px-3 py-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-sentinel-warning" />
            <span className="text-sentinel-warning">
              Offline mode: Data will sync when reconnected
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="revenue">Revenue (£)</Label>
              <Input
                id="revenue"
                type="number"
                step="0.01"
                placeholder="0.00"
                className="font-mono"
                {...register("revenue", {
                  required: "Revenue is required",
                  min: { value: 0, message: "Must be positive" },
                })}
              />
              {errors.revenue && (
                <p className="text-xs text-destructive">{errors.revenue.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="purchases">Purchases (£)</Label>
              <Input
                id="purchases"
                type="number"
                step="0.01"
                placeholder="0.00"
                className="font-mono"
                {...register("purchases", {
                  min: { value: 0, message: "Must be positive" },
                })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="laborHours">Labor Hours</Label>
              <Input
                id="laborHours"
                type="number"
                step="0.5"
                placeholder="0"
                className="font-mono"
                {...register("laborHours", {
                  min: { value: 0, message: "Must be positive" },
                })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="energyCosts">Energy Costs (£)</Label>
              <Input
                id="energyCosts"
                type="number"
                step="0.01"
                placeholder="0.00"
                className="font-mono"
                {...register("energyCosts", {
                  min: { value: 0, message: "Must be positive" },
                })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              placeholder="e.g., Evening shift, till #2, reason for manual entry..."
              className="resize-none"
              rows={2}
              {...register("notes")}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving} className="gap-2">
              {isSaving ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Save to Local Buffer
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Compact list of pending manual Z-Reports
 */
interface PendingReportsListProps {
  reports: ManualZReport[];
}

export function PendingReportsList({ reports }: PendingReportsListProps) {
  if (reports.length === 0) return null;

  const totalRevenue = reports.reduce((sum, r) => sum + r.revenue, 0);
  const unsyncedCount = reports.filter((r) => !r.synced).length;

  return (
    <Card className="border-sentinel-warning/30">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileText className="h-4 w-4 text-sentinel-warning" />
          Manual Z-Reports
          <Badge variant="outline" className="ml-auto">
            {reports.length} total
          </Badge>
        </CardTitle>
        <CardDescription className="text-xs">
          {unsyncedCount > 0 
            ? `${unsyncedCount} pending sync` 
            : "All synced to cloud"
          }
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Manual Revenue:</span>
          <span className="font-mono font-medium">
            £{totalRevenue.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
          </span>
        </div>
        <div className="max-h-32 overflow-y-auto space-y-1">
          {reports.slice(0, 5).map((report) => (
            <div
              key={report.id}
              className="flex items-center justify-between rounded bg-muted/50 px-2 py-1 text-xs"
            >
              <span className="text-muted-foreground">
                {new Date(report.createdAt).toLocaleString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <div className="flex items-center gap-2">
                <span className="font-mono">£{report.revenue.toFixed(2)}</span>
                {!report.synced && (
                  <Badge variant="secondary" className="h-4 text-[10px] px-1">
                    pending
                  </Badge>
                )}
              </div>
            </div>
          ))}
          {reports.length > 5 && (
            <p className="text-xs text-muted-foreground text-center pt-1">
              +{reports.length - 5} more
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
