#!/usr/bin/env tsx
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyStrategy() {
  console.log('🔍 Verifying Smart-Money Imbalance Value Trade strategy...\n');

  // Check for the specific strategy
  const { data: smartMoneyStrategy, error: smartMoneyError } = await supabase
    .from('strategy_definitions')
    .select('*')
    .eq('strategy_name', 'Smart-Money Imbalance Value Trade')
    .single();

  if (smartMoneyError) {
    console.error('❌ Error fetching strategy:', smartMoneyError);
    return;
  }

  if (!smartMoneyStrategy) {
    console.log('❌ Strategy not found!');
    return;
  }

  console.log('✅ Strategy found in database!\n');
  console.log('📋 Strategy Details:');
  console.log(`   ID: ${smartMoneyStrategy.strategy_id}`);
  console.log(`   Name: ${smartMoneyStrategy.strategy_name}`);
  console.log(`   Type: ${smartMoneyStrategy.strategy_type}`);
  console.log(`   Description: ${smartMoneyStrategy.strategy_description.substring(0, 100)}...`);
  console.log(`   Is Predefined: ${smartMoneyStrategy.is_predefined}`);
  console.log(`   Is Archived: ${smartMoneyStrategy.is_archived}`);
  console.log(`   Is Active: ${smartMoneyStrategy.is_active}`);
  console.log(`   Created At: ${smartMoneyStrategy.created_at}`);
  console.log(`   Version: ${smartMoneyStrategy.version}`);

  console.log('\n📊 Node Graph Analysis:');
  const nodeGraph = smartMoneyStrategy.node_graph;
  console.log(`   Total Nodes: ${nodeGraph.nodes.length}`);
  console.log(`   Total Edges: ${nodeGraph.edges.length}`);

  // Group nodes by type
  const nodesByType = nodeGraph.nodes.reduce((acc: any, node: any) => {
    acc[node.type] = (acc[node.type] || 0) + 1;
    return acc;
  }, {});

  console.log('\n   Nodes by Type:');
  Object.entries(nodesByType).forEach(([type, count]) => {
    console.log(`     - ${type}: ${count}`);
  });

  // List all nodes
  console.log('\n   Node Details:');
  nodeGraph.nodes.forEach((node: any) => {
    console.log(`     [${node.type}] ${node.id}`);
    if (node.config.description) {
      console.log(`       → ${node.config.description}`);
    }
  });

  // Validate node types are supported
  const supportedTypes = ['DATA_SOURCE', 'FILTER', 'LOGIC', 'AGGREGATION'];
  const unsupportedNodes = nodeGraph.nodes.filter(
    (node: any) => !supportedTypes.includes(node.type)
  );

  if (unsupportedNodes.length > 0) {
    console.log('\n⚠️  Warning: Found unsupported node types:');
    unsupportedNodes.forEach((node: any) => {
      console.log(`     - ${node.id}: ${node.type}`);
    });
  } else {
    console.log('\n✅ All node types are supported by the UI');
  }

  // Check if strategy is visible (not archived)
  if (smartMoneyStrategy.is_archived) {
    console.log('\n⚠️  Warning: Strategy is archived and will NOT appear in the strategy library');
  } else {
    console.log('\n✅ Strategy is NOT archived - it WILL appear in the strategy library');
  }

  // Get total count of all strategies
  const { count: totalCount, error: countError } = await supabase
    .from('strategy_definitions')
    .select('*', { count: 'exact', head: true });

  if (!countError) {
    console.log(`\n📊 Total strategies in database: ${totalCount}`);
  }

  // Get count of non-archived predefined strategies
  const { count: visibleCount, error: visibleError } = await supabase
    .from('strategy_definitions')
    .select('*', { count: 'exact', head: true })
    .eq('is_predefined', true)
    .eq('is_archived', false);

  if (!visibleError) {
    console.log(`📊 Visible predefined strategies: ${visibleCount}`);
  }

  // List all predefined non-archived strategies
  const { data: visibleStrategies, error: listError } = await supabase
    .from('strategy_definitions')
    .select('strategy_id, strategy_name, strategy_type, created_at')
    .eq('is_predefined', true)
    .eq('is_archived', false)
    .order('created_at', { ascending: false });

  if (!listError && visibleStrategies) {
    console.log('\n📋 All Visible Predefined Strategies:');
    visibleStrategies.forEach((s, i) => {
      console.log(`   ${i + 1}. ${s.strategy_name} (${s.strategy_type})`);
      console.log(`      Created: ${s.created_at}`);
    });
  }

  console.log('\n✅ Verification complete!');
}

verifyStrategy().catch(console.error);
