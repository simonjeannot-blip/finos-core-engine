
-- ============================================
-- V5.8 "TRUE NORTH" INFRASTRUCTURE UPGRADE
-- ============================================

-- ============================================
-- 1. THE LEAD VAULT (Click-to-Cover Attribution)
-- ============================================

-- Create the leads table for tracking marketing attribution
CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  logic_leaks TEXT,
  lead_source TEXT,
  attribution_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL
);

-- Enable RLS on leads table
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- RLS policies for leads (user-scoped access)
CREATE POLICY "Users can view their own leads"
ON public.leads FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own leads"
ON public.leads FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own leads"
ON public.leads FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own leads"
ON public.leads FOR DELETE
USING (auth.uid() = user_id);

-- Add attribution_id to financial_ledger for Atomic Attribution
ALTER TABLE public.financial_ledger 
ADD COLUMN IF NOT EXISTS attribution_id UUID REFERENCES public.leads(attribution_id);

-- Index for fast attribution lookups
CREATE INDEX idx_financial_ledger_attribution ON public.financial_ledger(attribution_id);
CREATE INDEX idx_leads_attribution ON public.leads(attribution_id);

-- ============================================
-- 2. COMMITTED ACCRUALS TABLE (Future Commitments)
-- ============================================

-- Create committed_accruals for tracking future financial commitments
CREATE TABLE public.committed_accruals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  commitment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  vendor_name TEXT NOT NULL,
  description TEXT,
  committed_amount NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  settled_at TIMESTAMP WITH TIME ZONE,
  settled_ledger_id UUID REFERENCES public.financial_ledger(id),
  user_id UUID NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Enable RLS on committed_accruals
ALTER TABLE public.committed_accruals ENABLE ROW LEVEL SECURITY;

-- RLS policies for committed_accruals
CREATE POLICY "Users can view their own accruals"
ON public.committed_accruals FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own accruals"
ON public.committed_accruals FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own accruals"
ON public.committed_accruals FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own accruals"
ON public.committed_accruals FOR DELETE
USING (auth.uid() = user_id);

-- Index for active accruals queries
CREATE INDEX idx_committed_accruals_active ON public.committed_accruals(user_id, is_active) WHERE is_active = true;
CREATE INDEX idx_committed_accruals_due ON public.committed_accruals(due_date) WHERE is_active = true;

-- ============================================
-- 3. UPDATE ABSOLUTE TRUTH CALCULATOR VIEW
-- Now includes committed_accruals in the A calculation
-- Formula: S = (R - P) - (O + V + D + A)
-- Where A = ledger A entries + active committed accruals
-- ============================================

DROP VIEW IF EXISTS public.absolute_truth_calculator;

CREATE VIEW public.absolute_truth_calculator AS
WITH ledger_totals AS (
  SELECT 
    user_id,
    COALESCE(SUM(CASE WHEN category = 'R' THEN net_amount ELSE 0 END), 0) AS r_total,
    COALESCE(SUM(CASE WHEN category = 'P' THEN net_amount ELSE 0 END), 0) AS p_total,
    COALESCE(SUM(CASE WHEN category = 'O' THEN net_amount ELSE 0 END), 0) AS o_total,
    COALESCE(SUM(CASE WHEN category = 'V' THEN net_amount ELSE 0 END), 0) AS v_total,
    COALESCE(SUM(CASE WHEN category = 'D' THEN net_amount ELSE 0 END), 0) AS d_total,
    COALESCE(SUM(CASE WHEN category = 'A' THEN net_amount ELSE 0 END), 0) AS a_ledger
  FROM public.financial_ledger
  GROUP BY user_id
),
committed_totals AS (
  SELECT 
    user_id,
    COALESCE(SUM(committed_amount), 0) AS a_committed
  FROM public.committed_accruals
  WHERE is_active = true
  GROUP BY user_id
)
SELECT 
  COALESCE(lt.user_id, ct.user_id) AS user_id,
  COALESCE(lt.r_total, 0) AS r_total,
  COALESCE(lt.p_total, 0) AS p_total,
  COALESCE(lt.o_total, 0) AS o_total,
  COALESCE(lt.v_total, 0) AS v_total,
  COALESCE(lt.d_total, 0) AS d_total,
  -- A = Ledger A entries + Active Committed Accruals
  COALESCE(lt.a_ledger, 0) + COALESCE(ct.a_committed, 0) AS a_total,
  -- S = (R - P) - (O + V + D + A)
  (COALESCE(lt.r_total, 0) - COALESCE(lt.p_total, 0)) - 
  (COALESCE(lt.o_total, 0) + COALESCE(lt.v_total, 0) + COALESCE(lt.d_total, 0) + 
   COALESCE(lt.a_ledger, 0) + COALESCE(ct.a_committed, 0)) AS s_value
FROM ledger_totals lt
FULL OUTER JOIN committed_totals ct ON lt.user_id = ct.user_id;

-- Grant access to the view
GRANT SELECT ON public.absolute_truth_calculator TO authenticated;

-- ============================================
-- 4. ENABLE REALTIME FOR NEW TABLES
-- ============================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.leads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.committed_accruals;
