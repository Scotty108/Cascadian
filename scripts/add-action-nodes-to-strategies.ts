#!/usr/bin/env tsx
/**
 * ADD ACTION NODES TO ALL STRATEGIES
 *
 * Completes trading workflows by adding explicit ACTION nodes:
 * - Find opportunities
 * - Filter by criteria
 * - Size positions (ORCHESTRATOR)
 * - Execute trades (ACTION) ← Adding this!
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const strategiesWithActions = [
  {
    name: 'Aggressive Growth',
    actionConfig: {
      id: 'action_execute_trades',
      type: 'ACTION',
      config: {
        action: 'PLACE_LIMIT_ORDER',
        description: 'Execute high-growth trades with tight risk management',
        follow_wallet_side: true,
        max_concurrent_positions: 10,
        exit_rules: {
          profit_target_pct: 0.30,
          stop_loss_pct: 0.15,
          max_hold_hours: 48,
          trailing_stop_enabled: true,
          trailing_stop_activation: 0.15,
          trailing_stop_distance: 0.08,
        },
      },
    },
  },
  {
    name: 'Balanced Hybrid',
    actionConfig: {
      id: 'action_execute_trades',
      type: 'ACTION',
      config: {
        action: 'PLACE_LIMIT_ORDER',
        description: 'Execute balanced trades with moderate risk',
        follow_wallet_side: true,
        max_concurrent_positions: 15,
        exit_rules: {
          profit_target_pct: 0.20,
          stop_loss_pct: 0.10,
          max_hold_hours: 72,
        },
      },
    },
  },
  {
    name: 'Eggman Hunter (AI Specialist)',
    actionConfig: {
      id: 'action_execute_trades',
      type: 'ACTION',
      config: {
        action: 'PLACE_LIMIT_ORDER',
        description: 'Copy AI specialist trades',
        follow_wallet_side: true,
        max_concurrent_positions: 8,
        exit_rules: {
          profit_target_pct: 0.25,
          stop_loss_pct: 0.12,
          max_hold_hours: 96,
          follow_source_wallet: true,
        },
      },
    },
  },
  {
    name: 'Safe & Steady',
    actionConfig: {
      id: 'action_execute_trades',
      type: 'ACTION',
      config: {
        action: 'PLACE_LIMIT_ORDER',
        description: 'Execute conservative trades with capital preservation focus',
        follow_wallet_side: true,
        max_concurrent_positions: 12,
        exit_rules: {
          profit_target_pct: 0.15,
          stop_loss_pct: 0.08,
          max_hold_hours: 120,
          time_stop_enabled: true,
        },
      },
    },
  },
  {
    name: 'Momentum Rider',
    actionConfig: {
      id: 'action_execute_trades',
      type: 'ACTION',
      config: {
        action: 'PLACE_LIMIT_ORDER',
        description: 'Ride momentum with dynamic exits',
        follow_wallet_side: true,
        max_concurrent_positions: 12,
        exit_rules: {
          profit_target_pct: 0.25,
          stop_loss_pct: 0.12,
          max_hold_hours: 48,
          trailing_stop_enabled: true,
          trailing_stop_activation: 0.12,
          trailing_stop_distance: 0.06,
          momentum_exit: true,
        },
      },
    },
  },
  {
    name: 'Fortress',
    actionConfig: {
      id: 'action_execute_trades',
      type: 'ACTION',
      config: {
        action: 'PLACE_LIMIT_ORDER',
        description: 'Execute ultra-conservative trades',
        follow_wallet_side: true,
        max_concurrent_positions: 8,
        exit_rules: {
          profit_target_pct: 0.12,
          stop_loss_pct: 0.06,
          max_hold_hours: 168,
          early_exit_on_deterioration: true,
        },
      },
    },
  },
  {
    name: 'Rising Star',
    actionConfig: {
      id: 'action_execute_trades',
      type: 'ACTION',
      config: {
        action: 'PLACE_LIMIT_ORDER',
        description: 'Trade emerging talent with moderate risk',
        follow_wallet_side: true,
        max_concurrent_positions: 10,
        exit_rules: {
          profit_target_pct: 0.25,
          stop_loss_pct: 0.12,
          max_hold_hours: 72,
          follow_source_wallet: true,
        },
      },
    },
  },
  {
    name: 'Alpha Decay Detector',
    actionConfig: {
      id: 'action_fade_trades',
      type: 'ACTION',
      config: {
        action: 'PLACE_LIMIT_ORDER',
        description: 'Fade declining wallets (take opposite side)',
        follow_wallet_side: false,
        inverse_side: true,
        max_concurrent_positions: 8,
        exit_rules: {
          profit_target_pct: 0.15,
          stop_loss_pct: 0.10,
          max_hold_hours: 96,
        },
      },
    },
  },
]

async function addActionNodes() {
  const supabase = createClient(supabaseUrl, supabaseKey)

  console.log('🔧 Adding ACTION nodes to complete trading workflows...\n')

  let successCount = 0
  let errorCount = 0

  for (const strategy of strategiesWithActions) {
    console.log(`\n📝 ${strategy.name}`)

    // Get existing strategy
    const { data: existing } = await supabase
      .from('strategy_definitions')
      .select('strategy_id, node_graph')
      .eq('strategy_name', strategy.name)
      .single()

    if (!existing) {
      console.log('   ❌ Strategy not found')
      errorCount++
      continue
    }

    const nodeGraph = existing.node_graph

    // Check if ACTION node already exists
    const hasAction = nodeGraph.nodes.some((n: any) => n.type === 'ACTION')
    if (hasAction) {
      console.log('   ℹ️  Already has ACTION node, skipping')
      continue
    }

    // Find the ORCHESTRATOR node (last node currently)
    const orchestratorNode = nodeGraph.nodes.find((n: any) => n.type === 'ORCHESTRATOR')
    if (!orchestratorNode) {
      console.log('   ❌ No ORCHESTRATOR node found')
      errorCount++
      continue
    }

    // Add ACTION node
    nodeGraph.nodes.push(strategy.actionConfig)

    // Add edge from ORCHESTRATOR to ACTION
    nodeGraph.edges.push({
      from: orchestratorNode.id,
      to: strategy.actionConfig.id,
    })

    console.log(`   ➕ Added ACTION node: ${strategy.actionConfig.config.description}`)
    console.log(`   📊 New structure: ${nodeGraph.nodes.length} nodes, ${nodeGraph.edges.length} edges`)

    // Update strategy
    const { error } = await supabase
      .from('strategy_definitions')
      .update({
        node_graph: nodeGraph,
        updated_at: new Date().toISOString(),
      })
      .eq('strategy_id', existing.strategy_id)

    if (error) {
      console.log('   ❌ Error:', error.message)
      errorCount++
    } else {
      console.log('   ✅ Success')
      successCount++
    }
  }

  console.log(`\n${'='.repeat(80)}`)
  console.log(`\n📊 SUMMARY`)
  console.log(`   ✅ Success: ${successCount}/${strategiesWithActions.length}`)
  console.log(`   ❌ Errors: ${errorCount}/${strategiesWithActions.length}`)
  console.log(`\n✨ All strategies now have complete trading workflows:`)
  console.log(`   DATA_SOURCE → ENHANCED_FILTER → AGGREGATION → ORCHESTRATOR → ACTION\n`)
}

addActionNodes()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error)
    process.exit(1)
  })
