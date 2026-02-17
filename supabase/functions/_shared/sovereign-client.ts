// ═══════════════════════════════════════════════════════════════
// SOVEREIGN CLIENT — External Database Bridge v1.0
//
// Creates a Supabase client pointing at the external
// "System of Record" project using MY_DATABASE_* secrets.
//
// Usage in any Edge Function:
//   import { createSovereignClient } from "../_shared/sovereign-client.ts";
//   const sovereign = createSovereignClient();
// ═══════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function createSovereignClient(): SupabaseClient {
  const url = Deno.env.get("MY_DATABASE_URL");
  const serviceKey = Deno.env.get("MY_DATABASE_SERVICE_KEY");

  if (!url || !serviceKey) {
    throw new Error(
      "SOVEREIGN_CLIENT_ERROR: MY_DATABASE_URL and MY_DATABASE_SERVICE_KEY must be configured in secrets."
    );
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createLocalClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
