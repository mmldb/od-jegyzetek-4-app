import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

export const isConfigured = Boolean(
  SUPABASE_URL &&
  SUPABASE_PUBLISHABLE_KEY &&
  !SUPABASE_URL.includes("YOUR_PROJECT") &&
  !SUPABASE_PUBLISHABLE_KEY.includes("YOUR_PUBLISHABLE_KEY")
);

export const supabase = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
