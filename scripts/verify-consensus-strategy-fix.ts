import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyConsensusStrategyFix() {
  console.log('🔍 Verifying Consensus Copy Trade Strategy Fix\n');

  // Check if strategy exists
  const { data: strategies, error } = await supabase
    .from('strategy_definitions')
    .select('*')
    .eq('strategy_name', 'Consensus Copy Trade')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('❌ Error querying strategy:', error);
    return;
  }

  if (!strategies || strategies.length === 0) {
    console.error('❌ No Consensus Copy Trade strategy found!');
    return;
  }

  if (strategies.length > 1) {
    console.warn('⚠️  Multiple strategies found with same name:', strategies.length);
    console.log('This might indicate the DELETE didn\'t work or there are duplicates.');
    strategies.forEach((s, i) => {
      console.log(`\nStrategy ${i + 1}:`);
      console.log(`  ID: ${s.id}`);
      console.log(`  Created: ${s.created_at}`);
      console.log(`  Is Archived: ${s.is_archived}`);
    });
  }

  const strategy = strategies[0];
  console.log('✅ Strategy found');
  console.log(`   ID: ${strategy.id}`);
  console.log(`   Name: ${strategy.strategy_name}`);
  console.log(`   Type: ${strategy.strategy_type}`);
  console.log(`   Is Predefined: ${strategy.is_predefined}`);
  console.log(`   Is Archived: ${strategy.is_archived}`);
  console.log(`   Created: ${strategy.created_at}\n`);

  // Verify node graph structure
  const nodeGraph = strategy.node_graph as any;
  const nodes = nodeGraph?.nodes || [];
  const edges = nodeGraph?.edges || [];

  console.log('📊 Node Graph Analysis:');
  console.log(`   Total Nodes: ${nodes.length}`);
  console.log(`   Total Edges: ${edges.length}\n`);

  // Count node types
  const nodeTypes: Record<string, number> = {};
  nodes.forEach((node: any) => {
    nodeTypes[node.type] = (nodeTypes[node.type] || 0) + 1;
  });

  console.log('📋 Node Type Breakdown:');
  Object.entries(nodeTypes).forEach(([type, count]) => {
    console.log(`   ${type}: ${count}`);
  });

  // Verify expected structure
  console.log('\n✓ Verification Checks:');

  const checks = [
    { name: 'Is Not Archived', pass: strategy.is_archived === false },
    { name: 'Is Predefined', pass: strategy.is_predefined === true },
    { name: 'Has 7 Nodes', pass: nodes.length === 7 },
    { name: 'Has 1 DATA_SOURCE', pass: nodeTypes['DATA_SOURCE'] === 1 },
    { name: 'Has 4 FILTER nodes', pass: nodeTypes['FILTER'] === 4 },
    { name: 'Has 1 LOGIC node', pass: nodeTypes['LOGIC'] === 1 },
    { name: 'Has 1 AGGREGATION node', pass: nodeTypes['AGGREGATION'] === 1 },
    { name: 'Has 9 Edges', pass: edges.length === 9 }
  ];

  checks.forEach(check => {
    console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`);
  });

  // Show node details
  console.log('\n🔧 Node Details:');
  nodes.forEach((node: any) => {
    console.log(`\n   ${node.type} (${node.id}):`);
    if (node.config) {
      console.log(`     Config:`, JSON.stringify(node.config, null, 6).split('\n').join('\n     '));
    }
  });

  // Show edges
  console.log('\n🔗 Edge Connections:');
  edges.forEach((edge: any) => {
    console.log(`   ${edge.from} → ${edge.to}`);
  });

  const allChecksPassed = checks.every(c => c.pass);

  console.log('\n' + '='.repeat(50));
  if (allChecksPassed) {
    console.log('✅ All verification checks passed!');
    console.log('The Consensus Copy Trade strategy has been successfully fixed.');
  } else {
    console.log('⚠️  Some verification checks failed.');
    console.log('Please review the output above for details.');
  }
  console.log('='.repeat(50));
}

verifyConsensusStrategyFix().catch(console.error);
