/**
 * Server-Side S-Number Verification Hook
 * 
 * Calls the database-level calculate_s_number() function
 * which hard-codes the Absolute Truth Protocol server-side.
 * Returns a SHA-256 verification hash to prevent client-side manipulation.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { createHandshakeError, createLogicError, classifyError } from "@/lib/ServiceError";

export interface ServerSNumberResult {
  r_total: number;
  p_total: number;
  o_total: number;
  v_total: number;
  d_total: number;
  a_total: number;
  s_value: number;
  calculated_at: string;
  hash: string;
}

export function useServerSNumber() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["server_s_number", user?.id],
    queryFn: async (): Promise<ServerSNumberResult | null> => {
      if (!user?.id) {
        throw createHandshakeError("AUTH_REQUIRED", "User must be authenticated to calculate S-Number.");
      }

      const { data, error } = await supabase.rpc("calculate_s_number", {
        p_user_id: user.id,
      });

      if (error) {
        throw classifyError(error);
      }

      if (!data || data.length === 0) {
        return null;
      }

      const result = data[0];

      // Validate S-Number integrity: S must equal (R - P) - (O + V + D + A)
      const expectedS = (result.r_total - result.p_total) - 
                        (result.o_total + result.v_total + result.d_total + result.a_total);
      
      const tolerance = 0.01; // 1p tolerance for floating point
      if (Math.abs(result.s_value - expectedS) > tolerance) {
        throw createLogicError(
          "S_NUMBER_INTEGRITY",
          `Server S-Number (${result.s_value}) does not match protocol calculation (${expectedS}). Possible data corruption.`,
          { metadata: { serverValue: result.s_value, expectedValue: expectedS } }
        );
      }

      return result;
    },
    enabled: !!user?.id,
    refetchInterval: 60000, // Re-verify every 60 seconds
    staleTime: 30000,
  });
}
