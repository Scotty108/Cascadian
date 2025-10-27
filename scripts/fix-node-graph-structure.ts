#!/usr/bin/env tsx
/**
 * Fix node graph structure - remove "data" wrapper and "position" fields
 * Apply the changes from migration 20251027000009
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const consensusCopyTradeNodeGraph = {
  "nodes": [
    {
      "id": "wallets_source",
      "type": "DATA_SOURCE",
      "config": {
        "source": "WALLETS",
        "mode": "BATCH",
        "prefilters": {
          "table": "wallet_scores",
          "where": "meets_minimum_trades = true"
        }
      }
    },
    {
      "id": "wallet_quality_filter",
      "type": "ENHANCED_FILTER",
      "config": {
        "conditions": [
          {
            "id": "cond_profitable",
            "field": "total_pnl",
            "operator": "GREATER_THAN",
            "value": 0,
            "fieldType": "number"
          },
          {
            "id": "cond_omega",
            "field": "omega_ratio",
            "operator": "GREATER_THAN_OR_EQUAL",
            "value": 2.0,
            "fieldType": "number"
          },
          {
            "id": "cond_positions",
            "field": "closed_positions",
            "operator": "GREATER_THAN_OR_EQUAL",
            "value": 20,
            "fieldType": "number"
          },
          {
            "id": "cond_winrate",
            "field": "win_rate",
            "operator": "GREATER_THAN_OR_EQUAL",
            "value": 0.55,
            "fieldType": "number"
          }
        ],
        "logic": "AND",
        "version": 2
      }
    },
    {
      "id": "top_wallets_aggregation",
      "type": "AGGREGATION",
      "config": {
        "function": "TOP_N",
        "field": "total_pnl",
        "limit": 20
      }
    },
    {
      "id": "consensus_signal",
      "type": "SIGNAL",
      "config": {
        "signalType": "ENTRY",
        "condition": "2+ wallets agree on same side, no conflicts",
        "direction": "NO",
        "strength": "STRONG"
      }
    },
    {
      "id": "orchestrator",
      "type": "ORCHESTRATOR",
      "config": {
        "version": 1,
        "mode": "approval",
        "portfolio_size_usd": 10000,
        "risk_tolerance": 5,
        "position_sizing_rules": {
          "fractional_kelly_lambda": 0.375,
          "max_per_position": 0.02,
          "min_bet": 10,
          "max_bet": 200,
          "portfolio_heat_limit": 0.30,
          "risk_reward_threshold": 2.0,
          "drawdown_protection": {
            "enabled": true,
            "drawdown_threshold": 0.10,
            "size_reduction": 0.50
          },
          "volatility_adjustment": {
            "enabled": false
          }
        }
      }
    }
  ],
  "edges": [
    {"from": "wallets_source", "to": "wallet_quality_filter"},
    {"from": "wallet_quality_filter", "to": "top_wallets_aggregation"},
    {"from": "top_wallets_aggregation", "to": "consensus_signal"},
    {"from": "consensus_signal", "to": "orchestrator"}
  ]
}

const smartMoneyImbalanceNodeGraph = {
  "nodes": [
    {
      "id": "markets_source",
      "type": "DATA_SOURCE",
      "config": {
        "source": "MARKETS",
        "mode": "BATCH",
        "prefilters": {
          "table": "markets_dim_seed",
          "where": "status = 'active'"
        }
      }
    },
    {
      "id": "market_filters",
      "type": "ENHANCED_FILTER",
      "config": {
        "conditions": [
          {
            "id": "cond_category",
            "field": "category",
            "operator": "EQUALS",
            "value": "US politics",
            "fieldType": "string"
          },
          {
            "id": "cond_time_max",
            "field": "hours_to_close",
            "operator": "LESS_THAN_OR_EQUAL",
            "value": 168,
            "fieldType": "number"
          },
          {
            "id": "cond_time_min",
            "field": "hours_to_close",
            "operator": "GREATER_THAN",
            "value": 1,
            "fieldType": "number"
          },
          {
            "id": "cond_liquidity",
            "field": "volume",
            "operator": "GREATER_THAN",
            "value": 1000,
            "fieldType": "number"
          },
          {
            "id": "cond_price_max",
            "field": "current_price_no",
            "operator": "LESS_THAN_OR_EQUAL",
            "value": 0.90,
            "fieldType": "number"
          },
          {
            "id": "cond_price_min",
            "field": "current_price_no",
            "operator": "GREATER_THAN_OR_EQUAL",
            "value": 0.05,
            "fieldType": "number"
          }
        ],
        "logic": "AND",
        "version": 2
      }
    },
    {
      "id": "imbalance_signal",
      "type": "SIGNAL",
      "config": {
        "signalType": "ENTRY",
        "condition": "70%+ smart money on one side, >10¢ edge remaining",
        "direction": "NO",
        "strength": "MODERATE"
      }
    },
    {
      "id": "orchestrator",
      "type": "ORCHESTRATOR",
      "config": {
        "version": 1,
        "mode": "approval",
        "portfolio_size_usd": 10000,
        "risk_tolerance": 6,
        "position_sizing_rules": {
          "fractional_kelly_lambda": 0.40,
          "max_per_position": 0.03,
          "min_bet": 15,
          "max_bet": 300,
          "portfolio_heat_limit": 0.40,
          "risk_reward_threshold": 1.5,
          "drawdown_protection": {
            "enabled": true,
            "drawdown_threshold": 0.15,
            "size_reduction": 0.50
          },
          "volatility_adjustment": {
            "enabled": true
          }
        }
      }
    }
  ],
  "edges": [
    {"from": "markets_source", "to": "market_filters"},
    {"from": "market_filters", "to": "imbalance_signal"},
    {"from": "imbalance_signal", "to": "orchestrator"}
  ]
}

async function fixNodeGraphStructure() {
  console.log('🔧 Fixing node graph structure...\n')

  try {
    // Step 1: Delete existing strategies
    console.log('1️⃣ Deleting existing strategies with incorrect structure...')
    const { error: deleteError } = await supabase
      .from('strategy_definitions')
      .delete()
      .in('strategy_name', ['Consensus Copy Trade', 'Smart-Money Imbalance Value Trade'])
      .eq('is_predefined', true)

    if (deleteError) {
      console.error('   ❌ Error deleting strategies:', deleteError)
      throw deleteError
    }
    console.log('   ✅ Old strategies deleted\n')

    // Step 2: Insert Consensus Copy Trade with correct structure
    console.log('2️⃣ Creating Consensus Copy Trade strategy...')
    const { error: consensusError } = await supabase
      .from('strategy_definitions')
      .insert({
        strategy_name: 'Consensus Copy Trade',
        strategy_description: 'Follow top wallets when they agree on an outcome. Enter only in final 12 hours before resolution when 2+ proven wallets align on the same side with no opposing positions. Maximize accuracy while keeping capital liquid.',
        strategy_type: 'SCREENING',
        is_predefined: true,
        is_archived: false,
        node_graph: consensusCopyTradeNodeGraph,
        execution_mode: 'MANUAL',
        is_active: true
      })

    if (consensusError) {
      console.error('   ❌ Error creating Consensus Copy Trade:', consensusError)
      throw consensusError
    }
    console.log('   ✅ Consensus Copy Trade created\n')

    // Step 3: Insert Smart-Money Imbalance Value Trade with correct structure
    console.log('3️⃣ Creating Smart-Money Imbalance Value Trade strategy...')
    const { error: imbalanceError } = await supabase
      .from('strategy_definitions')
      .insert({
        strategy_name: 'Smart-Money Imbalance Value Trade',
        strategy_description: 'Market-scanning strategy that identifies underpriced outcomes where top wallets are heavily stacked on one side. Looks for markets with >10¢ upside after fees, preferring NO positions since most markets resolve NO. Targets medium-term opportunities (12h-7d out) with strong smart-money conviction.',
        strategy_type: 'SCREENING',
        is_predefined: true,
        is_archived: false,
        node_graph: smartMoneyImbalanceNodeGraph,
        execution_mode: 'MANUAL',
        is_active: true
      })

    if (imbalanceError) {
      console.error('   ❌ Error creating Smart-Money Imbalance:', imbalanceError)
      throw imbalanceError
    }
    console.log('   ✅ Smart-Money Imbalance Value Trade created\n')

    console.log('✅ Node graph structure fixed successfully!')
    console.log('\n💡 The strategies now have the correct structure:')
    console.log('   - Config is directly on nodes (not wrapped in "data")')
    console.log('   - No "position" fields in database')
    console.log('   - Ready for production use\n')

  } catch (error) {
    console.error('❌ Fatal error:', error)
    process.exit(1)
  }
}

fixNodeGraphStructure()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
