#!/usr/bin/env tsx
/**
 * Apply the batch condition→market lookup migration
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
)

async function applyMigration() {
  console.log('🔧 Applying batch condition→market migration to Supabase...\n')

  const sql = readFileSync('supabase/migrations/20251029200000_batch_condition_market_lookup.sql', 'utf-8')

  // Execute via SQL editor API
  const { data, error } = await supabase.from('_sql').select('*').limit(0)

  if (error) {
    console.error('❌ Supabase not ready or error:', error.message)
    console.log('\n📝 Please apply this migration manually via Supabase SQL Editor:')
    console.log('\nsupabase/migrations/20251029200000_batch_condition_market_lookup.sql\n')
    console.log('Or copy-paste this SQL:\n')
    console.log(sql)
    process.exit(1)
  }

  console.log('✅ Supabase is reachable. Please apply migration via dashboard or run:')
  console.log('\n  npx supabase db push\n')
  console.log('SQL to apply:')
  console.log('=' .repeat(80))
  console.log(sql)
  console.log('=' .repeat(80))
}

applyMigration()
