#!/usr/bin/env tsx
/**
 * REBUILD ALL INVALID STRATEGIES
 *
 * Converts old parallel FILTER + LOGIC patterns to modern linear chains with:
 * - ENHANCED_FILTER (multi-condition with AND/OR logic)
 * - SCHEDULED execution (CRON-based)
 * - ORCHESTRATOR for position sizing
 * - Proper trading workflows
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

async function rebuildBalancedHybrid() {
  const supabase = createClient(supabaseUrl, supabaseKey)

  const strategyName = 'Balanced Hybrid'
  console.log(`\n🔨 Rebuilding: ${strategyName}`)

  // Get existing strategy
  const { data: existing } = await supabase
    .from('strategy_definitions')
    .select('strategy_id')
    .eq('strategy_name', strategyName)
    .single()

  if (!existing) {
    console.log('❌ Strategy not found')
    return
  }

  // New linear workflow: DATA_SOURCE → ENHANCED_FILTER → AGGREGATION → ORCHESTRATOR
  const nodeGraph = {
    nodes: [
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
      {
        id: 'filter_balanced',
        type: 'ENHANCED_FILTER',
        config: {
          conditions: [
            // Activity: active traders
            {
              id: 'activity',
              field: 'total_positions',
              operator: 'GREATER_THAN_OR_EQUAL',
              value: '30',
              fieldType: 'number',
            },
            // Significance: statistical relevance
            {
              id: 'significance',
              field: 'closed_positions',
              operator: 'GREATER_THAN_OR_EQUAL',
              value: '20',
              fieldType: 'number',
            },
            // Quality: profitable
            {
              id: 'quality',
              field: 'total_pnl',
              operator: 'GREATER_THAN',
              value: '500',
              fieldType: 'number',
            },
            // Risk: good Omega ratio
            {
              id: 'risk',
              field: 'omega_ratio',
              operator: 'GREATER_THAN_OR_EQUAL',
              value: '2.0',
              fieldType: 'number',
            },
            // Balanced: decent win rate
            {
              id: 'win_rate',
              field: 'win_rate',
              operator: 'GREATER_THAN_OR_EQUAL',
              value: '0.50',
              fieldType: 'number',
            },
          ],
          logic: 'AND',
          version: 2,
        },
      },
      {
        id: 'aggregation_top_balanced',
        type: 'AGGREGATION',
        config: {
          function: 'TOP_N',
          field: 'total_pnl',
          limit: 15,
          sortOrder: 'DESC',
        },
      },
      {
        id: 'orchestrator_balanced',
        type: 'ORCHESTRATOR',
        config: {
          version: 1,
          mode: 'approval',
          preferred_side: 'FOLLOW',
          order_type: 'LIMIT',
          portfolio_size_usd: 10000,
          risk_tolerance: 5,
          position_sizing_rules: {
            fractional_kelly_lambda: 0.30,
            max_per_position: 0.08,
            min_bet: 5,
            max_bet: 400,
            portfolio_heat_limit: 0.65,
            risk_reward_threshold: 1.5,
            drawdown_protection: {
              enabled: true,
              drawdown_threshold: 0.10,
              size_reduction: 0.50,
            },
          },
        },
      },
    ],
    edges: [
      { from: 'data_source_wallets', to: 'filter_balanced' },
      { from: 'filter_balanced', to: 'aggregation_top_balanced' },
      { from: 'aggregation_top_balanced', to: 'orchestrator_balanced' },
    ],
  }

  const { error } = await supabase
    .from('strategy_definitions')
    .update({
      node_graph: nodeGraph,
      execution_mode: 'SCHEDULED',
      schedule_cron: '*/15 * * * *', // Every 15 minutes
      strategy_description: `Balanced hybrid approach combining multiple performance metrics.

Finds wallets with:
- Active trading (30+ positions)
- Statistical significance (20+ closed trades)
- Proven profitability ($500+ P&L)
- Good risk management (Omega ≥2.0)
- Consistent performance (50%+ win rate)

Top 15 wallets by P&L with balanced risk/reward positioning.

Linear 4-node workflow: DATA_SOURCE → ENHANCED_FILTER → AGGREGATION → ORCHESTRATOR`,
      updated_at: new Date().toISOString(),
    })
    .eq('strategy_id', existing.strategy_id)

  if (error) {
    console.log('❌ Error:', error)
  } else {
    console.log('✅ Rebuilt successfully')
  }
}

async function rebuildMomentumRider() {
  const supabase = createClient(supabaseUrl, supabaseKey)

  const strategyName = 'Momentum Rider'
  console.log(`\n🔨 Rebuilding: ${strategyName}`)

  const { data: existing } = await supabase
    .from('strategy_definitions')
    .select('strategy_id')
    .eq('strategy_name', strategyName)
    .single()

  if (!existing) {
    console.log('❌ Strategy not found')
    return
  }

  const nodeGraph = {
    nodes: [
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
      {
        id: 'filter_momentum',
        type: 'ENHANCED_FILTER',
        config: {
          conditions: [
            // Activity
            {
              id: 'activity',
              field: 'total_positions',
              operator: 'GREATER_THAN_OR_EQUAL',
              value: '30',
              fieldType: 'number',
            },
            // Statistical significance
            {
              id: 'significance',
              field: 'closed_positions',
              operator: 'GREATER_THAN_OR_EQUAL',
              value: '20',
              fieldType: 'number',
            },
            // Trending up: positive Omega momentum
            {
              id: 'omega_momentum',
              field: 'omega_momentum',
              operator: 'GREATER_THAN',
              value: '0',
              fieldType: 'number',
            },
            // High base Omega
            {
              id: 'omega_base',
              field: 'omega_ratio',
              operator: 'GREATER_THAN_OR_EQUAL',
              value: '2.0',
              fieldType: 'number',
            },
            // Profitable
            {
              id: 'profitable',
              field: 'total_pnl',
              operator: 'GREATER_THAN',
              value: '500',
              fieldType: 'number',
            },
          ],
          logic: 'AND',
          version: 2,
        },
      },
      {
        id: 'aggregation_hot_hand',
        type: 'AGGREGATION',
        config: {
          function: 'TOP_N',
          field: 'omega_momentum',
          limit: 12,
          sortOrder: 'DESC',
        },
      },
      {
        id: 'orchestrator_momentum',
        type: 'ORCHESTRATOR',
        config: {
          version: 1,
          mode: 'approval',
          preferred_side: 'FOLLOW',
          order_type: 'LIMIT',
          portfolio_size_usd: 10000,
          risk_tolerance: 7,
          position_sizing_rules: {
            fractional_kelly_lambda: 0.35,
            max_per_position: 0.10,
            min_bet: 5,
            max_bet: 500,
            portfolio_heat_limit: 0.70,
            risk_reward_threshold: 1.3,
            drawdown_protection: {
              enabled: true,
              drawdown_threshold: 0.15,
              size_reduction: 0.50,
            },
          },
        },
      },
    ],
    edges: [
      { from: 'data_source_wallets', to: 'filter_momentum' },
      { from: 'filter_momentum', to: 'aggregation_hot_hand' },
      { from: 'aggregation_hot_hand', to: 'orchestrator_momentum' },
    ],
  }

  const { error } = await supabase
    .from('strategy_definitions')
    .update({
      node_graph: nodeGraph,
      execution_mode: 'SCHEDULED',
      schedule_cron: '*/10 * * * *', // Every 10 minutes (momentum changes fast)
      strategy_description: `Ride the hot hand - find wallets with improving momentum.

Finds wallets with:
- Active trading (30+ positions)
- Statistical significance (20+ closed trades)
- Positive Omega momentum (trending up)
- Strong base Omega (≥2.0)
- Proven profitability ($500+ P&L)

Top 12 wallets by Omega momentum with aggressive sizing.

Linear 4-node workflow: DATA_SOURCE → ENHANCED_FILTER → AGGREGATION → ORCHESTRATOR`,
      updated_at: new Date().toISOString(),
    })
    .eq('strategy_id', existing.strategy_id)

  if (error) {
    console.log('❌ Error:', error)
  } else {
    console.log('✅ Rebuilt successfully')
  }
}

async function rebuildAllStrategies() {
  console.log('🔄 Rebuilding all invalid strategies...\n')

  await rebuildBalancedHybrid()
  await rebuildMomentumRider()
  // TODO: Add other strategies

  console.log('\n✅ Rebuild complete!')
}

rebuildAllStrategies()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error)
    process.exit(1)
  })
