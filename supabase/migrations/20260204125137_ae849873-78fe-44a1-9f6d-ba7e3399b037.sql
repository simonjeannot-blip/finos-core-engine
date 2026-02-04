-- Drop the existing view
DROP VIEW IF EXISTS public.absolute_truth_calculator;

-- Recreate the view with SECURITY INVOKER (default, but explicit)
-- This ensures the view respects the RLS policies of the querying user
CREATE VIEW public.absolute_truth_calculator 
WITH (security_invoker = true) AS
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