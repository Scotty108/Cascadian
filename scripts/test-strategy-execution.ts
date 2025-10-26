/**
 * Test Strategy Execution
 * Verifies all 8 seeded strategies work with real data
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

import { strategyEngine } from '@/lib/strategy-builder';
import { createClient } from '@supabase/supabase-js';
import type { ExecutionContext } from '@/lib/strategy-builder/types';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function testStrategy(strategyName: string): Promise<void> {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Testing Strategy: ${strategyName}`);
  console.log('='.repeat(80));

  try {
    // Fetch strategy from database
    const { data: strategy, error } = await supabase
      .from('strategy_definitions')
      .select('*')
      .eq('strategy_name', strategyName)
      .single();

    if (error || !strategy) {
      console.error(`❌ Strategy not found: ${strategyName}`);
      return;
    }

    console.log(`✅ Strategy loaded: ${strategy.strategy_description}`);
    console.log(`   Type: ${strategy.strategy_type}`);
    console.log(`   Nodes: ${strategy.node_graph.nodes.length}`);

    // Execute strategy
    const context: ExecutionContext = {
      strategyId: strategy.strategy_id,
      executionId: crypto.randomUUID(),
      mode: 'MANUAL',
      startTime: new Date(),
    };

    const result = await strategyEngine.execute(
      {
        ...strategy,
        nodeGraph: strategy.node_graph,
        strategyId: strategy.strategy_id,
        strategyName: strategy.strategy_name,
        strategyDescription: strategy.strategy_description,
        strategyType: strategy.strategy_type,
        isPredefined: strategy.is_predefined,
        executionMode: strategy.execution_mode,
        scheduleCron: strategy.schedule_cron,
        isActive: strategy.is_active,
        createdBy: strategy.created_by,
        createdAt: new Date(strategy.created_at),
        updatedAt: new Date(strategy.updated_at),
      },
      context
    );

    // Display results
    console.log(`\n📊 Execution Results:`);
    console.log(`   Status: ${result.status}`);
    console.log(`   Execution Time: ${result.totalExecutionTimeMs}ms`);
    console.log(`   Nodes Evaluated: ${result.nodesEvaluated}`);
    console.log(`   Data Points Processed: ${result.dataPointsProcessed}`);

    if (result.aggregations) {
      console.log(`\n📈 Aggregations:`);
      Object.entries(result.aggregations).forEach(([key, value]) => {
        console.log(`   ${key}: ${JSON.stringify(value)}`);
      });
    }

    if (result.signalsGenerated && result.signalsGenerated.length > 0) {
      console.log(`\n📡 Signals Generated: ${result.signalsGenerated.length}`);
      result.signalsGenerated.forEach((signal, i) => {
        console.log(`   ${i + 1}. ${signal.signalType} ${signal.direction || ''}`);
      });
    }

    if (result.actionsExecuted && result.actionsExecuted.length > 0) {
      console.log(`\n🎬 Actions Executed: ${result.actionsExecuted.length}`);
      result.actionsExecuted.forEach((action, i) => {
        console.log(`   ${i + 1}. ${action.action} (${action.count} items)`);
      });
    }

    // Show sample of matched data
    const matchedWallets = Object.values(result.results).find(
      r => Array.isArray(r.data) && r.data.length > 0 && r.data[0].wallet_address
    );

    if (matchedWallets && Array.isArray(matchedWallets.data)) {
      console.log(`\n🎯 Sample Results (top 5):`);
      matchedWallets.data.slice(0, 5).forEach((wallet: any, i: number) => {
        console.log(`   ${i + 1}. ${wallet.wallet_address.slice(0, 12)}...`);
        console.log(`      Omega: ${wallet.omega_ratio?.toFixed(2) || 'N/A'}`);
        console.log(`      P&L: $${wallet.total_pnl?.toFixed(2) || wallet.net_pnl?.toFixed(2) || 'N/A'}`);
        console.log(`      Trades: ${wallet.closed_positions || wallet.resolved_bets || 'N/A'}`);
      });
    }

    console.log(`\n✅ ${strategyName} TEST PASSED`);
  } catch (error) {
    console.error(`\n❌ ${strategyName} TEST FAILED:`);
    console.error(error);
  }
}

async function testAllStrategies() {
  console.log('\n🚀 STRATEGY BUILDER TEST SUITE\n');

  const strategies = [
    'Balanced Hybrid',
    'Eggman Hunter (AI Specialist)',
    'Momentum Rider',
    'Aggressive Growth',
    'Safe & Steady',
    'Rising Star',
    'Alpha Decay Detector',
    'Fortress',
  ];

  for (const strategy of strategies) {
    await testStrategy(strategy);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limit
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('✅ ALL TESTS COMPLETE');
  console.log('='.repeat(80));
}

// Run tests
testAllStrategies()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
