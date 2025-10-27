#!/usr/bin/env tsx
/**
 * REBUILD ALL 8 INVALID STRATEGIES
 *
 * Converts old parallel FILTER + LOGIC patterns to modern linear chains:
 * - ENHANCED_FILTER (multi-condition with AND/OR)
 * - SCHEDULED execution (CRON)
 * - ORCHESTRATOR for position sizing
 * - Linear workflows (no fan-out/fan-in complexity)
 *
 * Keeps all field names as-is (they'll be available in future migrations)
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

const strategies = [
  {
    name: 'Aggressive Growth',
    description: `Maximize capital growth by finding the most profitable, asymmetric, and fast-moving traders.

Filters for:
- Active traders (3+ bets/week)
- Statistical significance (25+ closed positions)
- Low deposit manipulation (<20%)
- Elite skill (Omega ≥3.0)
- Copy-able (Omega lag 30s ≥2.0)
- Asymmetric returns (tail ratio ≥3.0)

Top performers by EV per hour with aggressive sizing.`,
    cron: '*/10 * * * *',
    nodeGraph: {
      nodes: [
        {
          id: 'data_source_wallets',
          type: 'DATA_SOURCE',
          config: {
            source: 'WALLETS',
            mode: 'BATCH',
            prefilters: {
              table: 'wallet_metrics_complete',
              where: 'closed_positions >= 25',
            },
          },
        },
        {
          id: 'filter_aggressive',
          type: 'ENHANCED_FILTER',
          config: {
            conditions: [
              {
                id: 'activity',
                field: 'bets_per_week',
                operator: 'GREATER_THAN',
                value: '3',
                fieldType: 'number',
              },
              {
                id: 'significance',
                field: 'closed_positions',
                operator: 'GREATER_THAN',
                value: '25',
                fieldType: 'number',
              },
              {
                id: 'integrity',
                field: 'deposit_driven_pnl',
                operator: 'LESS_THAN',
                value: '0.2',
                fieldType: 'number',
              },
              {
                id: 'quality',
                field: 'omega_ratio',
                operator: 'GREATER_THAN',
                value: '3.0',
                fieldType: 'number',
              },
              {
                id: 'copyability',
                field: 'omega_lag_30s',
                operator: 'GREATER_THAN',
                value: '2.0',
                fieldType: 'number',
              },
              {
                id: 'asymmetry',
                field: 'tail_ratio',
                operator: 'GREATER_THAN',
                value: '3.0',
                fieldType: 'number',
              },
            ],
            logic: 'AND',
            version: 2,
          },
        },
        {
          id: 'aggregation_top_ev',
          type: 'AGGREGATION',
          config: {
            function: 'TOP_N',
            field: 'ev_per_hour_capital',
            limit: 10,
            sortOrder: 'DESC',
          },
        },
        {
          id: 'orchestrator_aggressive',
          type: 'ORCHESTRATOR',
          config: {
            version: 1,
            mode: 'approval',
            preferred_side: 'FOLLOW',
            order_type: 'LIMIT',
            portfolio_size_usd: 10000,
            risk_tolerance: 8,
            position_sizing_rules: {
              fractional_kelly_lambda: 0.40,
              max_per_position: 0.12,
              min_bet: 10,
              max_bet: 600,
              portfolio_heat_limit: 0.75,
              risk_reward_threshold: 1.2,
              drawdown_protection: {
                enabled: true,
                drawdown_threshold: 0.15,
                size_reduction: 0.40,
              },
            },
          },
        },
      ],
      edges: [
        { from: 'data_source_wallets', to: 'filter_aggressive' },
        { from: 'filter_aggressive', to: 'aggregation_top_ev' },
        { from: 'aggregation_top_ev', to: 'orchestrator_aggressive' },
      ],
    },
  },
  {
    name: 'Balanced Hybrid',
    description: `Find the most profitable traders who also pass strong competency and risk-management tests.

Filters for:
- Active trading (30+ positions)
- Statistical significance (20+ closed trades)
- Proven profitability ($500+ P&L)
- Good risk management (Omega ≥2.0)
- Consistent performance (50%+ win rate)

Top 15 wallets by P&L with balanced risk/reward positioning.`,
    cron: '*/15 * * * *',
    nodeGraph: {
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
              {
                id: 'activity',
                field: 'total_positions',
                operator: 'GREATER_THAN_OR_EQUAL',
                value: '30',
                fieldType: 'number',
              },
              {
                id: 'significance',
                field: 'closed_positions',
                operator: 'GREATER_THAN_OR_EQUAL',
                value: '20',
                fieldType: 'number',
              },
              {
                id: 'quality',
                field: 'total_pnl',
                operator: 'GREATER_THAN',
                value: '500',
                fieldType: 'number',
              },
              {
                id: 'risk',
                field: 'omega_ratio',
                operator: 'GREATER_THAN_OR_EQUAL',
                value: '2.0',
                fieldType: 'number',
              },
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
    },
  },
  {
    name: 'Eggman Hunter (AI Specialist)',
    description: `Find the next "Eggman" in AI category by identifying true forecasting skill.

Filters for:
- AI category specialists
- 10+ closed positions in AI
- Low calibration error (<0.1)
- Copy-able (Omega lag 2min ≥3.0)
- Positive execution skill (CLV lag 0s >0)

Top performers by category EV per hour.`,
    cron: '*/20 * * * *',
    nodeGraph: {
      nodes: [
        {
          id: 'data_source_category',
          type: 'DATA_SOURCE',
          config: {
            source: 'WALLETS',
            mode: 'BATCH',
            prefilters: {
              table: 'wallet_metrics_by_category',
              where: 'closed_positions >= 10',
            },
          },
        },
        {
          id: 'filter_ai_specialist',
          type: 'ENHANCED_FILTER',
          config: {
            conditions: [
              {
                id: 'ai_category',
                field: 'category',
                operator: 'EQUALS',
                value: 'AI',
                fieldType: 'string',
              },
              {
                id: 'specialization',
                field: 'closed_positions',
                operator: 'GREATER_THAN',
                value: '10',
                fieldType: 'number',
              },
              {
                id: 'true_skill',
                field: 'calibration_error',
                operator: 'LESS_THAN',
                value: '0.1',
                fieldType: 'number',
              },
              {
                id: 'copyability',
                field: 'omega_lag_2min',
                operator: 'GREATER_THAN',
                value: '3.0',
                fieldType: 'number',
              },
              {
                id: 'execution_skill',
                field: 'clv_lag_0s',
                operator: 'GREATER_THAN',
                value: '0',
                fieldType: 'number',
              },
            ],
            logic: 'AND',
            version: 2,
          },
        },
        {
          id: 'aggregation_top_ai',
          type: 'AGGREGATION',
          config: {
            function: 'TOP_N',
            field: 'ev_per_hour_category',
            limit: 8,
            sortOrder: 'DESC',
          },
        },
        {
          id: 'orchestrator_eggman',
          type: 'ORCHESTRATOR',
          config: {
            version: 1,
            mode: 'approval',
            preferred_side: 'FOLLOW',
            order_type: 'LIMIT',
            portfolio_size_usd: 10000,
            risk_tolerance: 6,
            position_sizing_rules: {
              fractional_kelly_lambda: 0.35,
              max_per_position: 0.10,
              min_bet: 10,
              max_bet: 500,
              portfolio_heat_limit: 0.70,
              risk_reward_threshold: 1.4,
              drawdown_protection: {
                enabled: true,
                drawdown_threshold: 0.12,
                size_reduction: 0.50,
              },
            },
          },
        },
      ],
      edges: [
        { from: 'data_source_category', to: 'filter_ai_specialist' },
        { from: 'filter_ai_specialist', to: 'aggregation_top_ai' },
        { from: 'aggregation_top_ai', to: 'orchestrator_eggman' },
      ],
    },
  },
  {
    name: 'Safe & Steady',
    description: `Find the most consistent, lowest-risk compounding wallets.

Filters for:
- Very active (5+ bets/week)
- High significance (100+ closed positions)
- Limited drawdown (max -20%)
- Fast recovery (< 30% time in drawdown)

Top performers by Sortino ratio (downside-focused risk metric).`,
    cron: '*/30 * * * *',
    nodeGraph: {
      nodes: [
        {
          id: 'data_source_wallets',
          type: 'DATA_SOURCE',
          config: {
            source: 'WALLETS',
            mode: 'BATCH',
            prefilters: {
              table: 'wallet_metrics_complete',
              where: 'closed_positions >= 100',
            },
          },
        },
        {
          id: 'filter_safe',
          type: 'ENHANCED_FILTER',
          config: {
            conditions: [
              {
                id: 'activity',
                field: 'bets_per_week',
                operator: 'GREATER_THAN',
                value: '5',
                fieldType: 'number',
              },
              {
                id: 'significance',
                field: 'closed_positions',
                operator: 'GREATER_THAN',
                value: '100',
                fieldType: 'number',
              },
              {
                id: 'drawdown_guard',
                field: 'max_drawdown',
                operator: 'GREATER_THAN',
                value: '-0.2',
                fieldType: 'number',
              },
              {
                id: 'recovery_speed',
                field: 'time_in_drawdown_pct',
                operator: 'LESS_THAN',
                value: '0.3',
                fieldType: 'number',
              },
            ],
            logic: 'AND',
            version: 2,
          },
        },
        {
          id: 'aggregation_top_sortino',
          type: 'AGGREGATION',
          config: {
            function: 'TOP_N',
            field: 'sortino_ratio',
            limit: 12,
            sortOrder: 'DESC',
          },
        },
        {
          id: 'orchestrator_safe',
          type: 'ORCHESTRATOR',
          config: {
            version: 1,
            mode: 'approval',
            preferred_side: 'FOLLOW',
            order_type: 'LIMIT',
            portfolio_size_usd: 10000,
            risk_tolerance: 3,
            position_sizing_rules: {
              fractional_kelly_lambda: 0.25,
              max_per_position: 0.06,
              min_bet: 5,
              max_bet: 300,
              portfolio_heat_limit: 0.50,
              risk_reward_threshold: 1.8,
              drawdown_protection: {
                enabled: true,
                drawdown_threshold: 0.08,
                size_reduction: 0.60,
              },
            },
          },
        },
      ],
      edges: [
        { from: 'data_source_wallets', to: 'filter_safe' },
        { from: 'filter_safe', to: 'aggregation_top_sortino' },
        { from: 'aggregation_top_sortino', to: 'orchestrator_safe' },
      ],
    },
  },
  {
    name: 'Momentum Rider',
    description: `Ride the hot hand - find wallets with improving momentum.

Filters for:
- Active trading (30+ positions)
- Statistical significance (20+ closed trades)
- Positive Omega momentum (trending up)
- Strong base Omega (≥2.0)
- Proven profitability ($500+ P&L)

Top 12 wallets by Omega momentum with aggressive sizing.`,
    cron: '*/10 * * * *',
    nodeGraph: {
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
              {
                id: 'activity',
                field: 'total_positions',
                operator: 'GREATER_THAN_OR_EQUAL',
                value: '30',
                fieldType: 'number',
              },
              {
                id: 'significance',
                field: 'closed_positions',
                operator: 'GREATER_THAN_OR_EQUAL',
                value: '20',
                fieldType: 'number',
              },
              {
                id: 'omega_momentum',
                field: 'omega_momentum',
                operator: 'GREATER_THAN',
                value: '0',
                fieldType: 'number',
              },
              {
                id: 'omega_base',
                field: 'omega_ratio',
                operator: 'GREATER_THAN_OR_EQUAL',
                value: '2.0',
                fieldType: 'number',
              },
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
    },
  },
  {
    name: 'Fortress',
    description: `Maximum capital preservation with slow, steady compounding.

Filters for:
- Very high significance (150+ closed positions)
- Minimal drawdown (< -15%)
- Excellent recovery (< 20% time in drawdown)
- Conservative Calmar ratio (≥1.5)

Top performers by Calmar ratio (return/max drawdown).`,
    cron: '0 */6 * * *', // Every 6 hours (conservative strategy)
    nodeGraph: {
      nodes: [
        {
          id: 'data_source_wallets',
          type: 'DATA_SOURCE',
          config: {
            source: 'WALLETS',
            mode: 'BATCH',
            prefilters: {
              table: 'wallet_metrics_complete',
              where: 'closed_positions >= 150',
            },
          },
        },
        {
          id: 'filter_fortress',
          type: 'ENHANCED_FILTER',
          config: {
            conditions: [
              {
                id: 'significance',
                field: 'closed_positions',
                operator: 'GREATER_THAN',
                value: '150',
                fieldType: 'number',
              },
              {
                id: 'minimal_drawdown',
                field: 'max_drawdown',
                operator: 'GREATER_THAN',
                value: '-0.15',
                fieldType: 'number',
              },
              {
                id: 'fast_recovery',
                field: 'time_in_drawdown_pct',
                operator: 'LESS_THAN',
                value: '0.2',
                fieldType: 'number',
              },
              {
                id: 'calmar_quality',
                field: 'calmar_ratio',
                operator: 'GREATER_THAN',
                value: '1.5',
                fieldType: 'number',
              },
            ],
            logic: 'AND',
            version: 2,
          },
        },
        {
          id: 'aggregation_top_calmar',
          type: 'AGGREGATION',
          config: {
            function: 'TOP_N',
            field: 'calmar_ratio',
            limit: 10,
            sortOrder: 'DESC',
          },
        },
        {
          id: 'orchestrator_fortress',
          type: 'ORCHESTRATOR',
          config: {
            version: 1,
            mode: 'approval',
            preferred_side: 'FOLLOW',
            order_type: 'LIMIT',
            portfolio_size_usd: 10000,
            risk_tolerance: 2,
            position_sizing_rules: {
              fractional_kelly_lambda: 0.20,
              max_per_position: 0.05,
              min_bet: 5,
              max_bet: 250,
              portfolio_heat_limit: 0.40,
              risk_reward_threshold: 2.0,
              drawdown_protection: {
                enabled: true,
                drawdown_threshold: 0.05,
                size_reduction: 0.70,
              },
            },
          },
        },
      ],
      edges: [
        { from: 'data_source_wallets', to: 'filter_fortress' },
        { from: 'filter_fortress', to: 'aggregation_top_calmar' },
        { from: 'aggregation_top_calmar', to: 'orchestrator_fortress' },
      ],
    },
  },
  {
    name: 'Rising Star',
    description: `Find emerging talent before they're discovered.

Filters for:
- Moderate significance (30-100 closed positions)
- High recent performance (30d ROI ≥20%)
- Improving skill (positive momentum)
- Already profitable ($200+ P&L)

Top performers by recent ROI with moderate risk.`,
    cron: '*/20 * * * *',
    nodeGraph: {
      nodes: [
        {
          id: 'data_source_wallets',
          type: 'DATA_SOURCE',
          config: {
            source: 'WALLETS',
            mode: 'BATCH',
            prefilters: {
              table: 'wallet_metrics_complete',
              where: 'closed_positions >= 30',
            },
          },
        },
        {
          id: 'filter_rising_star',
          type: 'ENHANCED_FILTER',
          config: {
            conditions: [
              {
                id: 'emerging_range',
                field: 'closed_positions',
                operator: 'GREATER_THAN_OR_EQUAL',
                value: '30',
                fieldType: 'number',
              },
              {
                id: 'not_too_established',
                field: 'closed_positions',
                operator: 'LESS_THAN_OR_EQUAL',
                value: '100',
                fieldType: 'number',
              },
              {
                id: 'recent_performance',
                field: 'roi_30d',
                operator: 'GREATER_THAN_OR_EQUAL',
                value: '0.2',
                fieldType: 'number',
              },
              {
                id: 'improving',
                field: 'omega_momentum_30d',
                operator: 'GREATER_THAN',
                value: '0',
                fieldType: 'number',
              },
              {
                id: 'already_profitable',
                field: 'total_pnl',
                operator: 'GREATER_THAN',
                value: '200',
                fieldType: 'number',
              },
            ],
            logic: 'AND',
            version: 2,
          },
        },
        {
          id: 'aggregation_top_roi',
          type: 'AGGREGATION',
          config: {
            function: 'TOP_N',
            field: 'roi_30d',
            limit: 10,
            sortOrder: 'DESC',
          },
        },
        {
          id: 'orchestrator_rising_star',
          type: 'ORCHESTRATOR',
          config: {
            version: 1,
            mode: 'approval',
            preferred_side: 'FOLLOW',
            order_type: 'LIMIT',
            portfolio_size_usd: 10000,
            risk_tolerance: 6,
            position_sizing_rules: {
              fractional_kelly_lambda: 0.30,
              max_per_position: 0.08,
              min_bet: 5,
              max_bet: 400,
              portfolio_heat_limit: 0.60,
              risk_reward_threshold: 1.5,
              drawdown_protection: {
                enabled: true,
                drawdown_threshold: 0.12,
                size_reduction: 0.50,
              },
            },
          },
        },
      ],
      edges: [
        { from: 'data_source_wallets', to: 'filter_rising_star' },
        { from: 'filter_rising_star', to: 'aggregation_top_roi' },
        { from: 'aggregation_top_roi', to: 'orchestrator_rising_star' },
      ],
    },
  },
  {
    name: 'Alpha Decay Detector',
    description: `Identify wallets with declining edge before the crowd notices.

Filters for:
- Previously strong (100+ closed positions)
- Negative momentum (declining Omega)
- Declining CLV (execution getting worse)
- Use for inverse/fade signals or portfolio rebalancing

Sorted by most negative momentum (biggest declines).`,
    cron: '0 */4 * * *', // Every 4 hours (monitoring strategy)
    nodeGraph: {
      nodes: [
        {
          id: 'data_source_wallets',
          type: 'DATA_SOURCE',
          config: {
            source: 'WALLETS',
            mode: 'BATCH',
            prefilters: {
              table: 'wallet_metrics_complete',
              where: 'closed_positions >= 100',
            },
          },
        },
        {
          id: 'filter_alpha_decay',
          type: 'ENHANCED_FILTER',
          config: {
            conditions: [
              {
                id: 'significance',
                field: 'closed_positions',
                operator: 'GREATER_THAN',
                value: '100',
                fieldType: 'number',
              },
              {
                id: 'declining_omega',
                field: 'omega_momentum_30d',
                operator: 'LESS_THAN',
                value: '0',
                fieldType: 'number',
              },
              {
                id: 'declining_clv',
                field: 'clv_momentum_30d',
                operator: 'LESS_THAN',
                value: '0',
                fieldType: 'number',
              },
              {
                id: 'was_good',
                field: 'omega_ratio',
                operator: 'GREATER_THAN',
                value: '1.5',
                fieldType: 'number',
              },
            ],
            logic: 'AND',
            version: 2,
          },
        },
        {
          id: 'aggregation_worst_momentum',
          type: 'AGGREGATION',
          config: {
            function: 'TOP_N',
            field: 'combined_momentum_z',
            limit: 10,
            sortOrder: 'ASC', // Lowest = most negative = biggest decline
          },
        },
        {
          id: 'orchestrator_alpha_decay',
          type: 'ORCHESTRATOR',
          config: {
            version: 1,
            mode: 'approval',
            preferred_side: 'OPPOSITE', // Fade these wallets
            order_type: 'LIMIT',
            portfolio_size_usd: 10000,
            risk_tolerance: 4,
            position_sizing_rules: {
              fractional_kelly_lambda: 0.25,
              max_per_position: 0.06,
              min_bet: 5,
              max_bet: 300,
              portfolio_heat_limit: 0.50,
              risk_reward_threshold: 1.6,
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
        { from: 'data_source_wallets', to: 'filter_alpha_decay' },
        { from: 'filter_alpha_decay', to: 'aggregation_worst_momentum' },
        { from: 'aggregation_worst_momentum', to: 'orchestrator_alpha_decay' },
      ],
    },
  },
]

async function rebuildAllStrategies() {
  const supabase = createClient(supabaseUrl, supabaseKey)

  console.log('🔄 Rebuilding all 8 invalid strategies with modern linear workflows...\n')

  let successCount = 0
  let errorCount = 0

  for (const strategy of strategies) {
    console.log(`\n🔨 Rebuilding: ${strategy.name}`)

    // Get existing strategy
    const { data: existing } = await supabase
      .from('strategy_definitions')
      .select('strategy_id')
      .eq('strategy_name', strategy.name)
      .single()

    if (!existing) {
      console.log(`   ❌ Strategy not found in database`)
      errorCount++
      continue
    }

    // Update with new linear workflow
    const { error } = await supabase
      .from('strategy_definitions')
      .update({
        node_graph: strategy.nodeGraph,
        execution_mode: 'SCHEDULED',
        schedule_cron: strategy.cron,
        strategy_description: strategy.description,
        updated_at: new Date().toISOString(),
      })
      .eq('strategy_id', existing.strategy_id)

    if (error) {
      console.log(`   ❌ Error:`, error.message)
      errorCount++
    } else {
      console.log(`   ✅ Success - ${strategy.nodeGraph.nodes.length} nodes, ${strategy.nodeGraph.edges.length} edges, CRON: ${strategy.cron}`)
      successCount++
    }
  }

  console.log(`\n${'='.repeat(80)}`)
  console.log(`\n📊 REBUILD SUMMARY`)
  console.log(`   ✅ Success: ${successCount}/${strategies.length}`)
  console.log(`   ❌ Errors: ${errorCount}/${strategies.length}`)
  console.log(`\n✨ All strategies now use:`)
  console.log(`   - Linear workflows (DATA_SOURCE → ENHANCED_FILTER → AGGREGATION → ORCHESTRATOR)`)
  console.log(`   - SCHEDULED execution with CRON`)
  console.log(`   - Modern ENHANCED_FILTER (no more FILTER + LOGIC fan-out)`)
  console.log(`   - ORCHESTRATOR for position sizing\n`)
}

rebuildAllStrategies()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error)
    process.exit(1)
  })
