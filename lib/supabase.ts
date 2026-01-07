/**
 * Supabase Client Configuration
 *
 * Creates two clients:
 * - supabase: Public client with anon key (RLS applies)
 * - supabaseAdmin: Admin client with service role key (bypasses RLS)
 *
 * Uses lazy initialization to prevent build-time errors when env vars aren't set.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Lazy-initialized clients to prevent build-time errors
let _supabase: SupabaseClient | null = null;
let _supabaseAdmin: SupabaseClient | null = null;

function getSupabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable');
  }
  return url;
}

function getSupabaseAnonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable');
  }
  return key;
}

/**
 * Public Supabase client (lazy-initialized)
 * - Uses anon key
 * - Row Level Security (RLS) applies
 * - Use for client-side operations
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    if (!_supabase) {
      _supabase = createClient(getSupabaseUrl(), getSupabaseAnonKey());
    }
    return (_supabase as any)[prop];
  }
});

/**
 * Admin Supabase client (lazy-initialized)
 * - Uses service role key
 * - Bypasses Row Level Security (RLS)
 * - Full database permissions
 * - Use ONLY on server-side (API routes, server components)
 *
 * WARNING: This will be undefined on the client side
 * Only import this in server-side code (API routes, server components)
 */
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    if (!_supabaseAdmin) {
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (serviceKey) {
        _supabaseAdmin = createClient(getSupabaseUrl(), serviceKey, {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        });
      } else {
        // Fallback to regular client if service key not available
        if (!_supabase) {
          _supabase = createClient(getSupabaseUrl(), getSupabaseAnonKey());
        }
        _supabaseAdmin = _supabase;
      }
    }
    return (_supabaseAdmin as any)[prop];
  }
});
