#!/usr/bin/env tsx
/**
 * COPY TRADING MODE 5: TIER-BASED COPYING
 *
 * Strategy: Different rules for different performance tiers
 * - Tier 1 (Top 10): Copy all their trades
 * - Tier 2 (11-30): Copy when 2+ agree
 * - Tier 3 (31-50): Copy when 3+ agree
 *
 * Use Case: Hierarchical trust - top wallets get more flexibility
 *
 * Flow: DATA_SOURCE → WALLET_FILTER → ADD_TO_WATCHLIST → ORCHESTRATOR → ACTION
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function createTierBasedStrategy() {
  const supabase = createClient(supabaseUrl, supabaseKey)

  const { data: existing } = await supabase
    .from('strategy_definitions')
    .select('strategy_id')
    .eq('strategy_name', 'Copy Trading - Tier-Based (Politics)')
    .single()

  if (existing) {
    console.log('Found existing Tier-Based strategy, updating...')
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
          reason: 'Tier-based copying: Top 10 = copy all, 11-30 = 2+ consensus, 31-50 = 3+ consensus',
        },
      },

      {
        id: 'orchestrator_tier_based',
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
            mode: 'TIER_BASED',
            poll_interval_seconds: 60,
            max_latency_seconds: 120,

            mode_config: {
              tiers: {
                tier1: { size: 10, rule: 'copy_all' },      // Top 10: Copy all trades
                tier2: { size: 20, rule: 'consensus' },     // 11-30: Need 2+ to agree
                tier3: { size: 20, rule: 'consensus' },     // 31-50: Need 3+ to agree
              },
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
      { from: 'add_wallets_to_watchlist', to: 'orchestrator_tier_based' },
      { from: 'orchestrator_tier_based', to: 'action_execute_trades' },
    ],
  }

  const { data, error } = await supabase
    .from('strategy_definitions')
    .insert({
      strategy_id: strategyId,
      strategy_name: 'Copy Trading - Tier-Based (Politics)',
      strategy_description: `**MODE 5: TIER-BASED COPYING**

Hierarchical copy trading with different rules for different performance tiers.

**Strategy**: Respect quality hierarchy
**Trade Frequency**: High (50-100 positions)
**Diversification**: Balanced
**Best For**: Strategic allocators who want structured diversification

**Wallet Selection** (Top 50 Politics Wallets):
• Omega: Top 10%
• Win Rate: Top 20%
• Minimum Activity: 10+ trades in last 30 days
• Category: Politics only

**Tier Structure**:

**Tier 1 (Wallets #1-10)**: Elite Performers
• Copy ALL trades immediately
• No consensus needed
• Full trust in top 10 performers
• Position size: 1.0x Kelly

**Tier 2 (Wallets #11-30)**: Strong Performers
• Copy when 2+ wallets agree (OWRR ≥ 0.65)
• Consensus validation required
• Position size: 0.75x Kelly

**Tier 3 (Wallets #31-50)**: Good Performers
• Copy when 3+ wallets agree (OWRR ≥ 0.70)
• Stronger consensus needed
• Position size: 0.5x Kelly

**Copy Trading Logic**:
\`\`\`
if (wallet_rank <= 10) {
  COPY immediately
} else if (wallet_rank <= 30 && consensus >= 2) {
  COPY with 75% position size
} else if (wallet_rank <= 50 && consensus >= 3) {
  COPY with 50% position size
}
\`\`\`

**Position Sizing**:
• Conservative Kelly (0.25 fractional)
• Tier-based multipliers (1.0x, 0.75x, 0.5x)
• Max 5% per position
• Max 50% portfolio deployed
• $10-$500 bet range

**Pros**:
✅ Balanced approach respecting quality
✅ Reduces noise from lower-tier wallets
✅ Captures solo alpha from top performers
✅ Consensus validation for others

**Cons**:
⚠️ Complex multi-tier logic
⚠️ Need to define tier cutoffs
⚠️ Requires understanding of tiers

**Perfect For**:
• Strategic allocators
• Those who want structured diversification
• Traders comfortable with hierarchical systems`,
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

  console.log('✅ Successfully created Tier-Based strategy!')
  console.log('═'.repeat(70))
  console.log('📊 STRATEGY: TIER-BASED COPYING')
  console.log('═'.repeat(70))
  console.log(`Strategy ID: ${strategyId}`)
  console.log(`Mode: TIER_BASED`)
  console.log(`Tier 1 (1-10): Copy all trades (1.0x Kelly)`)
  console.log(`Tier 2 (11-30): 2+ consensus (0.75x Kelly)`)
  console.log(`Tier 3 (31-50): 3+ consensus (0.5x Kelly)`)
  console.log(`Expected Positions: 50-100`)
  console.log(`Diversification: Balanced with hierarchy`)
  console.log('')

  return strategyId
}

createTierBasedStrategy()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Failed:', error)
    process.exit(1)
  })
