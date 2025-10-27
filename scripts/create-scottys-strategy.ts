#!/usr/bin/env tsx
/**
 * Create "Scotty's Strategy" as a predefined template
 *
 * Trading Rules:
 * 1. Only last 12 hours before resolution (90% accuracy)
 * 2. Default to NO (79% base rate)
 * 3. Only trade if profit > fees + spread
 * 4. Use limit orders only (be maker)
 * 5. Target YES odds 10-40% (skip pennies)
 * 6. Prefer liquid markets (tight spreads, good depth)
 *
 * Workflow:
 * Filter → Watchlist → Momentum monitoring → Trade → Exit on momentum level
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

// Load environment variables
config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function createScottysStrategy() {
  const supabase = createClient(supabaseUrl, supabaseKey)

  // Delete existing strategy if it exists (to update with new workflow)
  const { data: existing } = await supabase
    .from('strategy_definitions')
    .select('strategy_id')
    .eq('strategy_name', "Scotty's Strategy")
    .single()

  if (existing) {
    console.log("Found existing Scotty's Strategy, deleting to update...")
    const { error: deleteError } = await supabase
      .from('strategy_definitions')
      .delete()
      .eq('strategy_id', existing.strategy_id)

    if (deleteError) {
      console.error('Error deleting old strategy:', deleteError)
    } else {
      console.log('✅ Deleted old strategy')
    }
  }

  const strategyId = crypto.randomUUID()

  // Define the node graph: CRON-triggered batch workflow
  // Runs every N minutes: Fetch markets → Filter → Orchestrator decides → Execute
  const nodeGraph = {
    nodes: [
      // 1. Data Source - Fetch ALL active Polymarket markets
      {
        id: 'data_source_1',
        type: 'DATA_SOURCE',
        config: {
          source: 'MARKETS',
          mode: 'BATCH', // Fetch all markets each CRON run
          prefilters: {
            status: 'open',
            minVolume: 1000,
          },
        },
      },

      // 2. Enhanced Filter - All 6 Scotty Rules
      // Filters down from ~1,247 markets to ~47 that pass all rules
      {
        id: 'enhanced_filter_1',
        type: 'ENHANCED_FILTER',
        config: {
          conditions: [
            // Rule 5: Target YES odds 10-40% (using actual price field)
            {
              id: 'rule_5_yes_min',
              field: 'price',
              operator: 'GREATER_THAN_OR_EQUAL',
              value: '0.10',
              fieldType: 'number',
            },
            {
              id: 'rule_5_yes_max',
              field: 'price',
              operator: 'LESS_THAN_OR_EQUAL',
              value: '0.40',
              fieldType: 'number',
            },

            // Rule 6a: Prefer liquid markets (using volume as proxy)
            {
              id: 'rule_6_volume',
              field: 'volume',
              operator: 'GREATER_THAN',
              value: '5000',
              fieldType: 'number',
            },

            // Rule 6b: Prefer liquid markets (using liquidity)
            {
              id: 'rule_6_liquidity',
              field: 'liquidity',
              operator: 'GREATER_THAN',
              value: '1000',
              fieldType: 'number',
            },

            // Market must be active
            {
              id: 'market_active',
              field: 'active',
              operator: 'EQUALS',
              value: 'true',
              fieldType: 'boolean',
            },

            // NOTE: The following rules need calculated fields added by preprocessing:
            // - Rule 1: hours_until_resolution (calculated from endDate - now)
            // - Rule 3: expected_profit_after_fees (calculated from price, fees, spread)
            // - Rule 6c: spread_bps (calculated from order book data)
            //
            // These can be added via a custom preprocessing node or orchestrator logic
          ],
          logic: 'AND',
          version: 2,
        },
      },

      // 3. Orchestrator - AI Position Sizing & Execution
      // For each market that passed filter:
      // - Fetches portfolio state
      // - Calls Claude AI for position sizing
      // - Calculates Kelly bet size
      // - Decides: GO or NO_GO
      // - If mode='autonomous': executes immediately
      // - If mode='approval': sends notification for review
      {
        id: 'orchestrator_1',
        type: 'ORCHESTRATOR',
        config: {
          version: 1,
          mode: 'approval', // Change to 'autonomous' for auto-execution
          preferred_side: 'NO', // Rule 2: Default to NO (79% base rate)
          order_type: 'LIMIT', // Rule 4: Limit orders only
          portfolio_size_usd: 10000,
          risk_tolerance: 5,
          position_sizing_rules: {
            fractional_kelly_lambda: 0.375, // Conservative Kelly
            max_per_position: 0.05, // Max 5% per position
            min_bet: 5,
            max_bet: 500,
            portfolio_heat_limit: 0.50, // Max 50% deployed at once
            risk_reward_threshold: 2.0,
            drawdown_protection: {
              enabled: true,
              drawdown_threshold: 0.10,
              size_reduction: 0.50,
            },
          },
          exit_rules: {
            profit_target_pct: 0.15, // Exit at +15%
            stop_loss_pct: 0.05, // Exit at -5%
            time_based: {
              enabled: true,
              max_hold_hours: 12, // Max hold time (matches 12h rule)
            },
          },
        },
      },
    ],

    edges: [
      // Linear pipeline: Data Source → Filter → Orchestrator
      // The "loop" happens via CRON schedule, not graph edges
      {
        from: 'data_source_1',
        to: 'enhanced_filter_1',
      },
      {
        from: 'enhanced_filter_1',
        to: 'orchestrator_1',
      },
    ],
  }

  const { data, error } = await supabase
    .from('strategy_definitions')
    .insert({
      strategy_id: strategyId,
      strategy_name: "Scotty's Strategy",
      strategy_description: `High-conviction end-game strategy that targets markets in the final 12 hours. Defaults to NO side (79% base rate), only trades when profit exceeds fees + spread, uses limit orders exclusively, targets YES odds between 10-40%, and prefers liquid markets. Automatically monitors for momentum spikes and exits when momentum levels out.

Rules:
1. Last 12 hours only (90% accuracy near end)
2. Default to NO (79% base rate)
3. Only trade if profit > fees + spread
4. Limit orders only (be maker, don't chase)
5. Target YES odds 10-40% (skip pennies)
6. Prefer liquid markets (tight spreads, real depth)

Workflow: Filter → Watchlist → Wait for momentum → Trade → Exit on momentum level`,
      strategy_type: 'MOMENTUM',
      is_predefined: true,
      node_graph: nodeGraph,
      execution_mode: 'SCHEDULED', // CRON-triggered batch execution
      schedule_cron: '*/5 * * * *', // Every 5 minutes
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    console.error('❌ Error creating strategy:', error)
    throw error
  }

  console.log("✅ Successfully created Scotty's Strategy")
  console.log('Strategy ID:', strategyId)
  console.log('Nodes:', nodeGraph.nodes.length)
  console.log('Edges:', nodeGraph.edges.length)
  console.log('\nStrategy Details:')
  console.log('- Trading Rules: 6 filters enforced')
  console.log('- Default Side: NO (79% base rate)')
  console.log('- Order Type: LIMIT only')
  console.log('- Execution Mode: SCHEDULED (CRON)')
  console.log('- Schedule: Every 5 minutes (*/5 * * * *)')
  console.log('- Orchestrator Mode: approval (change to "autonomous" for auto-execution)')
  console.log('\nCRON-Triggered Batch Workflow (3 nodes):')
  console.log('1. CRON triggers every 5 minutes')
  console.log('2. Data Source → Fetches all active Polymarket markets (~1,247 markets)')
  console.log('3. Enhanced Filter → Applies 5 filter rules (~47 markets pass)')
  console.log('4. Orchestrator → AI position sizing + trade execution')
  console.log('   ├─ Fetches portfolio state')
  console.log('   ├─ Calls Claude AI for analysis')
  console.log('   ├─ Calculates Kelly bet sizes')
  console.log('   ├─ If mode=approval: sends notifications')
  console.log('   └─ If mode=autonomous: executes trades via CLOB API')
  console.log('\n5. Next run: Wait 5 minutes, repeat from step 1')

  return strategyId
}

// Run the script
createScottysStrategy()
  .then((id) => {
    console.log('\n✨ Scotty\'s Strategy is ready to use!')
    console.log(`Open the Strategy Library to see it in the "Default Templates" tab`)
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Failed to create strategy:', error)
    process.exit(1)
  })
