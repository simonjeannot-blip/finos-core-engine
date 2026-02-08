
-- ═══════════════════════════════════════════════════════════
-- THE GHOST: Ad Campaigns Vault
-- Stores sovereign ad-spend data from Google Ads API
-- ═══════════════════════════════════════════════════════════

CREATE TABLE public.ad_campaigns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_name TEXT NOT NULL,
  engine_id TEXT NOT NULL, -- 'OFFICE', 'SHOWROOM', or 'EVENT'
  spend_amount NUMERIC NOT NULL DEFAULT 0, -- Standard currency (micros / 1,000,000)
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  last_sync_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  user_id UUID NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(campaign_name, date, user_id)
);

-- Enable RLS
ALTER TABLE public.ad_campaigns ENABLE ROW LEVEL SECURITY;

-- Permissive policies
CREATE POLICY "Users can view their own ad campaigns"
ON public.ad_campaigns FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Super admins can view all ad campaigns"
ON public.ad_campaigns FOR SELECT TO authenticated
USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Users can insert their own ad campaigns"
ON public.ad_campaigns FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own ad campaigns"
ON public.ad_campaigns FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Super admins can update all ad campaigns"
ON public.ad_campaigns FOR UPDATE TO authenticated
USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Users can delete their own ad campaigns"
ON public.ad_campaigns FOR DELETE TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Super admins can delete all ad campaigns"
ON public.ad_campaigns FOR DELETE TO authenticated
USING (public.is_super_admin(auth.uid()));

-- Timestamp trigger
CREATE TRIGGER update_ad_campaigns_updated_at
BEFORE UPDATE ON public.ad_campaigns
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Audit hash chain for immutable forensic trail
CREATE TRIGGER audit_ad_campaigns_hash
AFTER INSERT OR UPDATE OR DELETE ON public.ad_campaigns
FOR EACH ROW
EXECUTE FUNCTION public.audit_hash_chain();

-- Performance indexes
CREATE INDEX idx_ad_campaigns_user_date ON public.ad_campaigns(user_id, date);
CREATE INDEX idx_ad_campaigns_engine ON public.ad_campaigns(engine_id);
