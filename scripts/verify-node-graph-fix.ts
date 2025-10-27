#!/usr/bin/env tsx

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function verifyFix() {
  console.log('🔍 Verifying node graph structure fix...\n')

  try {
    const { data: strategies, error } = await supabase
      .from('strategy_definitions')
      .select('strategy_name, node_graph')
      .in('strategy_name', ['Consensus Copy Trade', 'Smart-Money Imbalance Value Trade'])
      .eq('is_predefined', true)

    if (error) {
      console.error('❌ Error fetching strategies:', error)
      throw error
    }

    if (!strategies || strategies.length === 0) {
      console.error('❌ No strategies found!')
      process.exit(1)
    }

    console.log(`✅ Found ${strategies.length} strategies\n`)

    let allValid = true

    for (const strategy of strategies) {
      console.log(`📋 ${strategy.strategy_name}:`)
      
      const nodeGraph = strategy.node_graph as any
      const nodes = nodeGraph.nodes || []

      let hasDataWrapper = false
      let hasPositionField = false
      let hasConfigDirectly = false

      for (const node of nodes) {
        if (node.data) {
          hasDataWrapper = true
        }
        if (node.position) {
          hasPositionField = true
        }
        if (node.config) {
          hasConfigDirectly = true
        }
      }

      console.log(`   - Nodes: ${nodes.length}`)
      console.log(`   - Has "data" wrapper: ${hasDataWrapper ? '❌ YES (INCORRECT)' : '✅ NO (CORRECT)'}`)
      console.log(`   - Has "position" fields: ${hasPositionField ? '❌ YES (INCORRECT)' : '✅ NO (CORRECT)'}`)
      console.log(`   - Has "config" directly on nodes: ${hasConfigDirectly ? '✅ YES (CORRECT)' : '❌ NO (INCORRECT)'}`)

      if (hasDataWrapper || hasPositionField || !hasConfigDirectly) {
        allValid = false
        console.log(`   ❌ Structure is INCORRECT\n`)
      } else {
        console.log(`   ✅ Structure is CORRECT\n`)
      }
    }

    if (allValid) {
      console.log('✅ All strategies have correct node graph structure!')
      console.log('✅ Production error should be resolved!')
    } else {
      console.log('❌ Some strategies still have incorrect structure')
      process.exit(1)
    }

  } catch (error) {
    console.error('❌ Verification failed:', error)
    process.exit(1)
  }
}

verifyFix()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
