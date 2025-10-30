#!/usr/bin/env tsx
/**
 * COPY TRADING MODE 3: TOP PERFORMER ONLY
 *
 * Strategy: Only copy trades from the #1 ranked wallet (highest Omega)
 * Use Case: Follow the absolute best performer
 *
 * Flow: DATA_SOURCE → WALLET_FILTER → ADD_TO_WATCHLIST → ORCHESTRATOR → ACTION
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function createTopPerformerStrategy() {
  const supabase = createClient(supabaseUrl, supabaseKey)

  const { data: existing } = await supabase
    .from('strategy_definitions')
    .select('strategy_id')
    .eq('strategy_name', 'Copy Trading - Top Performer (Politics)')
    .single()

  if (existing) {
    console.log('Found existing Top Performer strategy, updating...')
    await supabase
      .from('strategy_definitions')
      .delete()
      .eq('strategy_id', existing.strategy_id)
    console.log('✅ Deleted old strategy')
  }

  const strategyId = crypto.randomUUID()

  const nodeGraph = {
    nodes: [
      {
        id: 'data_source_wallets',
        type: 'DATA_SOURCE',
        config: {
          source: 'WALLETS',
          mode: 'BATCH',
          table: 'wallet_metrics_complete',
        },
      },

      // Filter to get top 1 wallet only
      {
        id: 'filter_top_performer',
        type: 'WALLET_FILTER',
        config: {
          filter_type: 'WALLET_FILTER',
          categories: ['politics'],
          conditions: [
            { metric: 'omega', operator: 'top_percent', value: '10' },
            { metric: 'trades_30d', operator: '>=', value: '10' },
          ],
          sorting: {
            primary: 'omega DESC',
            secondary: 'win_rate_30d DESC',
            tertiary: 'pnl_30d DESC',
          },
          limit: 1, // Only top 1 wallet
        },
      },

      {
        id: 'add_wallets_to_watchlist',
        type: 'add-to-watchlist',
        config: {
          reason: 'Mirror trades from the #1 top-performing politics wallet',
        },
      },

      {
        id: 'orchestrator_top_performer',
        type: 'ORCHESTRATOR',
        config: {
          version: 1,
          mode: 'approval',
          portfolio_size_usd: 10000,
          risk_tolerance: 5,

          position_sizing_rules: {
            fractional_kelly_lambda: 0.5, // More aggressive Kelly for single wallet
            max_per_position: 0.10, // Higher limit since we trust this wallet
            min_bet: 10,
            max_bet: 1000, // Higher max for top performer
            portfolio_heat_limit: 0.60, // Can deploy more capital
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

          copy_trading: {
            enabled: true,
            mode: 'TOP_PERFORMER',
            poll_interval_seconds: 60,
            max_latency_seconds: 120,

            mode_config: {
              weight_metric: 'omega', // Rank by Omega
            },

            detection: {
              monitor_new_positions: true,
              monitor_position_increases: true,
              monitor_exits: true, // Also copy exits from top performer
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
      { from: 'data_source_wallets', to: 'filter_top_performer' },
      { from: 'filter_top_performer', to: 'add_wallets_to_watchlist' },
      { from: 'add_wallets_to_watchlist', to: 'orchestrator_top_performer' },
      { from: 'orchestrator_top_performer', to: 'action_execute_trades' },
    ],
  }

  const { data, error } = await supabase
    .from('strategy_definitions')
    .insert({
      strategy_id: strategyId,
      strategy_name: 'Copy Trading - Top Performer (Politics)',
      strategy_description: `**MODE 3: TOP PERFORMER ONLY**

Mirror EVERY trade from the #1 top-performing politics wallet.

**Strategy**: Follow the absolute best performer
**Trade Frequency**: Medium (10-30 positions)
**Diversification**: None (single wallet)
**Best For**: Risk-takers who believe in following the leader

**Wallet Selection** (Top 1 Wallet Only):
• #1 Highest Omega (best risk-adjusted returns)
• Minimum Activity: 10+ trades in last 30 days
• Category: Politics only

**Copy Trading Logic**:
✅ Copy ALL trades from the #1 ranked wallet
✅ Also copies EXIT signals (unique to this mode)
✅ More aggressive position sizing (0.5 fractional Kelly)
✅ Higher per-position limit (10% vs 5%)
✅ Higher max bet ($1000 vs $500)

**Position Sizing**:
• Aggressive Kelly (0.5 fractional) - more conviction
• Max 10% per position (vs 5% for other modes)
• Max 60% portfolio deployed
• $10-$1000 bet range
• Drawdown protection enabled

**Pros**:
✅ Follow the best of the best
✅ Simplest strategy to understand
✅ Full conviction in top performer
✅ Copies both entries AND exits

**Cons**:
⚠️ No diversification - single point of failure
⚠️ High risk if top performer hits bad streak
⚠️ No consensus validation

**Perfect For**:
• Risk-takers comfortable with concentration
• Those who believe in star performers
• Traders wanting simplicity over diversification`,
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

  console.log('✅ Successfully created Top Performer strategy!')
  console.log('═'.repeat(70))
  console.log('📊 STRATEGY: TOP PERFORMER ONLY')
  console.log('═'.repeat(70))
  console.log(`Strategy ID: ${strategyId}`)
  console.log(`Mode: TOP_PERFORMER`)
  console.log(`Wallets: 1 (the absolute best)`)
  console.log(`Copy Logic: Mirror ALL trades from #1 wallet`)
  console.log(`Expected Positions: 10-30`)
  console.log(`Diversification: None`)
  console.log('')

  return strategyId
}

createTopPerformerStrategy()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Failed:', error)
    process.exit(1)
  })
