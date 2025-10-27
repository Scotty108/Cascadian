#!/usr/bin/env tsx
/**
 * Apply strategy update migration to Supabase
 *
 * This script reads the migration SQL file and executes it against the Supabase database
 * using direct PostgreSQL connection.
 */

import { Client } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// Load environment variables from .env.local
config({ path: join(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const SUPABASE_DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_DB_PASSWORD) {
  console.error('❌ Missing Supabase credentials in .env.local');
  process.exit(1);
}

// Construct DATABASE_URL from Supabase URL
// Extract project ref from Supabase URL: https://PROJECT_REF.supabase.co
const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
if (!projectRef) {
  console.error('❌ Could not extract project reference from SUPABASE_URL');
  process.exit(1);
}

// Use the direct connection string
// Format: postgresql://postgres:PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres
const DATABASE_URL = `postgresql://postgres:${SUPABASE_DB_PASSWORD}@db.${projectRef}.supabase.co:5432/postgres`;

// Create Supabase client for verification (bypasses RLS)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function applyMigration() {
  console.log('🚀 Applying strategy update migration...\n');
  console.log('This migration will:');
  console.log('  1. Delete simplified versions of both strategies');
  console.log('  2. Recreate "Consensus Copy Trade" with ENHANCED_FILTER, SIGNAL, and ORCHESTRATOR nodes');
  console.log('  3. Recreate "Smart-Money Imbalance Value Trade" with advanced nodes\n');

  // Read migration file to extract the strategy definitions
  const migrationPath = join(process.cwd(), 'supabase/migrations/20251027000008_update_strategies_with_advanced_nodes.sql');
  console.log(`📄 Reading migration: ${migrationPath}\n`);

  try {
    // Step 1: Delete existing strategies
    console.log('[1/3] Deleting existing strategy versions...');
    const { error: deleteError } = await supabase
      .from('strategy_definitions')
      .delete()
      .in('strategy_name', ['Consensus Copy Trade', 'Smart-Money Imbalance Value Trade'])
      .eq('is_predefined', true);

    if (deleteError) {
      throw new Error(`Failed to delete strategies: ${deleteError.message}`);
    }
    console.log('    ✅ Deleted old versions\n');

    // Step 2: Insert Consensus Copy Trade with advanced nodes
    console.log('[2/3] Creating "Consensus Copy Trade" with advanced nodes...');

    const consensusCopyTrade = {
      strategy_name: 'Consensus Copy Trade',
      strategy_description: 'Follow top wallets when they agree on an outcome. Enter only in final 12 hours before resolution when 2+ proven wallets align on the same side with no opposing positions. Maximize accuracy while keeping capital liquid.',
      strategy_type: 'SCREENING',
      is_predefined: true,
      is_archived: false,
      node_graph: {
        nodes: [
          {
            id: 'wallets_source',
            type: 'DATA_SOURCE',
            position: { x: 100, y: 100 },
            data: {
              config: {
                source: 'WALLETS',
                mode: 'BATCH',
                prefilters: {
                  table: 'wallet_scores',
                  where: 'meets_minimum_trades = true'
                }
              }
            }
          },
          {
            id: 'wallet_quality_filter',
            type: 'ENHANCED_FILTER',
            position: { x: 400, y: 100 },
            data: {
              config: {
                conditions: [
                  {
                    id: 'cond_profitable',
                    field: 'total_pnl',
                    operator: 'GREATER_THAN',
                    value: 0,
                    fieldType: 'number'
                  },
                  {
                    id: 'cond_omega',
                    field: 'omega_ratio',
                    operator: 'GREATER_THAN_OR_EQUAL',
                    value: 2.0,
                    fieldType: 'number'
                  },
                  {
                    id: 'cond_positions',
                    field: 'closed_positions',
                    operator: 'GREATER_THAN_OR_EQUAL',
                    value: 20,
                    fieldType: 'number'
                  },
                  {
                    id: 'cond_winrate',
                    field: 'win_rate',
                    operator: 'GREATER_THAN_OR_EQUAL',
                    value: 0.55,
                    fieldType: 'number'
                  }
                ],
                logic: 'AND',
                version: 2
              }
            }
          },
          {
            id: 'top_wallets_aggregation',
            type: 'AGGREGATION',
            position: { x: 700, y: 100 },
            data: {
              config: {
                function: 'TOP_N',
                field: 'total_pnl',
                limit: 20
              }
            }
          },
          {
            id: 'consensus_signal',
            type: 'SIGNAL',
            position: { x: 1000, y: 100 },
            data: {
              config: {
                signalType: 'ENTRY',
                condition: '2+ wallets agree on same side, no conflicts',
                direction: 'NO',
                strength: 'STRONG'
              }
            }
          },
          {
            id: 'orchestrator',
            type: 'ORCHESTRATOR',
            position: { x: 1000, y: 300 },
            data: {
              config: {
                version: 1,
                mode: 'approval',
                portfolio_size_usd: 10000,
                risk_tolerance: 5,
                position_sizing_rules: {
                  fractional_kelly_lambda: 0.375,
                  max_per_position: 0.02,
                  min_bet: 10,
                  max_bet: 200,
                  portfolio_heat_limit: 0.30,
                  risk_reward_threshold: 2.0,
                  drawdown_protection: {
                    enabled: true,
                    drawdown_threshold: 0.10,
                    size_reduction: 0.50
                  },
                  volatility_adjustment: {
                    enabled: false
                  }
                }
              }
            }
          }
        ],
        edges: [
          { from: 'wallets_source', to: 'wallet_quality_filter' },
          { from: 'wallet_quality_filter', to: 'top_wallets_aggregation' },
          { from: 'top_wallets_aggregation', to: 'consensus_signal' },
          { from: 'consensus_signal', to: 'orchestrator' }
        ]
      }
    };

    const { error: consensusError } = await supabase
      .from('strategy_definitions')
      .insert(consensusCopyTrade);

    if (consensusError) {
      throw new Error(`Failed to create Consensus Copy Trade: ${consensusError.message}`);
    }
    console.log('    ✅ Created Consensus Copy Trade\n');

    // Step 3: Insert Smart-Money Imbalance Value Trade with advanced nodes
    console.log('[3/3] Creating "Smart-Money Imbalance Value Trade" with advanced nodes...');

    const smartMoneyImbalance = {
      strategy_name: 'Smart-Money Imbalance Value Trade',
      strategy_description: 'Market-scanning strategy that identifies underpriced outcomes where top wallets are heavily stacked on one side. Looks for markets with >10¢ upside after fees, preferring NO positions since most markets resolve NO. Targets medium-term opportunities (12h-7d out) with strong smart-money conviction.',
      strategy_type: 'SCREENING',
      is_predefined: true,
      is_archived: false,
      node_graph: {
        nodes: [
          {
            id: 'markets_source',
            type: 'DATA_SOURCE',
            position: { x: 100, y: 100 },
            data: {
              config: {
                source: 'MARKETS',
                mode: 'BATCH',
                prefilters: {
                  table: 'markets_dim_seed',
                  where: "status = 'active'"
                }
              }
            }
          },
          {
            id: 'market_filters',
            type: 'ENHANCED_FILTER',
            position: { x: 400, y: 100 },
            data: {
              config: {
                conditions: [
                  {
                    id: 'cond_category',
                    field: 'category',
                    operator: 'EQUALS',
                    value: 'US politics',
                    fieldType: 'string'
                  },
                  {
                    id: 'cond_time_max',
                    field: 'hours_to_close',
                    operator: 'LESS_THAN_OR_EQUAL',
                    value: 168,
                    fieldType: 'number'
                  },
                  {
                    id: 'cond_time_min',
                    field: 'hours_to_close',
                    operator: 'GREATER_THAN',
                    value: 1,
                    fieldType: 'number'
                  },
                  {
                    id: 'cond_liquidity',
                    field: 'volume',
                    operator: 'GREATER_THAN',
                    value: 1000,
                    fieldType: 'number'
                  },
                  {
                    id: 'cond_price_max',
                    field: 'current_price_no',
                    operator: 'LESS_THAN_OR_EQUAL',
                    value: 0.90,
                    fieldType: 'number'
                  },
                  {
                    id: 'cond_price_min',
                    field: 'current_price_no',
                    operator: 'GREATER_THAN_OR_EQUAL',
                    value: 0.05,
                    fieldType: 'number'
                  }
                ],
                logic: 'AND',
                version: 2
              }
            }
          },
          {
            id: 'imbalance_signal',
            type: 'SIGNAL',
            position: { x: 700, y: 100 },
            data: {
              config: {
                signalType: 'ENTRY',
                condition: '70%+ smart money on one side, >10¢ edge remaining',
                direction: 'NO',
                strength: 'MODERATE'
              }
            }
          },
          {
            id: 'orchestrator',
            type: 'ORCHESTRATOR',
            position: { x: 1000, y: 100 },
            data: {
              config: {
                version: 1,
                mode: 'approval',
                portfolio_size_usd: 10000,
                risk_tolerance: 6,
                position_sizing_rules: {
                  fractional_kelly_lambda: 0.40,
                  max_per_position: 0.03,
                  min_bet: 15,
                  max_bet: 300,
                  portfolio_heat_limit: 0.40,
                  risk_reward_threshold: 1.5,
                  drawdown_protection: {
                    enabled: true,
                    drawdown_threshold: 0.15,
                    size_reduction: 0.50
                  },
                  volatility_adjustment: {
                    enabled: true
                  }
                }
              }
            }
          }
        ],
        edges: [
          { from: 'markets_source', to: 'market_filters' },
          { from: 'market_filters', to: 'imbalance_signal' },
          { from: 'imbalance_signal', to: 'orchestrator' }
        ]
      }
    };

    const { error: imbalanceError } = await supabase
      .from('strategy_definitions')
      .insert(smartMoneyImbalance);

    if (imbalanceError) {
      throw new Error(`Failed to create Smart-Money Imbalance Value Trade: ${imbalanceError.message}`);
    }
    console.log('    ✅ Created Smart-Money Imbalance Value Trade\n');

    console.log('\n✅ Migration completed successfully!\n');

  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('Error details:', error);
    process.exit(1);
  }
}

async function verifyStrategies() {
  console.log('=== Verifying Strategies ===\n');

  const { data: strategies, error } = await supabase
    .from('strategy_definitions')
    .select('strategy_name, is_predefined, is_archived, node_graph')
    .in('strategy_name', ['Consensus Copy Trade', 'Smart-Money Imbalance Value Trade'])
    .eq('is_predefined', true);

  if (error) {
    console.error('❌ Failed to fetch strategies:', error);
    return;
  }

  if (!strategies || strategies.length === 0) {
    console.error('❌ No strategies found!');
    return;
  }

  console.log(`Found ${strategies.length} strategies\n`);

  for (const strategy of strategies) {
    console.log(`📋 Strategy: ${strategy.strategy_name}`);
    console.log(`   is_predefined: ${strategy.is_predefined}`);
    console.log(`   is_archived: ${strategy.is_archived}`);

    const nodeGraph = strategy.node_graph as any;
    const nodes = nodeGraph?.nodes || [];
    const edges = nodeGraph?.edges || [];

    console.log(`   Nodes (${nodes.length}):`);

    const nodeTypes = nodes.map((n: any) => n.type);
    const hasEnhancedFilter = nodeTypes.includes('ENHANCED_FILTER');
    const hasSignal = nodeTypes.includes('SIGNAL');
    const hasOrchestrator = nodeTypes.includes('ORCHESTRATOR');

    nodes.forEach((node: any) => {
      console.log(`     - ${node.type} (id: ${node.id})`);

      if (node.type === 'ENHANCED_FILTER') {
        const conditions = node.data?.config?.conditions || [];
        console.log(`       Conditions: ${conditions.length}`);
        conditions.forEach((c: any) => {
          console.log(`         • ${c.field} ${c.operator} ${c.value}`);
        });
      } else if (node.type === 'SIGNAL') {
        const config = node.data?.config || {};
        console.log(`       Signal Type: ${config.signalType}`);
        console.log(`       Direction: ${config.direction}`);
        console.log(`       Strength: ${config.strength}`);
      } else if (node.type === 'ORCHESTRATOR') {
        const config = node.data?.config || {};
        console.log(`       Mode: ${config.mode}`);
        console.log(`       Risk Tolerance: ${config.risk_tolerance}`);
        console.log(`       Portfolio Size: $${config.portfolio_size_usd}`);
      }
    });

    console.log(`   Edges: ${edges.length}`);
    console.log(`   ✓ Has ENHANCED_FILTER: ${hasEnhancedFilter}`);
    console.log(`   ✓ Has SIGNAL: ${hasSignal}`);
    console.log(`   ✓ Has ORCHESTRATOR: ${hasOrchestrator}`);
    console.log('');
  }

  // Summary
  console.log('=== Summary ===');
  const allValid = strategies.every(s => {
    const nodes = (s.node_graph as any)?.nodes || [];
    const types = nodes.map((n: any) => n.type);
    return types.includes('ENHANCED_FILTER') &&
           types.includes('SIGNAL') &&
           types.includes('ORCHESTRATOR') &&
           s.is_predefined === true &&
           s.is_archived === false;
  });

  if (allValid) {
    console.log('✅ All strategies are properly configured with advanced nodes');
  } else {
    console.log('❌ Some strategies have configuration issues');
  }
}

async function main() {
  await applyMigration();
  await verifyStrategies();
}

// Run migration
main();
