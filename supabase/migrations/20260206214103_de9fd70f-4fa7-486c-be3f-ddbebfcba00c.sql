
-- ═══════════════════════════════════════════════════════════════
-- BOOKING ARM — Database Prep
-- Creates the bookings table for unified booking platform intake
-- ═══════════════════════════════════════════════════════════════

-- Create bookings table
CREATE TABLE public.bookings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id TEXT NOT NULL,
  guest_name TEXT NOT NULL DEFAULT 'Unknown Guest',
  guest_email TEXT,
  guest_phone TEXT,
  party_size INTEGER NOT NULL DEFAULT 1,
  reservation_time TIMESTAMP WITH TIME ZONE NOT NULL,
  source TEXT NOT NULL DEFAULT 'UNKNOWN',
  status TEXT NOT NULL DEFAULT 'CONFIRMED',
  attribution_id UUID,
  user_id UUID NOT NULL,
  raw_stream_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT bookings_booking_id_source_unique UNIQUE (booking_id, source)
);

-- Enable RLS
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own bookings"
  ON public.bookings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own bookings"
  ON public.bookings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own bookings"
  ON public.bookings FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own bookings"
  ON public.bookings FOR DELETE
  USING (auth.uid() = user_id);

-- Super admin access
CREATE POLICY "Super admins can view all bookings"
  ON public.bookings FOR SELECT
  USING (is_super_admin(auth.uid()));

CREATE POLICY "Super admins can manage all bookings"
  ON public.bookings FOR ALL
  USING (is_super_admin(auth.uid()));

-- Auto-update timestamp trigger
CREATE TRIGGER update_bookings_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Audit hash chain trigger for forensic immutability
CREATE TRIGGER audit_bookings_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_hash_chain();

-- Index for performance on common queries
CREATE INDEX idx_bookings_source ON public.bookings (source);
CREATE INDEX idx_bookings_reservation_time ON public.bookings (reservation_time);
CREATE INDEX idx_bookings_attribution_id ON public.bookings (attribution_id) WHERE attribution_id IS NOT NULL;
CREATE INDEX idx_bookings_guest_email ON public.bookings (guest_email) WHERE guest_email IS NOT NULL;

-- Enable realtime for bookings
ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
