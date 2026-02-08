
-- ═══════════════════════════════════════════════════════════════
-- THE EVIDENCE LOCKER — Ghost Siphon Database Schema
-- Tables: microsoft_oauth_tokens, siphoned_invoices
-- Linked to Absolute Truth Protocol via committed_accruals (A)
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────
-- 1. Microsoft OAuth Token Vault
-- Stores access/refresh tokens per user. Strictly server-side.
-- ─────────────────────────────────────────────────────────
CREATE TABLE public.microsoft_oauth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  scopes text NOT NULL DEFAULT 'offline_access Mail.Read Mail.ReadBasic',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT microsoft_oauth_tokens_user_id_unique UNIQUE (user_id)
);

ALTER TABLE public.microsoft_oauth_tokens ENABLE ROW LEVEL SECURITY;

-- Only super_admins can read token status (never expose actual tokens to client)
CREATE POLICY "Super admins can view oauth tokens"
  ON public.microsoft_oauth_tokens FOR SELECT
  USING (public.is_super_admin(auth.uid()));

-- No client-side INSERT/UPDATE/DELETE — edge functions use service role
-- Timestamp trigger
CREATE TRIGGER update_microsoft_oauth_tokens_updated_at
  BEFORE UPDATE ON public.microsoft_oauth_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────
-- 2. Siphoned Invoices — Evidence Locker
-- ─────────────────────────────────────────────────────────
CREATE TABLE public.siphoned_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  sender text NOT NULL DEFAULT 'Unknown',
  subject text NOT NULL DEFAULT '',
  attachment_name text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processed', 'flagged')),
  amount_detected numeric DEFAULT 0,
  raw_json jsonb DEFAULT '{}'::jsonb,
  ledger_entry_id uuid REFERENCES public.financial_ledger(id),
  accrual_entry_id uuid REFERENCES public.committed_accruals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.siphoned_invoices ENABLE ROW LEVEL SECURITY;

-- RLS: User-scoped access
CREATE POLICY "Users can view their own siphoned invoices"
  ON public.siphoned_invoices FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Super admins can view all siphoned invoices"
  ON public.siphoned_invoices FOR SELECT
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Users can update their own siphoned invoices"
  ON public.siphoned_invoices FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Super admins can update all siphoned invoices"
  ON public.siphoned_invoices FOR UPDATE
  USING (public.is_super_admin(auth.uid()));

-- No direct INSERT/DELETE from client — edge functions handle ingestion

-- Timestamp trigger
CREATE TRIGGER update_siphoned_invoices_updated_at
  BEFORE UPDATE ON public.siphoned_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Audit trail triggers (hash-chain)
CREATE TRIGGER audit_siphoned_invoices
  AFTER INSERT OR UPDATE OR DELETE ON public.siphoned_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_hash_chain();

CREATE TRIGGER audit_microsoft_oauth_tokens
  AFTER INSERT OR UPDATE OR DELETE ON public.microsoft_oauth_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_hash_chain();
