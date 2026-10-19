import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';


const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ||
  'https://jtevyqaooasufpgootyo.supabase.co';


const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp0ZXZ5cWFvb2FzdWZwZ29vdHlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyODQ2NTAsImV4cCI6MjEwNjg2MDY1MH0.hNX_c-jIX4hgBAvYBWUAgUt12QQOyagka3Bn7EFa8r0';


export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});


if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}


export async function checkSupabaseConnection(): Promise<{ ok: boolean; message: string }> {
  try {
    // With row-level security an anonymous visitor gets zero rows, but the
    // request still proves the API is reachable and the table exists.
    const { error, status } = await supabase.from('profiles').select('id').limit(1);
    if (!error && status < 400) {
      return { ok: true, message: 'Connected, database ready' };
    }
    if (error?.code === 'PGRST205' || error?.code === '42P01' || status === 404) {
      return { ok: false, message: 'Connected, but tables are missing. Run supabase/schema.sql.' };
    }
    return { ok: false, message: error?.message || 'Could not reach the database' };
  } catch (err: any) {
    return { ok: false, message: err?.message ?? 'Network error' };
  }
}
