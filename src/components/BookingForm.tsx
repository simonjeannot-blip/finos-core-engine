/**
 * BookingForm — Mo' Mangio! Reservation Creator
 * 
 * Creates bookings locally and fires the Sovereign Handshake
 * to the Financial OS in the background.
 */

import { useState } from "react";
import { useForm } from "react-hook-form";
import { CalendarPlus, Users, Save, Loader2 } from "lucide-react";
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
import { useBookings, type CreateBookingInput } from "@/hooks/useBookings";

interface BookingFormProps {
  onSuccess?: () => void;
}

export function BookingForm({ onSuccess }: BookingFormProps) {
  const [open, setOpen] = useState(false);
  const { createBooking, isCreating } = useBookings();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateBookingInput>({
    defaultValues: {
      guest_name: "",
      guest_email: "",
      guest_phone: "",
      party_size: 2,
      reservation_time: "",
      notes: "",
    },
  });

  const onSubmit = async (data: CreateBookingInput) => {
    const booking = await createBooking(data);

    if (booking) {
      reset();
      setOpen(false);
      onSuccess?.();
    }
  };

  // Default reservation time to tomorrow at 19:00
  const getDefaultDateTime = () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(19, 0, 0, 0);
    return tomorrow.toISOString().slice(0, 16);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <CalendarPlus className="h-4 w-4" />
          New Booking
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-5 w-5" />
            New Reservation
          </DialogTitle>
          <DialogDescription>
            Create a booking. Data syncs to the Financial OS automatically.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Guest Name */}
          <div className="space-y-2">
            <Label htmlFor="guest_name">Guest Name *</Label>
            <Input
              id="guest_name"
              placeholder="John Smith"
              {...register("guest_name", {
                required: "Guest name is required",
                minLength: { value: 2, message: "Name too short" },
              })}
            />
            {errors.guest_name && (
              <p className="text-xs text-destructive">{errors.guest_name.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Guest Email */}
            <div className="space-y-2">
              <Label htmlFor="guest_email">Email</Label>
              <Input
                id="guest_email"
                type="email"
                placeholder="guest@email.com"
                {...register("guest_email")}
              />
            </div>

            {/* Guest Phone */}
            <div className="space-y-2">
              <Label htmlFor="guest_phone">Phone</Label>
              <Input
                id="guest_phone"
                type="tel"
                placeholder="+44..."
                {...register("guest_phone")}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Party Size */}
            <div className="space-y-2">
              <Label htmlFor="party_size" className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                Covers *
              </Label>
              <Input
                id="party_size"
                type="number"
                min={1}
                max={50}
                className="font-mono"
                {...register("party_size", {
                  required: "Party size is required",
                  valueAsNumber: true,
                  min: { value: 1, message: "Minimum 1 cover" },
                  max: { value: 50, message: "Maximum 50 covers" },
                })}
              />
              {errors.party_size && (
                <p className="text-xs text-destructive">{errors.party_size.message}</p>
              )}
            </div>

            {/* Reservation Time */}
            <div className="space-y-2">
              <Label htmlFor="reservation_time">Date & Time *</Label>
              <Input
                id="reservation_time"
                type="datetime-local"
                defaultValue={getDefaultDateTime()}
                className="font-mono"
                {...register("reservation_time", {
                  required: "Reservation time is required",
                })}
              />
              {errors.reservation_time && (
                <p className="text-xs text-destructive">{errors.reservation_time.message}</p>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="e.g., Birthday, window seat, allergies..."
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
            <Button type="submit" disabled={isCreating} className="gap-2">
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Confirm Booking
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
