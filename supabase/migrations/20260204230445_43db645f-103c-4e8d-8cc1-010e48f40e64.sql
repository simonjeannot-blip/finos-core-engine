-- Enable realtime for financial_ledger table to power Live Pulse indicator
ALTER PUBLICATION supabase_realtime ADD TABLE public.financial_ledger;