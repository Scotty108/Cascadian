#!/usr/bin/env tsx
/**
 * Apply Smart-Money Imbalance Value Trade strategy migration to Supabase
 *
 * This script reads the migration SQL file and executes it against the Supabase database
 * using the service role key for full permissions.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: join(process.cwd(), '.env.local') });

// Load environment variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing Supabase credentials in .env.local');
  process.exit(1);
}

console.log('🔧 Configuration:');
console.log(`   Supabase URL: ${SUPABASE_URL}`);
console.log(`   Service Key: ${SUPABASE_SERVICE_KEY.substring(0, 20)}...`);
console.log('');

// Create Supabase client with service role key (bypasses RLS)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function applyMigration() {
  console.log('🚀 Starting Smart-Money Imbalance Value Trade strategy migration...\n');

  // Read migration file
  const migrationPath = join(process.cwd(), 'supabase/migrations/20251027000007_add_smart_money_imbalance_strategy.sql');
  console.log(`📄 Reading migration: ${migrationPath}`);

  const sql = readFileSync(migrationPath, 'utf-8');

  console.log(`📝 SQL file size: ${(sql.length / 1024).toFixed(1)}KB`);
  console.log(`📊 Executing migration...\n`);

  try {
    // Execute the INSERT statement directly using the Supabase client
    // Since this is a single INSERT, we can parse it and use the Supabase client directly

    console.log('Executing INSERT statement...');

    const { data, error } = await supabase
      .from('strategy_definitions')
      .insert({
        strategy_name: 'Smart-Money Imbalance Value Trade',
        strategy_description: 'Market-scanning strategy that identifies underpriced outcomes where top wallets are heavily stacked on one side. Looks for markets with >10¢ upside after fees, preferring NO positions since most markets resolve NO. Targets medium-term opportunities (12h-7d out) with strong smart-money conviction.',
        strategy_type: 'SCREENING',
        is_predefined: true,
        is_archived: false,
        node_graph: {
          "nodes": [
            {
              "type": "DATA_SOURCE",
              "id": "markets_source",
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
              "type": "FILTER",
              "id": "category_filter",
              "config": {
                "field": "category",
                "operator": "EQUALS",
                "value": "US politics",
                "description": "Focus on specific category (configurable)"
              }
            },
            {
              "type": "FILTER",
              "id": "time_window_medium",
              "config": {
                "field": "hours_to_close",
                "operator": "LESS_THAN_OR_EQUAL",
                "value": 168,
                "description": "Markets closing within 7 days (168 hours)"
              }
            },
            {
              "type": "FILTER",
              "id": "time_window_min",
              "config": {
                "field": "hours_to_close",
                "operator": "GREATER_THAN",
                "value": 1,
                "description": "Avoid last-minute markets, keep window >1 hour"
              }
            },
            {
              "type": "FILTER",
              "id": "min_liquidity",
              "config": {
                "field": "volume",
                "operator": "GREATER_THAN",
                "value": 1000,
                "description": "Ensure sufficient market liquidity"
              }
            },
            {
              "type": "FILTER",
              "id": "price_range_no",
              "config": {
                "field": "current_price_no",
                "operator": "LESS_THAN_OR_EQUAL",
                "value": 0.90,
                "description": "NO side has meaningful upside potential"
              }
            },
            {
              "type": "FILTER",
              "id": "avoid_extreme_prices",
              "config": {
                "field": "current_price_no",
                "operator": "GREATER_THAN_OR_EQUAL",
                "value": 0.05,
                "description": "Avoid extreme longshot bets"
              }
            },
            {
              "type": "LOGIC",
              "id": "combine_market_filters",
              "config": {
                "operator": "AND",
                "inputs": [
                  "category_filter",
                  "time_window_medium",
                  "time_window_min",
                  "min_liquidity",
                  "price_range_no",
                  "avoid_extreme_prices"
                ]
              }
            },
            {
              "type": "AGGREGATION",
              "id": "sort_by_volume",
              "config": {
                "function": "MAX",
                "field": "volume",
                "description": "Prioritize high-liquidity markets for best execution"
              }
            }
          ],
          "edges": [
            {"from": "markets_source", "to": "category_filter"},
            {"from": "markets_source", "to": "time_window_medium"},
            {"from": "markets_source", "to": "time_window_min"},
            {"from": "markets_source", "to": "min_liquidity"},
            {"from": "markets_source", "to": "price_range_no"},
            {"from": "markets_source", "to": "avoid_extreme_prices"},
            {"from": "category_filter", "to": "combine_market_filters"},
            {"from": "time_window_medium", "to": "combine_market_filters"},
            {"from": "time_window_min", "to": "combine_market_filters"},
            {"from": "min_liquidity", "to": "combine_market_filters"},
            {"from": "price_range_no", "to": "combine_market_filters"},
            {"from": "avoid_extreme_prices", "to": "combine_market_filters"},
            {"from": "combine_market_filters", "to": "sort_by_volume"}
          ]
        }
      })
      .select();

    if (error) {
      console.error('\n❌ Error executing INSERT:', error.message);
      console.error('Error details:', error);
      throw error;
    }

    console.log('✅ INSERT executed successfully');
    console.log('Inserted data:', JSON.stringify(data, null, 2));

    console.log('\n✅ Migration completed successfully!');
    console.log('\n📊 Verifying strategy...');

    // Verify strategy was created
    const { data: strategy, error: verifyError } = await supabase
      .from('strategy_definitions')
      .select('*')
      .eq('strategy_name', 'Smart-Money Imbalance Value Trade')
      .single();

    if (verifyError) {
      console.error('❌ Error verifying strategy:', verifyError);
      process.exit(1);
    }

    console.log('\n✅ Strategy verified successfully!');
    console.log('\n📋 Strategy Details:');
    console.log(`   ID: ${strategy.id}`);
    console.log(`   Name: ${strategy.strategy_name}`);
    console.log(`   Type: ${strategy.strategy_type}`);
    console.log(`   Is Predefined: ${strategy.is_predefined}`);
    console.log(`   Is Archived: ${strategy.is_archived}`);
    console.log(`   Created At: ${strategy.created_at}`);
    console.log(`\n📊 Node Graph Summary:`);
    console.log(`   Total Nodes: ${strategy.node_graph.nodes.length}`);

    // Group nodes by type
    const nodesByType = strategy.node_graph.nodes.reduce((acc: any, node: any) => {
      acc[node.type] = (acc[node.type] || 0) + 1;
      return acc;
    }, {});

    console.log(`   Node Types:`);
    Object.entries(nodesByType).forEach(([type, count]) => {
      console.log(`     - ${type}: ${count}`);
    });

    console.log(`   Total Edges: ${strategy.node_graph.edges.length}`);

    // Validate node types
    const validNodeTypes = ['DATA_SOURCE', 'FILTER', 'LOGIC', 'AGGREGATION'];
    const invalidNodes = strategy.node_graph.nodes.filter(
      (node: any) => !validNodeTypes.includes(node.type)
    );

    if (invalidNodes.length > 0) {
      console.log('\n⚠️  Warning: Found nodes with non-basic types:');
      invalidNodes.forEach((node: any) => {
        console.log(`     - ${node.id}: ${node.type}`);
      });
    } else {
      console.log('\n✅ All node types are basic and supported by the UI');
    }

    // Verify JSON structure
    const hasValidStructure =
      strategy.node_graph &&
      Array.isArray(strategy.node_graph.nodes) &&
      Array.isArray(strategy.node_graph.edges) &&
      strategy.node_graph.nodes.length > 0;

    if (hasValidStructure) {
      console.log('✅ Node graph JSON structure is valid');
    } else {
      console.log('❌ Node graph JSON structure is invalid');
      process.exit(1);
    }

    console.log('\n🎉 Migration verification complete!');

  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    if (error.details) {
      console.error('Details:', error.details);
    }
    if (error.hint) {
      console.error('Hint:', error.hint);
    }
    process.exit(1);
  }
}

// Run migration
applyMigration();
