-- Create category enum for the Absolute Truth variables
CREATE TYPE public.ledger_category AS ENUM ('R', 'P', 'O', 'V', 'D', 'A');

-- Table 1: AI Audit Log
CREATE TABLE public.ai_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    raw_json JSONB NOT NULL,
    image_url TEXT,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Enable RLS on ai_audit_log
ALTER TABLE public.ai_audit_log ENABLE ROW LEVEL SECURITY;

-- RLS policies for ai_audit_log
CREATE POLICY "Users can view their own audit logs"
ON public.ai_audit_log FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own audit logs"
ON public.ai_audit_log FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own audit logs"
ON public.ai_audit_log FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own audit logs"
ON public.ai_audit_log FOR DELETE
USING (auth.uid() = user_id);

-- Table 2: Financial Ledger
CREATE TABLE public.financial_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
    vendor_name TEXT NOT NULL,
    category public.ledger_category NOT NULL,
    pot_id TEXT,
    net_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    vat_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    gross_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    audit_id UUID REFERENCES public.ai_audit_log(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Enable RLS on financial_ledger
ALTER TABLE public.financial_ledger ENABLE ROW LEVEL SECURITY;

-- RLS policies for financial_ledger
CREATE POLICY "Users can view their own ledger entries"
ON public.financial_ledger FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own ledger entries"
ON public.financial_ledger FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own ledger entries"
ON public.financial_ledger FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own ledger entries"
ON public.financial_ledger FOR DELETE
USING (auth.uid() = user_id);

-- Computed View: Absolute Truth Calculator
-- This view calculates S = (R - P) - (O + V + D + A) in real-time
CREATE VIEW public.absolute_truth_calculator AS
SELECT 
    user_id,
    COALESCE(SUM(CASE WHEN category = 'R' THEN net_amount ELSE 0 END), 0) AS r_total,
    COALESCE(SUM(CASE WHEN category = 'P' THEN net_amount ELSE 0 END), 0) AS p_total,
    COALESCE(SUM(CASE WHEN category = 'O' THEN net_amount ELSE 0 END), 0) AS o_total,
    COALESCE(SUM(CASE WHEN category = 'V' THEN net_amount ELSE 0 END), 0) AS v_total,
    COALESCE(SUM(CASE WHEN category = 'D' THEN net_amount ELSE 0 END), 0) AS d_total,
    COALESCE(SUM(CASE WHEN category = 'A' THEN net_amount ELSE 0 END), 0) AS a_total,
    (
        COALESCE(SUM(CASE WHEN category = 'R' THEN net_amount ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN category = 'P' THEN net_amount ELSE 0 END), 0)
    ) - (
        COALESCE(SUM(CASE WHEN category = 'O' THEN net_amount ELSE 0 END), 0) +
        COALESCE(SUM(CASE WHEN category = 'V' THEN net_amount ELSE 0 END), 0) +
        COALESCE(SUM(CASE WHEN category = 'D' THEN net_amount ELSE 0 END), 0) +
        COALESCE(SUM(CASE WHEN category = 'A' THEN net_amount ELSE 0 END), 0)
    ) AS s_value
FROM public.financial_ledger
GROUP BY user_id;

-- Create indexes for better query performance
CREATE INDEX idx_financial_ledger_user_id ON public.financial_ledger(user_id);
CREATE INDEX idx_financial_ledger_category ON public.financial_ledger(category);
CREATE INDEX idx_financial_ledger_transaction_date ON public.financial_ledger(transaction_date);
CREATE INDEX idx_ai_audit_log_user_id ON public.ai_audit_log(user_id);