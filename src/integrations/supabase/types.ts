export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      ad_campaigns: {
        Row: {
          campaign_name: string
          clicks: number
          created_at: string
          date: string
          engine_id: string
          id: string
          impressions: number
          last_sync_at: string
          metadata: Json | null
          spend_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          campaign_name: string
          clicks?: number
          created_at?: string
          date?: string
          engine_id: string
          id?: string
          impressions?: number
          last_sync_at?: string
          metadata?: Json | null
          spend_amount?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          campaign_name?: string
          clicks?: number
          created_at?: string
          date?: string
          engine_id?: string
          id?: string
          impressions?: number
          last_sync_at?: string
          metadata?: Json | null
          spend_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_audit_log: {
        Row: {
          created_at: string
          id: string
          image_url: string | null
          raw_json: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_url?: string | null
          raw_json: Json
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          image_url?: string | null
          raw_json?: Json
          user_id?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          disable_public_signups: boolean
          id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          disable_public_signups?: boolean
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          disable_public_signups?: boolean
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      bookings: {
        Row: {
          attribution_id: string | null
          booking_id: string
          created_at: string
          guest_email: string | null
          guest_name: string
          guest_phone: string | null
          id: string
          metadata: Json | null
          party_size: number
          raw_stream_id: string | null
          reservation_time: string
          source: string
          status: string
          tenant_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          attribution_id?: string | null
          booking_id: string
          created_at?: string
          guest_email?: string | null
          guest_name?: string
          guest_phone?: string | null
          id?: string
          metadata?: Json | null
          party_size?: number
          raw_stream_id?: string | null
          reservation_time: string
          source?: string
          status?: string
          tenant_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          attribution_id?: string | null
          booking_id?: string
          created_at?: string
          guest_email?: string | null
          guest_name?: string
          guest_phone?: string | null
          id?: string
          metadata?: Json | null
          party_size?: number
          raw_stream_id?: string | null
          reservation_time?: string
          source?: string
          status?: string
          tenant_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      committed_accruals: {
        Row: {
          commitment_date: string
          committed_amount: number
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          is_active: boolean
          metadata: Json | null
          settled_at: string | null
          settled_ledger_id: string | null
          tenant_id: string | null
          user_id: string
          vendor_name: string
        }
        Insert: {
          commitment_date?: string
          committed_amount?: number
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json | null
          settled_at?: string | null
          settled_ledger_id?: string | null
          tenant_id?: string | null
          user_id: string
          vendor_name: string
        }
        Update: {
          commitment_date?: string
          committed_amount?: number
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          is_active?: boolean
          metadata?: Json | null
          settled_at?: string | null
          settled_ledger_id?: string | null
          tenant_id?: string | null
          user_id?: string
          vendor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "committed_accruals_settled_ledger_id_fkey"
            columns: ["settled_ledger_id"]
            isOneToOne: false
            referencedRelation: "financial_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "committed_accruals_settled_ledger_id_fkey"
            columns: ["settled_ledger_id"]
            isOneToOne: false
            referencedRelation: "sales_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "committed_accruals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      discovered_invoices: {
        Row: {
          confidence: string
          confidence_reason: string
          created_at: string
          file_size: number
          filename: string
          id: string
          is_already_siphoned: boolean
          is_known_supplier: boolean
          message_id: string
          received_at: string
          scan_id: string
          sender_address: string
          sender_domain: string
          sender_name: string
          subject: string
          user_id: string
        }
        Insert: {
          confidence?: string
          confidence_reason?: string
          created_at?: string
          file_size?: number
          filename?: string
          id?: string
          is_already_siphoned?: boolean
          is_known_supplier?: boolean
          message_id: string
          received_at?: string
          scan_id?: string
          sender_address?: string
          sender_domain?: string
          sender_name?: string
          subject?: string
          user_id: string
        }
        Update: {
          confidence?: string
          confidence_reason?: string
          created_at?: string
          file_size?: number
          filename?: string
          id?: string
          is_already_siphoned?: boolean
          is_known_supplier?: boolean
          message_id?: string
          received_at?: string
          scan_id?: string
          sender_address?: string
          sender_domain?: string
          sender_name?: string
          subject?: string
          user_id?: string
        }
        Relationships: []
      }
      financial_ledger: {
        Row: {
          attribution_id: string | null
          audit_id: string | null
          category: Database["public"]["Enums"]["ledger_category"]
          created_at: string
          gross_amount: number
          id: string
          metadata: Json | null
          net_amount: number
          pot_id: string | null
          tenant_id: string | null
          transaction_date: string
          user_id: string
          vat_amount: number
          vendor_name: string
        }
        Insert: {
          attribution_id?: string | null
          audit_id?: string | null
          category: Database["public"]["Enums"]["ledger_category"]
          created_at?: string
          gross_amount?: number
          id?: string
          metadata?: Json | null
          net_amount?: number
          pot_id?: string | null
          tenant_id?: string | null
          transaction_date?: string
          user_id: string
          vat_amount?: number
          vendor_name: string
        }
        Update: {
          attribution_id?: string | null
          audit_id?: string | null
          category?: Database["public"]["Enums"]["ledger_category"]
          created_at?: string
          gross_amount?: number
          id?: string
          metadata?: Json | null
          net_amount?: number
          pot_id?: string | null
          tenant_id?: string | null
          transaction_date?: string
          user_id?: string
          vat_amount?: number
          vendor_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_ledger_attribution_id_fkey"
            columns: ["attribution_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["attribution_id"]
          },
          {
            foreignKeyName: "financial_ledger_audit_id_fkey"
            columns: ["audit_id"]
            isOneToOne: false
            referencedRelation: "ai_audit_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_ledger_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          attribution_id: string
          created_at: string
          email: string
          id: string
          lead_source: string | null
          logic_leaks: string | null
          name: string
          phone: string | null
          user_id: string
        }
        Insert: {
          attribution_id?: string
          created_at?: string
          email: string
          id?: string
          lead_source?: string | null
          logic_leaks?: string | null
          name: string
          phone?: string | null
          user_id: string
        }
        Update: {
          attribution_id?: string
          created_at?: string
          email?: string
          id?: string
          lead_source?: string | null
          logic_leaks?: string | null
          name?: string
          phone?: string | null
          user_id?: string
        }
        Relationships: []
      }
      microsoft_oauth_tokens: {
        Row: {
          access_token: string
          created_at: string
          expires_at: string
          id: string
          refresh_token: string
          scopes: string
          tenant_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          expires_at: string
          id?: string
          refresh_token: string
          scopes?: string
          tenant_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          expires_at?: string
          id?: string
          refresh_token?: string
          scopes?: string
          tenant_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          id: string
          is_approved: boolean
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id: string
          is_approved?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_approved?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      raw_data_stream: {
        Row: {
          created_at: string
          error_detail: string | null
          id: string
          ledger_entry_id: string | null
          payload: Json
          processed_at: string | null
          source: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_detail?: string | null
          id?: string
          ledger_entry_id?: string | null
          payload?: Json
          processed_at?: string | null
          source?: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_detail?: string | null
          id?: string
          ledger_entry_id?: string | null
          payload?: Json
          processed_at?: string | null
          source?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_data_stream_ledger_entry_id_fkey"
            columns: ["ledger_entry_id"]
            isOneToOne: false
            referencedRelation: "financial_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "raw_data_stream_ledger_entry_id_fkey"
            columns: ["ledger_entry_id"]
            isOneToOne: false
            referencedRelation: "sales_ledger"
            referencedColumns: ["id"]
          },
        ]
      }
      siphoned_invoices: {
        Row: {
          accrual_entry_id: string | null
          amount_detected: number | null
          attachment_name: string | null
          created_at: string
          id: string
          ledger_entry_id: string | null
          raw_json: Json | null
          received_at: string
          sender: string
          status: string
          subject: string
          tenant_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          accrual_entry_id?: string | null
          amount_detected?: number | null
          attachment_name?: string | null
          created_at?: string
          id?: string
          ledger_entry_id?: string | null
          raw_json?: Json | null
          received_at?: string
          sender?: string
          status?: string
          subject?: string
          tenant_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          accrual_entry_id?: string | null
          amount_detected?: number | null
          attachment_name?: string | null
          created_at?: string
          id?: string
          ledger_entry_id?: string | null
          raw_json?: Json | null
          received_at?: string
          sender?: string
          status?: string
          subject?: string
          tenant_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "siphoned_invoices_accrual_entry_id_fkey"
            columns: ["accrual_entry_id"]
            isOneToOne: false
            referencedRelation: "committed_accruals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "siphoned_invoices_ledger_entry_id_fkey"
            columns: ["ledger_entry_id"]
            isOneToOne: false
            referencedRelation: "financial_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "siphoned_invoices_ledger_entry_id_fkey"
            columns: ["ledger_entry_id"]
            isOneToOne: false
            referencedRelation: "sales_ledger"
            referencedColumns: ["id"]
          },
        ]
      }
      system_audit_log: {
        Row: {
          action_type: string
          changed_by: string | null
          created_at: string
          id: string
          new_data_hash: string | null
          old_data_hash: string | null
          record_id: string
          table_name: string
        }
        Insert: {
          action_type: string
          changed_by?: string | null
          created_at?: string
          id?: string
          new_data_hash?: string | null
          old_data_hash?: string | null
          record_id: string
          table_name: string
        }
        Update: {
          action_type?: string
          changed_by?: string | null
          created_at?: string
          id?: string
          new_data_hash?: string | null
          old_data_hash?: string | null
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      absolute_truth_calculator: {
        Row: {
          a_total: number | null
          d_total: number | null
          o_total: number | null
          p_total: number | null
          r_total: number | null
          s_value: number | null
          tenant_id: string | null
          user_id: string | null
          v_total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_ledger_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_ledger: {
        Row: {
          attribution_id: string | null
          created_at: string | null
          gross_amount: number | null
          id: string | null
          metadata: Json | null
          net_amount: number | null
          tenant_id: string | null
          transaction_date: string | null
          user_id: string | null
          vat_amount: number | null
          vendor_name: string | null
        }
        Insert: {
          attribution_id?: string | null
          created_at?: string | null
          gross_amount?: number | null
          id?: string | null
          metadata?: Json | null
          net_amount?: number | null
          tenant_id?: string | null
          transaction_date?: string | null
          user_id?: string | null
          vat_amount?: number | null
          vendor_name?: string | null
        }
        Update: {
          attribution_id?: string | null
          created_at?: string | null
          gross_amount?: number | null
          id?: string | null
          metadata?: Json | null
          net_amount?: number | null
          tenant_id?: string | null
          transaction_date?: string | null
          user_id?: string | null
          vat_amount?: number | null
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financial_ledger_attribution_id_fkey"
            columns: ["attribution_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["attribution_id"]
          },
          {
            foreignKeyName: "financial_ledger_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      calculate_s_number: {
        Args: { p_user_id: string }
        Returns: {
          a_total: number
          calculated_at: string
          d_total: number
          hash: string
          o_total: number
          p_total: number
          r_total: number
          s_value: number
          v_total: number
        }[]
      }
      get_user_profile: {
        Args: { _user_id: string }
        Returns: {
          email: string
          id: string
          is_approved: boolean
          role: Database["public"]["Enums"]["user_role"]
        }[]
      }
      get_user_tenant_id: { Args: { _user_id: string }; Returns: string }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      ledger_category: "R" | "P" | "O" | "V" | "D" | "A"
      user_role: "super_admin" | "manager" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      ledger_category: ["R", "P", "O", "V", "D", "A"],
      user_role: ["super_admin", "manager", "viewer"],
    },
  },
} as const
