import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function applyMigration() {
  console.log('Reading migration file...');
  const migrationPath = path.join(__dirname, '../supabase/migrations/20251027000006_fix_consensus_copytrade_strategy.sql');
  const sql = fs.readFileSync(migrationPath, 'utf-8');

  console.log('Applying migration...\n');

  // Split SQL into individual statements (simple split on semicolon)
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const statement of statements) {
    console.log(`Executing statement:\n${statement.substring(0, 100)}...\n`);

    const { data, error } = await supabase.rpc('exec_sql', {
      sql_query: statement
    });

    if (error) {
      console.error('Error executing statement:', error);
      // Try direct approach instead
      console.log('Trying direct approach...');
      break;
    }
  }

  // Use direct delete and insert approach
  console.log('\n=== Step 1: Deleting broken strategy ===');
  const { data: deleteData, error: deleteError } = await supabase
    .from('strategy_definitions')
    .delete()
    .eq('strategy_name', 'Consensus Copy Trade')
    .eq('is_predefined', true)
    .select();

  if (deleteError) {
    console.error('Delete error:', deleteError);
    process.exit(1);
  }

  console.log('Deleted:', deleteData?.length || 0, 'record(s)');

  console.log('\n=== Step 2: Inserting corrected strategy ===');
  const nodeGraph = {
    "nodes": [
      {
        "type": "DATA_SOURCE",
        "id": "wallets",
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
        "type": "FILTER",
        "id": "profitable",
        "config": {
          "field": "total_pnl",
          "operator": "GREATER_THAN",
          "value": 0
        }
      },
      {
        "type": "FILTER",
        "id": "quality_omega",
        "config": {
          "field": "omega_ratio",
          "operator": "GREATER_THAN_OR_EQUAL",
          "value": 2.0
        }
      },
      {
        "type": "FILTER",
        "id": "min_positions",
        "config": {
          "field": "closed_positions",
          "operator": "GREATER_THAN_OR_EQUAL",
          "value": 20
        }
      },
      {
        "type": "FILTER",
        "id": "win_rate",
        "config": {
          "field": "win_rate",
          "operator": "GREATER_THAN_OR_EQUAL",
          "value": 0.55
        }
      },
      {
        "type": "LOGIC",
        "id": "combine_quality",
        "config": {
          "operator": "AND",
          "inputs": ["profitable", "quality_omega", "min_positions", "win_rate"]
        }
      },
      {
        "type": "AGGREGATION",
        "id": "sort_by_pnl",
        "config": {
          "function": "MAX",
          "field": "total_pnl"
        }
      }
    ],
    "edges": [
      {"from": "wallets", "to": "profitable"},
      {"from": "wallets", "to": "quality_omega"},
      {"from": "wallets", "to": "min_positions"},
      {"from": "wallets", "to": "win_rate"},
      {"from": "profitable", "to": "combine_quality"},
      {"from": "quality_omega", "to": "combine_quality"},
      {"from": "min_positions", "to": "combine_quality"},
      {"from": "win_rate", "to": "combine_quality"},
      {"from": "combine_quality", "to": "sort_by_pnl"}
    ]
  };

  const { data: insertData, error: insertError } = await supabase
    .from('strategy_definitions')
    .insert({
      strategy_name: 'Consensus Copy Trade',
      strategy_description: 'Follow top wallets when they agree on an outcome. Identifies proven profitable wallets with strong track records and filters for markets where multiple quality wallets align on the same side.',
      strategy_type: 'SCREENING',
      is_predefined: true,
      is_archived: false,
      node_graph: nodeGraph
    })
    .select();

  if (insertError) {
    console.error('Insert error:', insertError);
    process.exit(1);
  }

  console.log('Inserted:', insertData?.length || 0, 'record(s)');

  console.log('\n=== Step 3: Verifying the new strategy ===');
  const { data: verifyData, error: verifyError } = await supabase
    .from('strategy_definitions')
    .select('*')
    .eq('strategy_name', 'Consensus Copy Trade')
    .eq('is_predefined', true);

  if (verifyError) {
    console.error('Verify error:', verifyError);
    process.exit(1);
  }

  if (!verifyData || verifyData.length === 0) {
    console.error('ERROR: Strategy not found after insertion!');
    process.exit(1);
  }

  const strategy = verifyData[0];
  console.log('\nStrategy verification:');
  console.log('- ID:', strategy.id);
  console.log('- Name:', strategy.strategy_name);
  console.log('- Type:', strategy.strategy_type);
  console.log('- is_predefined:', strategy.is_predefined);
  console.log('- is_archived:', strategy.is_archived);
  console.log('- Node count:', strategy.node_graph.nodes.length);
  console.log('- Edge count:', strategy.node_graph.edges.length);

  console.log('\nNode types used:');
  strategy.node_graph.nodes.forEach((node: any) => {
    console.log(`  - ${node.id}: ${node.type}`);
  });

  console.log('\n=== Migration completed successfully! ===');
}

applyMigration().catch(console.error);
