#!/usr/bin/env tsx
/**
 * COPY TRADING MODE 1: MIRROR ALL TRADES
 *
 * Strategy: Copy EVERY trade from ALL 50 elite politics wallets
 * Use Case: Maximum diversification across elite wallet activity
 *
 * Flow: DATA_SOURCE → WALLET_FILTER → ADD_TO_WATCHLIST → ORCHESTRATOR → ACTION
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function createMirrorAllStrategy() {
  const supabase = createClient(supabaseUrl, supabaseKey)

  // Delete existing strategy if it exists
  const { data: existing } = await supabase
    .from('strategy_definitions')
    .select('strategy_id')
    .eq('strategy_name', 'Copy Trading - Mirror All (Politics)')
    .single()

  if (existing) {
    console.log('Found existing Mirror All strategy, updating...')
    await supabase
      .from('strategy_definitions')
      .delete()
      .eq('strategy_id', existing.strategy_id)
    console.log('✅ Deleted old strategy')
  }

  const strategyId = crypto.randomUUID()

  const nodeGraph = {
    nodes: [
      // 1. DATA_SOURCE - All Wallets
      {
        id: 'data_source_wallets',
        type: 'DATA_SOURCE',
        config: {
          source: 'WALLETS',
          mode: 'BATCH',
          table: 'wallet_metrics_complete',
        },
      },

      // 2. WALLET_FILTER - Elite Politics Wallets
      {
        id: 'filter_elite_politics',
        type: 'WALLET_FILTER',
        config: {
          filter_type: 'WALLET_FILTER',
          categories: ['politics'],
          conditions: [
            { metric: 'omega', operator: 'top_percent', value: '10' },
            { metric: 'win_rate_30d', operator: 'top_percent', value: '20' },
            { metric: 'trades_30d', operator: '>=', value: '10' },
          ],
          sorting: {
            primary: 'omega DESC',
            secondary: 'win_rate_30d DESC',
            tertiary: 'pnl_30d DESC',
          },
          limit: 50,
        },
      },

      // 3. ADD_TO_WATCHLIST - Save Wallets
      {
        id: 'add_wallets_to_watchlist',
        type: 'add-to-watchlist',
        config: {
          reason: 'Mirror all trades from elite wallets for maximum diversification',
        },
      },

      // 4. ORCHESTRATOR - Mirror All Mode
      {
        id: 'orchestrator_mirror_all',
        type: 'ORCHESTRATOR',
        config: {
          version: 1,
          mode: 'approval',
          portfolio_size_usd: 10000,
          risk_tolerance: 5,

          position_sizing_rules: {
            fractional_kelly_lambda: 0.25,
            max_per_position: 0.05,
            min_bet: 10,
            max_bet: 500,
            portfolio_heat_limit: 0.50,
            risk_reward_threshold: 2.0,
            drawdown_protection: {
              enabled: true,
              drawdown_threshold: 0.10,
              size_reduction: 0.50,
            },
            volatility_adjustment: {
              enabled: false,
            },
          },

          // MIRROR ALL MODE CONFIGURATION
          copy_trading: {
            enabled: true,
            mode: 'MIRROR_ALL',
            poll_interval_seconds: 60,
            max_latency_seconds: 120,

            mode_config: {
              // No special config needed - copy everything
            },

            detection: {
              monitor_new_positions: true,
              monitor_position_increases: true,
              monitor_exits: false,
              grouping_window_seconds: 300,
            },

            copy_behavior: {
              copy_exact_outcome: true,
              copy_exact_market: true,
              ignore_if_already_holding: true,
            },
          },
        },
      },

      // 5. ACTION - Execute Trades
      {
        id: 'action_execute_trades',
        type: 'ACTION',
        config: {
          action: 'EXECUTE_TRADE',
          description: 'Execute copy trades on Polymarket',
        },
      },
    ],

    edges: [
      { from: 'data_source_wallets', to: 'filter_elite_politics' },
      { from: 'filter_elite_politics', to: 'add_wallets_to_watchlist' },
      { from: 'add_wallets_to_watchlist', to: 'orchestrator_mirror_all' },
      { from: 'orchestrator_mirror_all', to: 'action_execute_trades' },
    ],
  }

  const { data, error } = await supabase
    .from('strategy_definitions')
    .insert({
      strategy_id: strategyId,
      strategy_name: 'Copy Trading - Mirror All (Politics)',
      strategy_description: `**MODE 1: MIRROR ALL TRADES**

Copy EVERY trade from ALL 50 elite politics wallets for maximum diversification.

**Strategy**: Mirror all trades from elite performers
**Trade Frequency**: Very High (could be 100+ positions)
**Diversification**: Maximum
**Best For**: Passive followers who want broad exposure to elite wallet activity

**Wallet Selection** (Top 50 Politics Wallets):
• Omega: Top 10% (elite risk-adjusted returns)
• Win Rate: Top 20% (consistent profitability)
• Minimum Activity: 10+ trades in last 30 days
• Category: Politics only

**Copy Trading Logic**:
✅ Copy ALL trades from ANY of the 50 tracked wallets
✅ No consensus needed - every trade is copied
✅ Only copies trades less than 2 minutes old (low latency)
✅ Skips if already holding position
✅ Monitors new positions and position increases

**Position Sizing**:
• Conservative Kelly (0.25 fractional)
• Max 5% per position
• Max 50% portfolio deployed
• $10-$500 bet range
• Drawdown protection enabled

**Pros**:
✅ Capture all alpha from elite wallets
✅ Maximum diversification across opportunities
✅ Simple logic - no thresholds needed

**Cons**:
⚠️ Could have 100+ active positions
⚠️ Capital spread thin across many bets
⚠️ Higher transaction costs from frequent trading

**Perfect For**:
• Passive investors wanting broad elite exposure
• Those comfortable with many small positions
• Traders seeking maximum diversification`,
      strategy_type: 'SCREENING',
      is_predefined: true,
      node_graph: nodeGraph,
      execution_mode: 'SCHEDULED',
      schedule_cron: '*/1 * * * *',
      is_active: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    console.error('❌ Error creating strategy:', error)
    throw error
  }

  console.log('✅ Successfully created Mirror All strategy!')
  console.log('═'.repeat(70))
  console.log('')
  console.log('📊 STRATEGY: MIRROR ALL TRADES')
  console.log('═'.repeat(70))
  console.log(`Strategy ID: ${strategyId}`)
  console.log(`Mode: MIRROR_ALL`)
  console.log(`Wallets: 50 elite politics wallets`)
  console.log(`Copy Logic: Copy ALL trades from ANY wallet`)
  console.log(`Expected Positions: 50-150 (very high)`)
  console.log(`Diversification: Maximum`)
  console.log('')

  return strategyId
}

createMirrorAllStrategy()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Failed:', error)
    process.exit(1)
  })
