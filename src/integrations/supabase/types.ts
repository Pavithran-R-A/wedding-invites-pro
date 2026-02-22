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
      activity_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          ip: string | null
          project_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip?: string | null
          project_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip?: string | null
          project_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_logs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      guests: {
        Row: {
          accommodation: boolean | null
          created_at: string
          email: string | null
          group_name: string | null
          id: string
          meal_time: string | null
          meal_type: string | null
          name: string
          notes: string | null
          people_count: number | null
          phone: string | null
          project_id: string
          rsvp_at: string | null
          rsvp_status: Database["public"]["Enums"]["rsvp_status"] | null
          token: string | null
          transport: boolean | null
        }
        Insert: {
          accommodation?: boolean | null
          created_at?: string
          email?: string | null
          group_name?: string | null
          id?: string
          meal_time?: string | null
          meal_type?: string | null
          name: string
          notes?: string | null
          people_count?: number | null
          phone?: string | null
          project_id: string
          rsvp_at?: string | null
          rsvp_status?: Database["public"]["Enums"]["rsvp_status"] | null
          token?: string | null
          transport?: boolean | null
        }
        Update: {
          accommodation?: boolean | null
          created_at?: string
          email?: string | null
          group_name?: string | null
          id?: string
          meal_time?: string | null
          meal_type?: string | null
          name?: string
          notes?: string | null
          people_count?: number | null
          phone?: string | null
          project_id?: string
          rsvp_at?: string | null
          rsvp_status?: Database["public"]["Enums"]["rsvp_status"] | null
          token?: string | null
          transport?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "guests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cost_printer_paise: number | null
          created_at: string
          id: string
          pdf_url: string | null
          price_platform_paise: number | null
          printer_id: string | null
          project_id: string
          status: Database["public"]["Enums"]["order_status"] | null
          type: string
        }
        Insert: {
          cost_printer_paise?: number | null
          created_at?: string
          id?: string
          pdf_url?: string | null
          price_platform_paise?: number | null
          printer_id?: string | null
          project_id: string
          status?: Database["public"]["Enums"]["order_status"] | null
          type?: string
        }
        Update: {
          cost_printer_paise?: number | null
          created_at?: string
          id?: string
          pdf_url?: string | null
          price_platform_paise?: number | null
          printer_id?: string | null
          project_id?: string
          status?: Database["public"]["Enums"]["order_status"] | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_printer_id_fkey"
            columns: ["printer_id"]
            isOneToOne: false
            referencedRelation: "printers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_paise: number
          created_at: string
          id: string
          order_id: string | null
          provider: string | null
          provider_id: string | null
          status: Database["public"]["Enums"]["payment_status"] | null
          user_id: string
        }
        Insert: {
          amount_paise: number
          created_at?: string
          id?: string
          order_id?: string | null
          provider?: string | null
          provider_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"] | null
          user_id: string
        }
        Update: {
          amount_paise?: number
          created_at?: string
          id?: string
          order_id?: string | null
          provider?: string | null
          provider_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"] | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      printers: {
        Row: {
          active: boolean | null
          api_endpoint: string | null
          contact: string | null
          created_at: string
          id: string
          name: string
          payment_terms: string | null
          regions: string[] | null
        }
        Insert: {
          active?: boolean | null
          api_endpoint?: string | null
          contact?: string | null
          created_at?: string
          id?: string
          name: string
          payment_terms?: string | null
          regions?: string[] | null
        }
        Update: {
          active?: boolean | null
          api_endpoint?: string | null
          contact?: string | null
          created_at?: string
          id?: string
          name?: string
          payment_terms?: string | null
          regions?: string[] | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          id: string
          language_pref: string | null
          last_login: string | null
          name: string | null
          phone: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          language_pref?: string | null
          last_login?: string | null
          name?: string | null
          phone?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          language_pref?: string | null
          last_login?: string | null
          name?: string | null
          phone?: string | null
          user_id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          guest_count: number | null
          id: string
          language: string | null
          paid_status: Database["public"]["Enums"]["paid_status"] | null
          selected_features: Json | null
          template_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          guest_count?: number | null
          id?: string
          language?: string | null
          paid_status?: Database["public"]["Enums"]["paid_status"] | null
          selected_features?: Json | null
          template_id?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          guest_count?: number | null
          id?: string
          language?: string | null
          paid_status?: Database["public"]["Enums"]["paid_status"] | null
          selected_features?: Json | null
          template_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
        ]
      }
      templates: {
        Row: {
          active: boolean | null
          created_at: string
          id: string
          language_support: string[] | null
          name: string
          preview_svg: string | null
          price_tier: string | null
          tags: string[] | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string
          id?: string
          language_support?: string[] | null
          name: string
          preview_svg?: string | null
          price_tier?: string | null
          tags?: string[] | null
        }
        Update: {
          active?: boolean | null
          created_at?: string
          id?: string
          language_support?: string[] | null
          name?: string
          preview_svg?: string | null
          price_tier?: string | null
          tags?: string[] | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_project_owner: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user" | "planner"
      order_status: "pending" | "paid" | "held" | "sent" | "delivered"
      paid_status: "unpaid" | "base_paid" | "fully_paid"
      payment_status: "created" | "captured" | "failed" | "refunded"
      rsvp_status: "pending" | "attending" | "declined"
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
      app_role: ["admin", "user", "planner"],
      order_status: ["pending", "paid", "held", "sent", "delivered"],
      paid_status: ["unpaid", "base_paid", "fully_paid"],
      payment_status: ["created", "captured", "failed", "refunded"],
      rsvp_status: ["pending", "attending", "declined"],
    },
  },
} as const
