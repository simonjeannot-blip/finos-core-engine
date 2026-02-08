-- Add tenant_id column to microsoft_oauth_tokens for multi-tenant identity
ALTER TABLE public.microsoft_oauth_tokens
  ADD COLUMN IF NOT EXISTS tenant_id text;

-- Update scopes default to include openid for ID token retrieval
ALTER TABLE public.microsoft_oauth_tokens
  ALTER COLUMN scopes SET DEFAULT 'openid offline_access Mail.Read Mail.ReadBasic';