import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface AppSettings {
  disable_public_signups: boolean;
}

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSettings = async () => {
    try {
      const { data, error } = await supabase
        .from("app_settings")
        .select("disable_public_signups")
        .eq("id", "global")
        .single();

      if (error) {
        console.error("Error fetching settings:", error);
      } else {
        setSettings(data);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const updateSettings = async (newSettings: Partial<AppSettings>) => {
    const { error } = await supabase
      .from("app_settings")
      .update(newSettings)
      .eq("id", "global");

    if (!error) {
      setSettings((prev) => (prev ? { ...prev, ...newSettings } : null));
    }

    return { error };
  };

  return {
    settings,
    loading,
    updateSettings,
    refetch: fetchSettings,
  };
}
