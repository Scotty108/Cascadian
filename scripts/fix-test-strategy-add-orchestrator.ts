#!/usr/bin/env tsx
/**
 * FIX TEST STRATEGY - ADD ORCHESTRATOR
 *
 * The test strategy was missing the ORCHESTRATOR node for position sizing.
 * This adds it between SIGNAL (ENTRY) and ACTION (ENTER).
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function fixTestStrategy() {
  const supabase = createClient(supabaseUrl, supabaseKey)

  const strategyName = 'TEST: Momentum Watchlist Flow'
  console.log(`\n🔧 Fixing ${strategyName} - Adding ORCHESTRATOR...\n`)

  const { data: existing } = await supabase
    .from('strategy_definitions')
    .select('strategy_id, node_graph')
    .eq('strategy_name', strategyName)
    .single()

  if (!existing) {
    console.log('❌ Test strategy not found')
    return
  }

  // Rebuild with ORCHESTRATOR included
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
          condition: 'momentum_positive',
          direction: 'NO',
          strength: 'MODERATE',
        },
      },

      // 5. ORCHESTRATOR - Calculate position size ← ADDED!
      {
        id: 'orchestrator_sizing',
        type: 'ORCHESTRATOR',
        config: {
          version: 1,
          mode: 'approval',
          preferred_side: 'NO',
          order_type: 'LIMIT',
          portfolio_size_usd: 10000,
          risk_tolerance: 5,
          position_sizing_rules: {
            fractional_kelly_lambda: 0.375,
            max_per_position: 0.05,
            min_bet: 5,
            max_bet: 500,
            portfolio_heat_limit: 0.60,
            risk_reward_threshold: 1.5,
            drawdown_protection: {
              enabled: true,
              drawdown_threshold: 0.10,
              size_reduction: 0.50,
            },
          },
        },
      },

      // 6. Execute Entry Trade
      {
        id: 'action_enter_trade',
        type: 'ACTION',
        config: {
          action: 'PLACE_LIMIT_ORDER',
          description: 'Enter position when momentum crosses threshold',
          side: 'NO',
          orderType: 'LIMIT',
          exit_rules: {
            profit_target_pct: 0.15,
            stop_loss_pct: 0.10,
            max_hold_hours: 12,
          },
        },
      },

      // 7. EXIT SIGNAL - Wait for momentum to level out
      {
        id: 'signal_exit',
        type: 'SIGNAL',
        config: {
          signalType: 'EXIT',
          condition: 'momentum_leveling',
        },
      },

      // 8. Execute Exit Trade
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

      // Entry signal → ORCHESTRATOR → Execute trade
      { from: 'signal_entry', to: 'orchestrator_sizing' },
      { from: 'orchestrator_sizing', to: 'action_enter_trade' },

      // After trade, monitor for exit (LOOP BACK)
      { from: 'action_enter_trade', to: 'signal_exit' },

      // Exit signal → Close position
      { from: 'signal_exit', to: 'action_exit_trade' },
    ],
  }

  const { error } = await supabase
    .from('strategy_definitions')
    .update({
      node_graph: nodeGraph,
      strategy_description: `🧪 TEST STRATEGY: Momentum Watchlist Flow

This is a test strategy to verify:
✅ WATCHLIST nodes work and persist
✅ SIGNAL nodes trigger automatically (event-driven)
✅ EXIT signals can loop back to monitor positions
✅ Momentum indicators work (RMA/EMA)
✅ ORCHESTRATOR calculates proper position sizes

Workflow:
1. Find markets (YES 10-40%, liquid, last 12h)
2. Filter by criteria
3. Add to watchlist (START MONITORING)
4. Wait for ENTRY signal (momentum > 0)
5. Calculate position size (ORCHESTRATOR with Kelly)
6. Execute trade (limit order, NO side)
7. Wait for EXIT signal (momentum levels out)
8. Close position

Execution Mode: MANUAL (activate to test)
Node Count: 8 (complete entry/exit cycle with sizing)
Loop: Yes (exit signal monitors after entry)`,
      updated_at: new Date().toISOString(),
    })
    .eq('strategy_id', existing.strategy_id)

  if (error) {
    console.error('❌ Error:', error)
    return
  }

  console.log('✅ Successfully updated test strategy!\n')
  console.log('Changes:')
  console.log('  ➕ Added ORCHESTRATOR node (position sizing)')
  console.log('  📊 Kelly sizing: 0.375')
  console.log('  💰 Max per position: 5%')
  console.log('  🛡️  Drawdown protection: enabled')
  console.log('\nNew Workflow:')
  console.log('  1. MARKETS → Find liquid markets')
  console.log('  2. FILTER → YES 10-40%, profit > fees')
  console.log('  3. WATCHLIST → Start monitoring')
  console.log('  4. SIGNAL (ENTRY) → Wait for momentum up')
  console.log('  5. ORCHESTRATOR → Calculate position size ← NEW!')
  console.log('  6. ACTION → Execute trade')
  console.log('  7. SIGNAL (EXIT) → Wait for momentum level')
  console.log('  8. ACTION → Close position')
  console.log('\nTotal Nodes: 8 (was 7)')
  console.log('Total Edges: 7 (was 6)')
}

fixTestStrategy()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error)
    process.exit(1)
  })
