/**
 * useBookings — Booking CRUD hook with Sovereign Handshake
 * 
 * Creates bookings in the local database (Supabase) and fires
 * a background handshake to the Financial OS intake pipeline.
 * The handshake is non-blocking — the user sees success immediately.
 */

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  sovereignHandshake,
  getAttributionId,
  type BookingHandshakePayload,
} from "@/lib/sovereignHandshake";

export interface CreateBookingInput {
  guest_name: string;
  guest_email?: string;
  guest_phone?: string;
  party_size: number;
  reservation_time: string;
  notes?: string;
}

export interface BookingRecord {
  id: string;
  booking_id: string;
  guest_name: string;
  guest_email: string | null;
  guest_phone: string | null;
  party_size: number;
  reservation_time: string;
  source: string;
  status: string;
  attribution_id: string | null;
  created_at: string;
}

export function useBookings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isCreating, setIsCreating] = useState(false);

  /**
   * Create a booking — local DB first, then background handshake.
   * Returns the created booking record on success, null on failure.
   */
  const createBooking = useCallback(
    async (input: CreateBookingInput): Promise<BookingRecord | null> => {
      if (!user) {
        toast({
          variant: "destructive",
          title: "Authentication Required",
          description: "You must be logged in to create bookings.",
        });
        return null;
      }

      setIsCreating(true);

      try {
        // Generate a unique booking ID
        const bookingId = `MM-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

        // Capture attribution from ad-click context
        const attributionId = getAttributionId();

        // ═══════════════════════════════════════════════════════
        // STEP 1: LOCAL DATABASE WRITE (Source of Truth)
        // ═══════════════════════════════════════════════════════
        const { data: booking, error: dbError } = await supabase
          .from("bookings")
          .insert({
            booking_id: bookingId,
            guest_name: input.guest_name,
            guest_email: input.guest_email || null,
            guest_phone: input.guest_phone || null,
            party_size: input.party_size,
            reservation_time: input.reservation_time,
            source: "MO_MANGIO_BOOKING",
            status: "CONFIRMED",
            attribution_id: attributionId,
            user_id: user.id,
            metadata: {
              created_by: "booking_form",
              notes: input.notes || null,
              attribution_captured: !!attributionId,
            },
          })
          .select("id, booking_id, guest_name, guest_email, guest_phone, party_size, reservation_time, source, status, attribution_id, created_at")
          .single();

        if (dbError) {
          console.error("[useBookings] DB write failed:", dbError);
          toast({
            variant: "destructive",
            title: "Booking Failed",
            description: dbError.message,
          });
          return null;
        }

        console.log("[useBookings] ✅ Local booking saved:", booking.booking_id);

        // Show immediate success to user
        toast({
          title: "✓ Booking Confirmed",
          description: `${input.guest_name} — ${input.party_size} covers`,
        });

        // ═══════════════════════════════════════════════════════
        // STEP 2: SOVEREIGN HANDSHAKE (Background, non-blocking)
        // Fire-and-forget — never blocks the UI confirmation
        // ═══════════════════════════════════════════════════════
        const handshakePayload: BookingHandshakePayload = {
          booking_id: bookingId,
          guest_name: input.guest_name,
          guest_email: input.guest_email || null,
          guest_phone: input.guest_phone || null,
          party_size: input.party_size,
          reservation_time: input.reservation_time,
          attribution_id: attributionId,
          metadata: {
            notes: input.notes || null,
            local_db_id: booking.id,
          },
        };

        // Fire in background — don't await in the critical path
        sovereignHandshake(handshakePayload).then((result) => {
          if (result.success) {
            console.log("[useBookings] 🔗 Sovereign Handshake complete");
          } else {
            console.warn(
              `[useBookings] ⚠️ Handshake ${result.status}: ${result.error || result.message}`
            );
            // Silent failure — data is safe in local DB
          }
        });

        return booking as BookingRecord;
      } catch (error) {
        console.error("[useBookings] Unexpected error:", error);
        toast({
          variant: "destructive",
          title: "Booking Error",
          description: error instanceof Error ? error.message : "An unexpected error occurred",
        });
        return null;
      } finally {
        setIsCreating(false);
      }
    },
    [user, toast]
  );

  return {
    createBooking,
    isCreating,
  };
}
