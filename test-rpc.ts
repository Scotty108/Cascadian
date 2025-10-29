#!/usr/bin/env tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'

async function test() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  )

  console.log('Testing batch RPC function...')

  const testConditions = ['0x123', '0x456']
  const { data, error } = await supabase.rpc('resolve_condition_to_market_batch', {
    condition_ids: testConditions
  })

  if (error) {
    console.error('❌ RPC Error:', error.message)
    if (error.message?.includes('not find')) {
      console.log('\n⚠️  RPC function does not exist! Migration was not applied correctly.')
    }
    process.exit(1)
  } else {
    console.log('✅ RPC function exists and returned:', data?.length || 0, 'results')
    console.log('Sample:', data)
  }
}

test()
