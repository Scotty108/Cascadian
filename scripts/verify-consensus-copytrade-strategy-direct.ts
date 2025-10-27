/**
 * Verify Consensus Copy Trade Strategy Migration
 *
 * Confirms that the "Consensus Copy Trade" strategy was successfully inserted
 * with proper configuration and node graph structure.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase environment variables');
  console.error('   NEXT_PUBLIC_SUPABASE_URL:', !!supabaseUrl);
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', !!supabaseServiceKey);
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

interface StrategyRecord {
  strategy_id: string;
  strategy_name: string;
  strategy_description: string;
  strategy_type: string;
  is_predefined: boolean;
  is_archived: boolean;
  created_at: string;
  node_graph: {
    nodes: Array<{
      id: string;
      type: string;
      position: { x: number; y: number };
      config: any;
    }>;
    edges: Array<{
      from: string;
      to: string;
    }>;
  };
}

async function verifyConsensusStrategy() {
  console.log('🔍 Verifying Consensus Copy Trade Strategy...\n');

  try {
    // Query the strategy
    const { data, error } = await supabaseAdmin
      .from('strategy_definitions')
      .select('*')
      .eq('strategy_name', 'Consensus Copy Trade')
      .single();

    if (error) {
      console.error('❌ Error querying strategy:', error.message);
      return;
    }

    if (!data) {
      console.error('❌ Strategy not found in database');
      return;
    }

    const strategy = data as StrategyRecord;

    // Verify basic properties
    console.log('✅ Strategy found in database\n');
    console.log('📋 Basic Properties:');
    console.log(`   - ID: ${strategy.strategy_id}`);
    console.log(`   - Name: ${strategy.strategy_name}`);
    console.log(`   - Type: ${strategy.strategy_type}`);
    console.log(`   - Predefined: ${strategy.is_predefined ? '✅ TRUE' : '❌ FALSE'}`);
    console.log(`   - Archived: ${strategy.is_archived ? '❌ TRUE' : '✅ FALSE'}`);
    console.log(`   - Created: ${strategy.created_at}\n`);

    // Verify is_predefined and is_archived
    if (!strategy.is_predefined) {
      console.error('❌ FAIL: is_predefined should be TRUE');
    } else {
      console.log('✅ PASS: is_predefined = TRUE');
    }

    if (strategy.is_archived) {
      console.error('❌ FAIL: is_archived should be FALSE');
    } else {
      console.log('✅ PASS: is_archived = FALSE');
    }

    // Verify description
    console.log('\n📝 Description:');
    console.log(`   ${strategy.strategy_description}\n`);

    // Verify node graph structure
    if (!strategy.node_graph) {
      console.error('❌ FAIL: node_graph is missing');
      return;
    }

    console.log('🎯 Node Graph Structure:');
    console.log(`   - Nodes: ${strategy.node_graph.nodes?.length || 0}`);
    console.log(`   - Edges: ${strategy.node_graph.edges?.length || 0}\n`);

    // Verify required nodes
    const requiredNodes = [
      'markets_source',
      'category_filter',
      'time_filter',
      'wallet_source',
      'wallet_quality_filter',
      'top_wallets',
      'consensus_detector',
      'conflict_check',
      'trade_signal',
      'orchestrator'
    ];

    console.log('🔍 Checking Required Nodes:');
    const nodeIds = strategy.node_graph.nodes.map(n => n.id);
    let allNodesPresent = true;

    for (const requiredId of requiredNodes) {
      if (nodeIds.includes(requiredId)) {
        console.log(`   ✅ ${requiredId}`);
      } else {
        console.log(`   ❌ ${requiredId} - MISSING`);
        allNodesPresent = false;
      }
    }

    if (allNodesPresent) {
      console.log('\n✅ All required nodes present');
    } else {
      console.log('\n❌ Some required nodes are missing');
    }

    // List all node types
    console.log('\n📦 Node Types:');
    const nodeTypeCount = strategy.node_graph.nodes.reduce((acc, node) => {
      acc[node.type] = (acc[node.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    for (const [type, count] of Object.entries(nodeTypeCount)) {
      console.log(`   - ${type}: ${count}`);
    }

    // Verify orchestrator configuration
    console.log('\n⚙️  Orchestrator Configuration:');
    const orchestrator = strategy.node_graph.nodes.find(n => n.id === 'orchestrator');
    if (orchestrator) {
      console.log(`   - Mode: ${orchestrator.config.mode}`);
      console.log(`   - Portfolio Size: $${orchestrator.config.portfolio_size_usd.toLocaleString()}`);
      console.log(`   - Risk Tolerance: ${orchestrator.config.risk_tolerance}`);
      console.log(`   - Position Sizing: ${orchestrator.config.position_sizing_rules.method}`);
      console.log(`   - Hold to Resolution: ${orchestrator.config.exit_rules.hold_to_resolution ? '✅' : '❌'}`);
    } else {
      console.log('   ❌ Orchestrator node not found');
    }

    // Verify consensus detector configuration
    console.log('\n🤝 Consensus Detector Configuration:');
    const consensus = strategy.node_graph.nodes.find(n => n.id === 'consensus_detector');
    if (consensus) {
      console.log(`   - Min Supporting Wallets: ${consensus.config.params.min_supporting_wallets}`);
      console.log(`   - Require No Conflict: ${consensus.config.params.require_no_conflict ? '✅' : '❌'}`);
      console.log(`   - Check Positions API: ${consensus.config.params.check_positions_api ? '✅' : '❌'}`);
    } else {
      console.log('   ❌ Consensus detector node not found');
    }

    // Verify wallet quality filter
    console.log('\n💎 Wallet Quality Filter:');
    const walletFilter = strategy.node_graph.nodes.find(n => n.id === 'wallet_quality_filter');
    if (walletFilter && walletFilter.config.conditions) {
      for (const condition of walletFilter.config.conditions) {
        console.log(`   - ${condition.id}: ${condition.description}`);
      }
    } else {
      console.log('   ❌ Wallet quality filter not found or missing conditions');
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 VERIFICATION SUMMARY');
    console.log('='.repeat(60));

    const allChecks =
      strategy.is_predefined === true &&
      strategy.is_archived === false &&
      allNodesPresent &&
      orchestrator !== undefined &&
      consensus !== undefined &&
      walletFilter !== undefined;

    if (allChecks) {
      console.log('✅ ALL CHECKS PASSED');
      console.log('\n✨ The Consensus Copy Trade strategy is properly configured');
      console.log('   and ready to appear in the strategy library!');
    } else {
      console.log('⚠️  SOME CHECKS FAILED');
      console.log('\n   Please review the issues above.');
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
    if (error instanceof Error) {
      console.error('   Message:', error.message);
      console.error('   Stack:', error.stack);
    }
  }
}

verifyConsensusStrategy();
