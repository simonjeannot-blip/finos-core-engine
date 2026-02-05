
-- Fix: Recreate absolute_truth_calculator view without SECURITY DEFINER
-- The view should respect RLS of the querying user

DROP VIEW IF EXISTS public.absolute_truth_calculator;

CREATE VIEW public.absolute_truth_calculator 
WITH (security_invoker = true) AS
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
  COALESCE(lt.a_ledger, 0) + COALESCE(ct.a_committed, 0) AS a_total,
  (COALESCE(lt.r_total, 0) - COALESCE(lt.p_total, 0)) - 
  (COALESCE(lt.o_total, 0) + COALESCE(lt.v_total, 0) + COALESCE(lt.d_total, 0) + 
   COALESCE(lt.a_ledger, 0) + COALESCE(ct.a_committed, 0)) AS s_value
FROM ledger_totals lt
FULL OUTER JOIN committed_totals ct ON lt.user_id = ct.user_id;

-- Grant select to authenticated users
GRANT SELECT ON public.absolute_truth_calculator TO authenticated;
