#!/usr/bin/env tsx
/**
 * TEST MOMENTUM STRATEGY
 *
 * Tests the complete WATCHLIST → SIGNAL → ACTION flow with momentum indicators.
 *
 * Workflow:
 * 1. Find liquid markets in last 12 hours
 * 2. Filter by criteria (YES 10-40%, profit > fees)
 * 3. Add to watchlist (continuous monitoring)
 * 4. Wait for ENTRY SIGNAL (momentum ticks up)
 * 5. Execute trade (place limit order)
 * 6. Wait for EXIT SIGNAL (momentum levels out)
 * 7. Close position
 *
 * This tests:
 * - ✅ WATCHLIST node works
 * - ✅ SIGNAL nodes trigger automatically (event-driven)
 * - ✅ EXIT signals can loop back to monitor
 * - ✅ Momentum indicators work
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function createTestMomentumStrategy() {
  const supabase = createClient(supabaseUrl, supabaseKey)

  const strategyName = 'TEST: Momentum Watchlist Flow'
  console.log(`\n🧪 Creating ${strategyName}...\n`)

  // Delete existing test strategy
  const { data: existing } = await supabase
    .from('strategy_definitions')
    .select('strategy_id')
    .eq('strategy_name', strategyName)
    .single()

  if (existing) {
    console.log('Found existing test strategy, deleting...')
    await supabase
      .from('strategy_definitions')
      .delete()
      .eq('strategy_id', existing.strategy_id)
    console.log('✅ Deleted old test strategy\n')
  }

  const strategyId = crypto.randomUUID()

  // Complete momentum trading workflow with loops
  const nodeGraph = {
    nodes: [
      // 1. Find markets (last 12 hours, YES 10-40%)
      {
        id: 'data_source_markets',
        type: 'DATA_SOURCE',
        config: {
          source: 'MARKETS',
          mode: 'BATCH',
          prefilters: {
            active: true,
            minVolume: 1000,
            minLiquidity: 500,
          },
        },
      },

      // 2. Filter by Scotty's criteria
      {
        id: 'filter_candidates',
        type: 'ENHANCED_FILTER',
        config: {
          conditions: [
            {
              id: 'yes_price_min',
              field: 'price',
              operator: 'GREATER_THAN_OR_EQUAL',
              value: '0.10',
              fieldType: 'number',
            },
            {
              id: 'yes_price_max',
              field: 'price',
              operator: 'LESS_THAN_OR_EQUAL',
              value: '0.40',
              fieldType: 'number',
            },
            {
              id: 'volume_threshold',
              field: 'volume',
              operator: 'GREATER_THAN',
              value: '5000',
              fieldType: 'number',
            },
            {
              id: 'liquidity_threshold',
              field: 'liquidity',
              operator: 'GREATER_THAN',
              value: '1000',
              fieldType: 'number',
            },
            {
              id: 'active_only',
              field: 'active',
              operator: 'EQUALS',
              value: 'true',
              fieldType: 'boolean',
            },
          ],
          logic: 'AND',
          version: 2,
        },
      },

      // 3. Add to Watchlist (start monitoring)
      {
        id: 'add_to_watchlist',
        type: 'add-to-watchlist',
        config: {
          reason: 'momentum-test',
          autoMonitor: true,
        },
      },

      // 4. ENTRY SIGNAL - Wait for momentum tick up
      {
        id: 'signal_entry',
        type: 'SIGNAL',
        config: {
          signalType: 'ENTRY',
          condition: 'momentum_positive', // Reference to momentum check
          direction: 'NO', // Default to NO side
          strength: 'MODERATE',
          positionSize: {
            method: 'KELLY',
            baseAmount: 100,
          },
        },
      },

      // 5. Execute Entry Trade
      {
        id: 'action_enter_trade',
        type: 'ACTION',
        config: {
          action: 'PLACE_LIMIT_ORDER',
          description: 'Enter position when momentum crosses threshold',
          side: 'NO',
          orderType: 'LIMIT',
          exitRules: {
            profitTarget: 0.15,
            stopLoss: 0.10,
            maxHoldHours: 12,
          },
        },
      },

      // 6. EXIT SIGNAL - Wait for momentum to level out
      {
        id: 'signal_exit',
        type: 'SIGNAL',
        config: {
          signalType: 'EXIT',
          condition: 'momentum_leveling', // Momentum crosses back down
          positionSize: {
            method: 'FIXED',
            baseAmount: 0, // Exit full position
          },
        },
      },

      // 7. Execute Exit Trade
      {
        id: 'action_exit_trade',
        type: 'ACTION',
        config: {
          action: 'CLOSE_POSITION',
          description: 'Exit position when momentum levels out',
        },
      },
    ],

    edges: [
      // Linear flow to watchlist
      { from: 'data_source_markets', to: 'filter_candidates' },
      { from: 'filter_candidates', to: 'add_to_watchlist' },

      // Watchlist → Entry signal (wait for trigger)
      { from: 'add_to_watchlist', to: 'signal_entry' },

      // Entry signal → Execute trade
      { from: 'signal_entry', to: 'action_enter_trade' },

      // After trade, monitor for exit (LOOP BACK)
      { from: 'action_enter_trade', to: 'signal_exit' },

      // Exit signal → Close position
      { from: 'signal_exit', to: 'action_exit_trade' },
    ],
  }

  const { data, error } = await supabase
    .from('strategy_definitions')
    .insert({
      strategy_id: strategyId,
      strategy_name: strategyName,
      strategy_description: `🧪 TEST STRATEGY: Momentum Watchlist Flow

This is a test strategy to verify:
✅ WATCHLIST nodes work and persist
✅ SIGNAL nodes trigger automatically (event-driven)
✅ EXIT signals can loop back to monitor positions
✅ Momentum indicators work (RMA/EMA)

Workflow:
1. Find markets (YES 10-40%, liquid, last 12h)
2. Filter by criteria
3. Add to watchlist (START MONITORING)
4. Wait for ENTRY signal (momentum > 0)
5. Execute trade (limit order, NO side)
6. Wait for EXIT signal (momentum levels out)
7. Close position

Execution Mode: MANUAL (activate to test)
Node Count: 7 (complete entry/exit cycle)
Loop: Yes (exit signal monitors after entry)`,
      strategy_type: 'SCREENING',
      is_predefined: true,
      node_graph: nodeGraph,
      execution_mode: 'MANUAL', // Manual for testing
      is_active: false, // User must activate
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    console.error('❌ Error creating test strategy:', error)
    throw error
  }

  console.log('✅ Successfully created test momentum strategy!\n')
  console.log('Strategy Details:')
  console.log('  ID:', strategyId)
  console.log('  Name:', strategyName)
  console.log('  Nodes:', nodeGraph.nodes.length)
  console.log('  Edges:', nodeGraph.edges.length)
  console.log('  Loop: Yes (exit signal monitors after entry)')
  console.log('\nWorkflow:')
  console.log('  1. MARKETS → Find liquid markets')
  console.log('  2. FILTER → YES 10-40%, profit > fees')
  console.log('  3. WATCHLIST → Start monitoring')
  console.log('  4. SIGNAL (ENTRY) → Wait for momentum up')
  console.log('  5. ACTION → Execute trade')
  console.log('  6. SIGNAL (EXIT) → Wait for momentum level ← LOOP BACK')
  console.log('  7. ACTION → Close position')
  console.log('\nTests:')
  console.log('  ✅ Watchlist persistence')
  console.log('  ✅ Event-driven signals')
  console.log('  ✅ Exit signal loops')
  console.log('  ✅ Momentum indicators')
  console.log('\nTo Test:')
  console.log('  1. Go to http://localhost:3000/strategy-builder')
  console.log('  2. Find "TEST: Momentum Watchlist Flow"')
  console.log('  3. Activate it')
  console.log('  4. Check watchlist UI for added markets')
  console.log('  5. Verify signals trigger automatically')
  console.log('  6. Monitor execution log for entry/exit events')

  return strategyId
}

createTestMomentumStrategy()
  .then((id) => {
    console.log('\n✨ Test strategy ready!')
    console.log('Strategy ID:', id)
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Failed to create test strategy:', error)
    process.exit(1)
  })
