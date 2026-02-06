
-- ═══════════════════════════════════════════════════════════════
-- RAW DATA STREAM: Sovereign Data Engine
-- Zero-dropout ingestion buffer for all external data sources
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE public.raw_data_stream (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source text NOT NULL DEFAULT 'UNKNOWN',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING',
  error_detail text,
  processed_at timestamptz,
  ledger_entry_id uuid REFERENCES public.financial_ledger(id),
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create index for efficient status-based queries
CREATE INDEX idx_raw_data_stream_status ON public.raw_data_stream(status);
CREATE INDEX idx_raw_data_stream_source ON public.raw_data_stream(source);
CREATE INDEX idx_raw_data_stream_created ON public.raw_data_stream(created_at DESC);

-- Enable RLS
ALTER TABLE public.raw_data_stream ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can only access their own data
CREATE POLICY "Users can view their own stream data"
  ON public.raw_data_stream
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own stream data"
  ON public.raw_data_stream
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own stream data"
  ON public.raw_data_stream
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Super admins can view all stream data for forensic audit
CREATE POLICY "Super admins can view all stream data"
  ON public.raw_data_stream
  FOR SELECT
  USING (public.is_super_admin(auth.uid()));

-- Seal from anon role (consistent with vault hardening)
REVOKE ALL ON public.raw_data_stream FROM anon;

-- Attach hash-chain audit trigger for forensic immutability
CREATE TRIGGER audit_raw_data_stream
  AFTER INSERT OR UPDATE OR DELETE ON public.raw_data_stream
  FOR EACH ROW EXECUTE FUNCTION public.audit_hash_chain();

-- Enable realtime for live monitoring
ALTER PUBLICATION supabase_realtime ADD TABLE public.raw_data_stream;
