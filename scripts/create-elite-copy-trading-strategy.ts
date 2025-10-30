#!/usr/bin/env tsx
/**
 * CREATE ELITE COPY TRADING STRATEGY
 *
 * Production-ready copy trading strategy using the new advanced wallet filtering.
 * This creates a complete, deployable strategy that demonstrates the full workflow.
 *
 * Strategy: Find elite politics wallets and copy their trades when 2+ agree
 *
 * Flow: DATA_SOURCE (elite wallets) → ORCHESTRATOR (copy trading) → ACTION (execute)
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function createEliteCopyTradingStrategy() {
  const supabase = createClient(supabaseUrl, supabaseKey)

  // Delete existing strategy if it exists
  const { data: existing } = await supabase
    .from('strategy_definitions')
    .select('strategy_id')
    .eq('strategy_name', 'Copy Trading - Consensus Only (Politics)')
    .single()

  if (existing) {
    console.log('Found existing Consensus Only strategy, updating...')
    await supabase
      .from('strategy_definitions')
      .delete()
      .eq('strategy_id', existing.strategy_id)
    console.log('✅ Deleted old strategy')
  }

  const strategyId = crypto.randomUUID()

  /**
   * NODE GRAPH
   * ===========
   *
   * 1. DATA_SOURCE: Get all wallets from ClickHouse
   * 2. WALLET_FILTER: Filter to elite politics wallets using percentile filtering
   * 3. ADD_TO_WATCHLIST: Save filtered wallets to strategy watchlist
   * 4. ORCHESTRATOR: Activate copy trading monitoring mode
   * 5. ACTION: Execute copy trades on Polymarket (triggered by WalletMonitor)
   *
   * COPY TRADING FLOW:
   * - DATA_SOURCE provides all wallets from ClickHouse
   * - WALLET_FILTER applies elite criteria → outputs 50 elite politics wallets
   * - ADD_TO_WATCHLIST saves wallets to strategy_watchlist_items table
   * - ORCHESTRATOR activates copy trading mode (updates copy_trading_config)
   * - [BACKGROUND] WalletMonitor cron polls every 30 seconds for new trades
   * - [BACKGROUND] When 2+ wallets enter same position (OWRR ≥ 0.65), trigger copy trade
   * - ACTION executes the copy trade with Kelly position sizing
   */
  const nodeGraph = {
    nodes: [
      // 1. DATA_SOURCE - All Wallets
      {
        id: 'data_source_wallets',
        type: 'DATA_SOURCE',
        config: {
          source: 'WALLETS',
          mode: 'BATCH', // BATCH mode for one-time wallet selection
          table: 'wallet_metrics_complete',
        },
      },

      // 2. WALLET_FILTER - Elite Politics Wallet Filter
      {
        id: 'filter_elite_politics',
        type: 'WALLET_FILTER',
        config: {
          filter_type: 'WALLET_FILTER',

          // Multi-select categories
          categories: ['politics'],

          // Performance conditions using percentile filtering
          conditions: [
            {
              metric: 'omega',
              operator: 'top_percent',
              value: '10', // Top 10% by Omega
            },
            {
              metric: 'win_rate_30d',
              operator: 'top_percent',
              value: '20', // Top 20% by Win Rate
            },
            {
              metric: 'trades_30d',
              operator: '>=',
              value: '10', // At least 10 trades for statistical significance
            },
          ],

          // Multi-sort priority
          sorting: {
            primary: 'omega DESC',
            secondary: 'win_rate_30d DESC',
            tertiary: 'pnl_30d DESC',
          },

          limit: 50, // Top 50 elite wallets
        },
      },

      // 3. ADD_TO_WATCHLIST - Save Wallets to Watchlist
      {
        id: 'add_wallets_to_watchlist',
        type: 'add-to-watchlist',
        config: {
          reason: 'Monitor for consensus copy trading signals when 2+ wallets agree on same position (OWRR ≥ 0.65)',
        },
      },

      // 4. ORCHESTRATOR - Copy Trading Engine
      {
        id: 'orchestrator_copy_trading',
        type: 'ORCHESTRATOR',
        config: {
          version: 1,
          mode: 'approval', // Set to 'autonomous' for auto-execution
          portfolio_size_usd: 10000,
          risk_tolerance: 5,

          // Position sizing rules (Kelly criterion)
          position_sizing_rules: {
            fractional_kelly_lambda: 0.25, // Conservative Kelly
            max_per_position: 0.05, // Max 5% per position
            min_bet: 10,
            max_bet: 500,
            portfolio_heat_limit: 0.50, // Max 50% deployed
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

          // COPY TRADING CONFIGURATION
          copy_trading: {
            enabled: true,
            mode: 'CONSENSUS_ONLY',
            monitor_wallets_from: 'filter_elite_politics', // Monitor wallets from FILTER node
            poll_interval_seconds: 60, // Scan for new trades every 60 seconds
            max_latency_seconds: 120, // Only copy trades less than 2 minutes old

            // When to trigger a copy trade
            owrr_thresholds: {
              min_yes: 0.65, // OWRR ≥ 0.65 = 2+ wallets agreeing on YES
              min_no: 0.60,  // OWRR ≥ 0.60 = 2+ wallets agreeing on NO
              min_confidence: 'medium', // At least 3 qualified wallets must have traded
            },

            // Trade freshness
            max_latency_seconds: 120, // Only copy trades less than 2 minutes old

            // Trade detection
            detection: {
              monitor_new_positions: true, // Watch when wallets enter new positions
              monitor_position_increases: true, // Watch when wallets add to positions
              monitor_exits: false, // Don't copy exits (optional)
              grouping_window_seconds: 300, // Group trades within 5 minute window for OWRR
            },

            // Copy behavior
            copy_behavior: {
              copy_exact_outcome: true, // Copy the same YES/NO outcome
              copy_exact_market: true, // Copy the exact same market
              ignore_if_already_holding: true, // Skip if we already have this position
            },
          },
        },
      },

      // 5. ACTION - Execute Trades (Triggered by WalletMonitor)
      {
        id: 'action_execute_trades',
        type: 'ACTION',
        config: {
          action: 'EXECUTE_TRADE',
          description: 'Execute copy trades on Polymarket (triggered by WalletMonitor background process)',
        },
      },
    ],

    edges: [
      {
        from: 'data_source_wallets',
        to: 'filter_elite_politics',
      },
      {
        from: 'filter_elite_politics',
        to: 'add_wallets_to_watchlist',
      },
      {
        from: 'add_wallets_to_watchlist',
        to: 'orchestrator_copy_trading',
      },
      {
        from: 'orchestrator_copy_trading',
        to: 'action_execute_trades',
      },
    ],
  }

  const { data, error } = await supabase
    .from('strategy_definitions')
    .insert({
      strategy_id: strategyId,
      strategy_name: 'Copy Trading - Consensus Only (Politics)',
      strategy_description: `Production-ready copy trading strategy for elite politics wallets.

**Strategy Overview:**
Find the top 50 politics wallets who are in the elite 10% by Omega ratio AND top 20% by Win Rate, then automatically copy their trades when 2+ wallets agree on the same position.

**Wallet Selection Criteria:**
• Category: Politics only
• Omega: Top 10% (elite risk-adjusted returns)
• Win Rate: Top 20% (consistent profitability)
• Minimum Activity: 10+ trades in last 30 days
• Sorted by: Omega → Win Rate → P&L

**Copy Trading Workflow (5 Nodes):**
1. **DATA_SOURCE**: Fetches 10,000 wallets from ClickHouse
2. **WALLET_FILTER**: Filters to top 50 elite politics wallets
3. **ADD_TO_WATCHLIST**: Saves wallets to strategy watchlist
4. **ORCHESTRATOR**: Activates copy trading monitoring mode
5. **ACTION**: Executes trades (triggered by background WalletMonitor)

**Background Monitoring (WalletMonitor Cron - Every 30s):**
1. Polls ClickHouse for new trades from watchlist wallets
2. Groups trades within 5-minute windows and calculates OWRR
3. When OWRR ≥ 0.65 (2+ wallets agree), triggers copy trade

**Copy Trading Logic:**
• Monitors new positions and position increases (not exits)
• OWRR ≥ 0.65 = 2+ wallets agree on YES (smart money consensus)
• OWRR ≥ 0.60 = 2+ wallets agree on NO
• Only copies trades less than 2 minutes old (low latency)
• Minimum confidence: Medium (3+ qualified wallets must have traded)
• Copies exact outcome (YES/NO) on exact market
• Skips if already holding position

**Position Sizing:**
• Conservative Kelly (0.25 fractional)
• Max 5% per position
• Max 50% portfolio deployed
• $10-$500 bet range
• Drawdown protection enabled

**Trading Mode:**
• Default: Paper trading (safe testing)
• Can switch to Live trading after validation
• Requires Polymarket API key for live execution

**Perfect For:**
• Following elite political prediction traders
• Riding smart money consensus signals
• Automated copy trading with risk management`,
      strategy_type: 'SCREENING',
      is_predefined: true,
      node_graph: nodeGraph,
      execution_mode: 'SCHEDULED',
      schedule_cron: '*/1 * * * *', // Run every minute for copy trading
      is_active: false, // User must deploy it
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    console.error('❌ Error creating strategy:', error)
    throw error
  }

  console.log('✅ Successfully created Elite Copy Trading strategy!')
  console.log('═'.repeat(70))
  console.log('')
  console.log('📊 STRATEGY DETAILS')
  console.log('═'.repeat(70))
  console.log(`Strategy ID: ${strategyId}`)
  console.log(`Name: Elite Copy Trading - Politics`)
  console.log(`Type: COPY_TRADING`)
  console.log(`Nodes: ${nodeGraph.nodes.length} (DATA_SOURCE → ORCHESTRATOR → ACTION)`)
  console.log(`Edges: ${nodeGraph.edges.length}`)
  console.log('')
  console.log('🎯 WALLET SELECTION')
  console.log('─'.repeat(70))
  console.log('• Categories: Politics')
  console.log('• Omega: Top 10%')
  console.log('• Win Rate: Top 20%')
  console.log('• Minimum Trades: 10+')
  console.log('• Result: Top 50 elite wallets')
  console.log('')
  console.log('🤖 COPY TRADING ENGINE')
  console.log('─'.repeat(70))
  console.log('• Poll Interval: 60 seconds')
  console.log('• OWRR Threshold: ≥0.65 (2+ wallets agree)')
  console.log('• Max Latency: 120 seconds')
  console.log('• Confidence: Medium (3+ qualified wallets)')
  console.log('')
  console.log('💰 POSITION SIZING')
  console.log('─'.repeat(70))
  console.log('• Kelly Fraction: 0.25 (conservative)')
  console.log('• Max Per Position: 5%')
  console.log('• Portfolio Heat: Max 50%')
  console.log('• Bet Range: $10 - $500')
  console.log('• Drawdown Protection: Enabled (10% threshold)')
  console.log('')
  console.log('🚀 NEXT STEPS')
  console.log('═'.repeat(70))
  console.log('1. Open Strategy Builder')
  console.log('2. Load "Elite Copy Trading - Politics" from Library')
  console.log('3. Review the node configuration:')
  console.log('   • DATA_SOURCE: Elite wallet filters')
  console.log('   • ORCHESTRATOR: Copy trading settings')
  console.log('   • ACTION: Trade execution')
  console.log('4. Click "Deploy" and choose:')
  console.log('   • Paper Trading (recommended first)')
  console.log('   • Live Trading (requires Polymarket key)')
  console.log('5. Set ORCHESTRATOR mode:')
  console.log('   • "approval" = Review each trade')
  console.log('   • "autonomous" = Auto-execute')
  console.log('')
  console.log('✨ Strategy is ready to deploy!')
  console.log('')

  return strategyId
}

// Run the script
createEliteCopyTradingStrategy()
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Failed to create strategy:', error)
    process.exit(1)
  })
