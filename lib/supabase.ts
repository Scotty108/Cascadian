/**
 * Supabase Client Configuration
 *
 * Creates two clients:
 * - supabase: Public client with anon key (RLS applies)
 * - supabaseAdmin: Admin client with service role key (bypasses RLS)
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

/**
 * Public Supabase client
 * - Uses anon key
 * - Row Level Security (RLS) applies
 * - Use for client-side operations
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Admin Supabase client
 * - Uses service role key
 * - Bypasses Row Level Security (RLS)
 * - Full database permissions
 * - Use ONLY on server-side (API routes, server components)
 *
 * WARNING: This will be undefined on the client side
 * Only import this in server-side code (API routes, server components)
 */
export const supabaseAdmin = supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : supabase; // Fallback to regular client if service key not available (client-side)
