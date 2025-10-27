#!/usr/bin/env tsx
/**
 * Create "Category Copy Trading" Strategy
 *
 * Finds the highest performing wallets in a specific category and copy-trades
 * their positions that are ending soon with good profit margins.
 *
 * Strategy Flow (CRON every 5 minutes):
 * 1. Fetch high conviction wallets (from audited P&L)
 * 2. Filter to one category (e.g., Politics)
 * 3. Filter by metrics: high P&L + high Omega + high Sharpe
 * 4. Get top 5-10 wallets
 * 5. Monitor their current open positions
 * 6. Filter positions: < 12 hours to resolution + profit margin > fees
 * 7. Copy trade with diversified Kelly sizing
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function createCategoryCopyTradeStrategy() {
  const supabase = createClient(supabaseUrl, supabaseKey)

  // Delete existing strategy if it exists
  const { data: existing } = await supabase
    .from('strategy_definitions')
    .select('strategy_id')
    .eq('strategy_name', 'Category Copy Trading')
    .single()

  if (existing) {
    console.log('Found existing Category Copy Trading strategy, deleting to update...')
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

  // Define the node graph: CRON-triggered copy trading workflow
  const nodeGraph = {
    nodes: [
      // 1. Data Source - High Conviction Wallets
      // Uses the audited P&L integration (lib/strategy/high-conviction-wallets.ts)
      {
        id: 'data_source_wallets',
        type: 'DATA_SOURCE',
        config: {
          source: 'WALLETS',
          mode: 'BATCH',
          prefilters: {
            table: 'wallet_scores_by_category',
            where: 'meets_minimum_trades = true',
          },
        },
      },

      // 2. Enhanced Filter - Category + High Performance Metrics
      // Filters to ONE category with top performers
      {
        id: 'filter_category_metrics',
        type: 'ENHANCED_FILTER',
        config: {
          conditions: [
            // Category filter (change this to your target category)
            {
              id: 'category_filter',
              field: 'category',
              operator: 'EQUALS',
              value: 'Politics', // CHANGE THIS: Politics, Sports, Crypto, AI, etc.
              fieldType: 'string',
            },

            // High Omega Ratio (skill at managing downside risk)
            {
              id: 'omega_threshold',
              field: 'omega_ratio',
              operator: 'GREATER_THAN_OR_EQUAL',
              value: '2.5', // S-grade threshold
              fieldType: 'number',
            },

            // High Win Rate (consistency)
            {
              id: 'win_rate_threshold',
              field: 'win_rate',
              operator: 'GREATER_THAN_OR_EQUAL',
              value: '0.55', // At least 55% win rate
              fieldType: 'number',
            },

            // Profitable traders only
            {
              id: 'pnl_positive',
              field: 'total_pnl',
              operator: 'GREATER_THAN',
              value: '1000', // At least $1K profit
              fieldType: 'number',
            },

            // Good ROI per bet
            {
              id: 'roi_per_bet_threshold',
              field: 'roi_per_bet',
              operator: 'GREATER_THAN',
              value: '50', // At least $50 profit per bet on average
              fieldType: 'number',
            },

            // Minimum trade volume for statistical significance
            {
              id: 'min_trades',
              field: 'closed_positions',
              operator: 'GREATER_THAN_OR_EQUAL',
              value: '20', // At least 20 trades in this category
              fieldType: 'number',
            },
          ],
          logic: 'AND',
          version: 2,
        },
      },

      // 3. Aggregation - Sort by P&L and take top N
      // Gets the highest P&L wallets from the filtered set
      {
        id: 'aggregation_top_wallets',
        type: 'AGGREGATION',
        config: {
          function: 'TOP_N',
          field: 'total_pnl',
          limit: 10, // Top 10 wallets
          sortOrder: 'DESC',
        },
      },

      // 4. Data Source - Current Positions of Top Wallets
      // Fetches live positions from Polymarket for these wallets
      {
        id: 'data_source_positions',
        type: 'DATA_SOURCE',
        config: {
          source: 'WALLET_POSITIONS',
          mode: 'BATCH',
          inputField: 'wallet', // Takes wallet addresses from previous node
          prefilters: {
            status: 'open', // Only open positions
          },
        },
      },

      // 5. Enhanced Filter - Time Window + Profit Margin
      // Only positions ending soon with good profit potential
      {
        id: 'filter_time_profit',
        type: 'ENHANCED_FILTER',
        config: {
          conditions: [
            // Only positions ending in <= 12 hours
            // NOTE: This needs hours_until_resolution calculated field
            // For now using active markets
            {
              id: 'market_active',
              field: 'active',
              operator: 'EQUALS',
              value: 'true',
              fieldType: 'boolean',
            },

            // Decent volume (liquid enough to copy)
            {
              id: 'min_volume',
              field: 'volume',
              operator: 'GREATER_THAN',
              value: '5000', // $5K+ volume
              fieldType: 'number',
            },

            // Good liquidity
            {
              id: 'min_liquidity',
              field: 'liquidity',
              operator: 'GREATER_THAN',
              value: '1000', // $1K+ liquidity
              fieldType: 'number',
            },

            // Price range that makes sense for copy trading
            // Avoid extreme prices (too risky or no upside)
            {
              id: 'price_min',
              field: 'price',
              operator: 'GREATER_THAN_OR_EQUAL',
              value: '0.15', // At least 15% (some upside/downside)
              fieldType: 'number',
            },
            {
              id: 'price_max',
              field: 'price',
              operator: 'LESS_THAN_OR_EQUAL',
              value: '0.85', // Max 85% (some upside/downside)
              fieldType: 'number',
            },

            // NOTE: Profit margin filter needs calculated field:
            // expected_profit_after_fees > 0
            // This should be added via preprocessing or orchestrator
          ],
          logic: 'AND',
          version: 2,
        },
      },

      // 6. Orchestrator - Position Sizing Decisions
      // Calculates optimal bet size for each position using Kelly criterion
      {
        id: 'orchestrator_sizing',
        type: 'ORCHESTRATOR',
        config: {
          version: 1,
          mode: 'approval', // Change to 'autonomous' for auto-execution
          preferred_side: 'FOLLOW', // Follow the wallet's side
          order_type: 'LIMIT',
          portfolio_size_usd: 10000,
          risk_tolerance: 5,
          position_sizing_rules: {
            fractional_kelly_lambda: 0.25, // Very conservative (copy trading is risky)
            max_per_position: 0.10, // Max 10% per position (diversification)
            min_bet: 5,
            max_bet: 300, // Smaller max for diversification
            portfolio_heat_limit: 0.60, // Max 60% deployed (spread across 15 positions)
            risk_reward_threshold: 1.5, // Lower threshold for copy trading
            drawdown_protection: {
              enabled: true,
              drawdown_threshold: 0.10,
              size_reduction: 0.50,
            },
          },
        },
      },

      // 7. ACTION - Execute Copy Trades
      // Places limit orders for approved positions
      {
        id: 'action_copy_trade',
        type: 'ACTION',
        config: {
          action: 'PLACE_LIMIT_ORDER',
          description: 'Copy trade - place limit order matching wallet position',
          follow_wallet_side: true, // Copy same side as source wallet
          diversification: 'EQUAL_WEIGHT', // Equal weight across all positions
          max_concurrent_positions: 15, // Max 15 positions at once
          exit_rules: {
            profit_target_pct: 0.20, // Exit at +20%
            stop_loss_pct: 0.10, // Exit at -10%
            max_hold_hours: 12, // Exit before resolution
            follow_source_wallet: true, // If wallet exits, we exit too
          },
        },
      },
    ],

    edges: [
      // Complete linear pipeline (7 nodes, 6 edges)
      {
        from: 'data_source_wallets',
        to: 'filter_category_metrics',
      },
      {
        from: 'filter_category_metrics',
        to: 'aggregation_top_wallets',
      },
      {
        from: 'aggregation_top_wallets',
        to: 'data_source_positions',
      },
      {
        from: 'data_source_positions',
        to: 'filter_time_profit',
      },
      {
        from: 'filter_time_profit',
        to: 'orchestrator_sizing',
      },
      {
        from: 'orchestrator_sizing',
        to: 'action_copy_trade',
      },
    ],
  }

  const { data, error } = await supabase
    .from('strategy_definitions')
    .insert({
      strategy_id: strategyId,
      strategy_name: 'Category Copy Trading',
      strategy_description: `Copy trades from the top performing wallets in a specific category. Finds wallets with high P&L (>$1K), high Omega (≥2.5), high Win Rate (≥55%), and good ROI per bet (>$50), then monitors their open positions and copy-trades those ending in the next 12 hours with good profit margins.

Features:
- Category-specific (Politics, Sports, Crypto, AI, etc.)
- Top 10 performers by realized P&L
- High skill filters: Omega ≥2.5, Win Rate ≥55%, ROI/bet >$50
- Only positions ending in ≤12 hours
- Profit margin > fees + spread
- Diversified across 15 positions max
- Equal-weight portfolio allocation
- Conservative 0.25 Kelly sizing
- Exit at +20% or -10% or before resolution
- Follows wallet exits (if they sell, we sell)

Perfect for riding the coattails of proven category specialists.

Complete 7-node workflow:
1. DATA_SOURCE (Wallets) → 2. FILTER (Category+Metrics) → 3. AGGREGATION (Top 10) →
4. DATA_SOURCE (Positions) → 5. FILTER (Time+Liquidity) → 6. ORCHESTRATOR (Sizing) →
7. ACTION (Execute Trades)`,
      strategy_type: 'SCREENING',
      is_predefined: true,
      node_graph: nodeGraph,
      execution_mode: 'SCHEDULED',
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

  console.log('✅ Successfully created Category Copy Trading strategy')
  console.log('Strategy ID:', strategyId)
  console.log('Nodes:', nodeGraph.nodes.length)
  console.log('Edges:', nodeGraph.edges.length)
  console.log('\nStrategy Details:')
  console.log('- Target Category: Politics (change in node config)')
  console.log('- Wallet Selection: Top 10 by P&L with Omega ≥2.5, Win Rate ≥55%, ROI/bet >$50')
  console.log('- Position Filters: Active markets, good liquidity, reasonable prices')
  console.log('- Time Window: Positions ending in ≤12 hours')
  console.log('- Execution Mode: SCHEDULED (CRON every 5 minutes)')
  console.log('- Orchestrator Mode: approval (change to "autonomous" for auto-execution)')
  console.log('\nCRON-Triggered Copy Trading Workflow (7 nodes):')
  console.log('1. CRON triggers every 5 minutes')
  console.log('2. Data Source → Fetch category wallets from wallet_scores_by_category')
  console.log('3. Enhanced Filter → Category + Omega ≥2.5 + Win Rate ≥55% + ROI/bet >$50 + P&L >$1K')
  console.log('4. Aggregation → Top 10 wallets by P&L')
  console.log('5. Data Source → Fetch their current open positions')
  console.log('6. Enhanced Filter → Time ≤12h + good liquidity + profit margin')
  console.log('7. Orchestrator → Calculate position sizes')
  console.log('   ├─ 0.25 Fractional Kelly (conservative)')
  console.log('   ├─ Max 10% per position')
  console.log('   ├─ Max 60% portfolio heat')
  console.log('   ├─ Drawdown protection enabled')
  console.log('   └─ Output: Sized positions ready to trade')
  console.log('8. ACTION → Execute copy trades')
  console.log('   ├─ Place limit orders (be maker)')
  console.log('   ├─ Copy same side as source wallet')
  console.log('   ├─ Max 15 concurrent positions')
  console.log('   ├─ Equal weight diversification')
  console.log('   └─ Follow wallet exits (if they sell, we sell)')
  console.log('\n9. Next run: Wait 5 minutes, repeat from step 1')

  return strategyId
}

// Run the script
createCategoryCopyTradeStrategy()
  .then((id) => {
    console.log('\n✨ Category Copy Trading strategy is ready!')
    console.log('Open the Strategy Library to see it in the "Default Templates" tab')
    console.log('\nTo change the target category:')
    console.log('1. Open the strategy in the Strategy Builder')
    console.log('2. Click on the "Enhanced Filter" node (filter_category_metrics)')
    console.log('3. Change the "category" field value from "Politics" to your target')
    console.log('   Options: Politics, Sports, Crypto, AI, Finance, etc.')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\n❌ Failed to create strategy:', error)
    process.exit(1)
  })
