#!/usr/bin/env tsx
/**
 * COPY TRADING MODE 6: HYBRID MODE
 *
 * Strategy: Combine top performer mirroring + consensus for others
 * - Top 10 wallets: Copy all their trades
 * - Wallets 11-50: Only copy when 2+ agree (consensus)
 *
 * Use Case: Best of both worlds - mirror elite + follow consensus
 *
 * Flow: DATA_SOURCE → WALLET_FILTER → ADD_TO_WATCHLIST → ORCHESTRATOR → ACTION
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function createHybridStrategy() {
  const supabase = createClient(supabaseUrl, supabaseKey)

  const { data: existing } = await supabase
    .from('strategy_definitions')
    .select('strategy_id')
    .eq('strategy_name', 'Copy Trading - Hybrid (Politics)')
    .single()

  if (existing) {
    console.log('Found existing Hybrid strategy, updating...')
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
          reason: 'Hybrid copying: Top 10 = mirror all, Others = 2+ consensus',
        },
      },

      {
        id: 'orchestrator_hybrid',
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
            mode: 'HYBRID',
            poll_interval_seconds: 60,
            max_latency_seconds: 120,

            mode_config: {
              hybrid_rules: {
                top_n_copy_all: 10,          // Copy all trades from top 10
                others_consensus_min: 2,     // Need 2+ wallets to agree for others
              },
              owrr_thresholds: {
                min_yes: 0.65,  // OWRR ≥ 0.65 for consensus trades
                min_no: 0.60,   // OWRR ≥ 0.60 for NO consensus
                min_confidence: 'medium',
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
      { from: 'add_wallets_to_watchlist', to: 'orchestrator_hybrid' },
      { from: 'orchestrator_hybrid', to: 'action_execute_trades' },
    ],
  }

  const { data, error } = await supabase
    .from('strategy_definitions')
    .insert({
      strategy_id: strategyId,
      strategy_name: 'Copy Trading - Hybrid (Politics)',
      strategy_description: `**MODE 6: HYBRID MODE**

Best of both worlds: Mirror top 10 elite performers + copy consensus from others.

**Strategy**: Flexible hybrid approach
**Trade Frequency**: High (60-100 positions)
**Diversification**: Balanced
**Best For**: Flexible traders who want both solo alpha and consensus validation

**Wallet Selection** (Top 50 Politics Wallets):
• Omega: Top 10%
• Win Rate: Top 20%
• Minimum Activity: 10+ trades in last 30 days
• Category: Politics only

**Hybrid Copy Logic**:

**Path 1: Top 10 Elite Mirroring**
\`\`\`
if (wallet_rank <= 10) {
  COPY immediately (no consensus needed)
  Position size: 1.0x Kelly
}
\`\`\`

**Path 2: Consensus from Others**
\`\`\`
if (wallet_rank > 10 && owrr >= 0.65) {
  COPY when 2+ wallets agree
  Position size: 0.75x Kelly
}
\`\`\`

**Decision Flow**:
1. ANY trade from top 10 → Copy immediately
2. OR any trade where 2+ wallets (from 11-50) agree → Copy
3. Could have overlapping positions (both paths trigger on same market)

**Position Sizing**:
• Conservative Kelly (0.25 fractional)
• Top 10 trades: 1.0x multiplier
• Consensus trades: 0.75x multiplier
• Max 5% per position
• Max 50% portfolio deployed
• $10-$500 bet range

**Example Scenarios**:

**Scenario 1**: Wallet #3 buys YES on "Trump wins"
→ COPY immediately (top 10 elite)

**Scenario 2**: Wallets #15, #22, #38 all buy YES on "Biden withdraws"
→ COPY (consensus OWRR ≥ 0.65)

**Scenario 3**: Wallet #5 buys YES AND Wallets #20, #30 buy YES on same market
→ COPY TWICE (both paths trigger, but "ignore_if_already_holding" prevents duplicate)

**Pros**:
✅ Captures solo alpha from top performers
✅ Also captures broader consensus
✅ Flexible and adaptive
✅ Best of both worlds

**Cons**:
⚠️ Could have overlapping signals
⚠️ More complex to understand
⚠️ Need to handle duplicate prevention

**Perfect For**:
• Flexible traders who want maximum opportunities
• Those comfortable with hybrid logic
• Traders seeking both quality and consensus`,
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

  console.log('✅ Successfully created Hybrid strategy!')
  console.log('═'.repeat(70))
  console.log('📊 STRATEGY: HYBRID MODE')
  console.log('═'.repeat(70))
  console.log(`Strategy ID: ${strategyId}`)
  console.log(`Mode: HYBRID`)
  console.log(`Path 1: Top 10 = Copy all (1.0x Kelly)`)
  console.log(`Path 2: Others = 2+ consensus (0.75x Kelly)`)
  console.log(`Expected Positions: 60-100`)
  console.log(`Diversification: Balanced`)
  console.log('')

  return strategyId
}

createHybridStrategy()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Failed:', error)
    process.exit(1)
  })
