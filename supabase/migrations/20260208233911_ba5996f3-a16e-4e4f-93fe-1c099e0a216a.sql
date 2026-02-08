
-- ═══════════════════════════════════════════════════════════════
-- DISCOVERED INVOICES — Persistent scan results from Ghost Discovery
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE public.discovered_invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  scan_id UUID NOT NULL DEFAULT gen_random_uuid(),
  message_id TEXT NOT NULL,
  sender_name TEXT NOT NULL DEFAULT 'Unknown',
  sender_address TEXT NOT NULL DEFAULT 'unknown@unknown',
  sender_domain TEXT NOT NULL DEFAULT 'unknown',
  subject TEXT NOT NULL DEFAULT '',
  filename TEXT NOT NULL DEFAULT '',
  file_size INTEGER NOT NULL DEFAULT 0,
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  confidence TEXT NOT NULL DEFAULT 'LOW',
  confidence_reason TEXT NOT NULL DEFAULT '',
  is_known_supplier BOOLEAN NOT NULL DEFAULT false,
  is_already_siphoned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.discovered_invoices ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own discovered invoices"
  ON public.discovered_invoices FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Super admins can view all discovered invoices"
  ON public.discovered_invoices FOR SELECT
  USING (is_super_admin(auth.uid()));

CREATE POLICY "Users can delete their own discovered invoices"
  ON public.discovered_invoices FOR DELETE
  USING (auth.uid() = user_id);

-- Index for fast polling
CREATE INDEX idx_discovered_invoices_user_scan ON public.discovered_invoices (user_id, scan_id);
CREATE INDEX idx_discovered_invoices_created ON public.discovered_invoices (created_at DESC);
