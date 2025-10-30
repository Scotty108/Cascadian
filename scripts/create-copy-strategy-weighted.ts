#!/usr/bin/env tsx
/**
 * COPY TRADING MODE 4: WEIGHTED PORTFOLIO
 *
 * Strategy: Copy all trades, but weight position size by wallet Omega
 * Use Case: Balanced approach respecting wallet quality
 *
 * Flow: DATA_SOURCE → WALLET_FILTER → ADD_TO_WATCHLIST → ORCHESTRATOR → ACTION
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function createWeightedStrategy() {
  const supabase = createClient(supabaseUrl, supabaseKey)

  const { data: existing } = await supabase
    .from('strategy_definitions')
    .select('strategy_id')
    .eq('strategy_name', 'Copy Trading - Weighted Portfolio (Politics)')
    .single()

  if (existing) {
    console.log('Found existing Weighted Portfolio strategy, updating...')
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

      {
        id: 'add_wallets_to_watchlist',
        type: 'add-to-watchlist',
        config: {
          reason: 'Copy all trades with position sizing weighted by wallet Omega',
        },
      },

      {
        id: 'orchestrator_weighted',
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

          copy_trading: {
            enabled: true,
            mode: 'WEIGHTED',
            poll_interval_seconds: 60,
            max_latency_seconds: 120,

            mode_config: {
              weight_metric: 'omega', // Weight position size by Omega
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
      { from: 'add_wallets_to_watchlist', to: 'orchestrator_weighted' },
      { from: 'orchestrator_weighted', to: 'action_execute_trades' },
    ],
  }

  const { data, error } = await supabase
    .from('strategy_definitions')
    .insert({
      strategy_id: strategyId,
      strategy_name: 'Copy Trading - Weighted Portfolio (Politics)',
      strategy_description: `**MODE 4: WEIGHTED PORTFOLIO**

Copy ALL trades from ALL 50 wallets, but weight position size by wallet performance (Omega).

**Strategy**: Balanced diversification with quality weighting
**Trade Frequency**: Very High (100+ positions)
**Diversification**: Maximum, but weighted
**Best For**: Sophisticated traders who want diversification with quality bias

**Wallet Selection** (Top 50 Politics Wallets):
• Omega: Top 10%
• Win Rate: Top 20%
• Minimum Activity: 10+ trades in last 30 days
• Category: Politics only

**Position Sizing Logic**:
\`\`\`
wallet_weight = wallet.omega / sum_of_all_omegas
position_size = base_kelly_size × wallet_weight × 2.0

Example:
- Wallet #1 (Omega 2.5): weight = 2.5/50 = 5% → position = $100 × 0.05 × 2 = $10
- Wallet #10 (Omega 1.8): weight = 1.8/50 = 3.6% → position = $100 × 0.036 × 2 = $7.20
- Wallet #50 (Omega 0.8): weight = 0.8/50 = 1.6% → position = $100 × 0.016 × 2 = $3.20
\`\`\`

**Copy Trading Logic**:
✅ Copy ALL trades from ALL 50 wallets
✅ Higher Omega wallet = larger position size
✅ Automatically respects performer quality
✅ No consensus needed

**Position Sizing**:
• Conservative Kelly (0.25 fractional)
• Max 5% per position
• Max 50% portfolio deployed
• $10-$500 bet range
• Dynamic weighting by Omega

**Pros**:
✅ Capture all alpha opportunities
✅ Automatically favor better performers
✅ Balanced diversification
✅ Respects quality hierarchy

**Cons**:
⚠️ Very high number of positions (100+)
⚠️ Complex position sizing calculations
⚠️ Requires dynamic rebalancing
⚠️ Higher transaction costs

**Perfect For**:
• Sophisticated traders comfortable with complexity
• Those wanting diversification with quality bias
• Algorithmic trading enthusiasts`,
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

  console.log('✅ Successfully created Weighted Portfolio strategy!')
  console.log('═'.repeat(70))
  console.log('📊 STRATEGY: WEIGHTED PORTFOLIO')
  console.log('═'.repeat(70))
  console.log(`Strategy ID: ${strategyId}`)
  console.log(`Mode: WEIGHTED`)
  console.log(`Wallets: 50 elite wallets`)
  console.log(`Copy Logic: Copy ALL, weight by Omega`)
  console.log(`Expected Positions: 100-150`)
  console.log(`Diversification: Maximum + Quality Weighting`)
  console.log('')

  return strategyId
}

createWeightedStrategy()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Failed:', error)
    process.exit(1)
  })
