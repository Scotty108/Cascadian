/**
 * ClickHouse Connector - Example Usage
 *
 * Comprehensive examples showing how to use the connector for various
 * wallet screening and strategy building scenarios.
 *
 * @module lib/strategy-builder/examples
 */

import { walletMetricsConnector } from './clickhouse-connector';
import type { WalletMetricsComplete } from './types';

// ============================================================================
// Example 1: Simple Top Performers Screen
// ============================================================================

/**
 * Find top 100 wallets by omega ratio with minimum activity
 */
export async function example1_topPerformers() {
  console.log('\n=== Example 1: Top Performers ===\n');

  const result = await walletMetricsConnector.queryWalletMetrics({
    timeWindow: 'lifetime',
    selectFields: [
      'omega_ratio',
      'resolved_bets',
      'net_pnl',
      'track_record_days',
    ],
    filters: [
      // Minimum sample size
      { field: 'resolved_bets', operator: 'GREATER_THAN', value: 20 },
      // Minimum track record
      { field: 'track_record_days', operator: 'GREATER_THAN', value: 30 },
      // Strong performance
      { field: 'omega_ratio', operator: 'GREATER_THAN_OR_EQUAL', value: 3.0 },
    ],
    orderBy: { field: 'omega_ratio', direction: 'DESC' },
    limit: 100,
  });

  console.log(`Found ${result.data.length} wallets in ${result.executionTimeMs}ms`);
  console.log('\nTop 5:');
  result.data.slice(0, 5).forEach((wallet: any, i) => {
    console.log(
      `${i + 1}. ${wallet.wallet_address}: ` +
      `Omega=${wallet.omega_ratio?.toFixed(2)}, ` +
      `Trades=${wallet.resolved_bets}, ` +
      `PnL=$${wallet.net_pnl?.toFixed(0)}`
    );
  });

  return result;
}

// ============================================================================
// Example 2: Multi-Metric Strategy Screen
// ============================================================================

/**
 * Find wallets with strong convexity (tail ratio) and copyability
 */
export async function example2_convexityStrategy() {
  console.log('\n=== Example 2: Convexity + Copyability Strategy ===\n');

  const result = await walletMetricsConnector.queryWalletMetrics({
    timeWindow: '90d', // Recent performance
    selectFields: [
      'omega_ratio',
      'tail_ratio',
      'omega_lag_30s',
      'ev_per_hour_capital',
      'resolved_bets',
    ],
    filters: [
      // Minimum activity
      { field: 'resolved_bets', operator: 'GREATER_THAN', value: 30 },

      // Convexity: big winners vs big losers
      { field: 'tail_ratio', operator: 'GREATER_THAN', value: 2.5 },

      // Copyability: still profitable with 30s delay
      { field: 'omega_lag_30s', operator: 'GREATER_THAN', value: 2.0 },

      // Overall performance
      { field: 'omega_ratio', operator: 'GREATER_THAN', value: 2.5 },
    ],
    orderBy: { field: 'tail_ratio', direction: 'DESC' },
    limit: 50,
  });

  console.log(`Found ${result.data.length} wallets in ${result.executionTimeMs}ms`);

  // Calculate average metrics
  const avgTailRatio = result.data.reduce((sum, w: any) => sum + (w.tail_ratio || 0), 0) / result.data.length;
  const avgOmegaLag = result.data.reduce((sum, w: any) => sum + (w.omega_lag_30s || 0), 0) / result.data.length;

  console.log(`\nAverage tail ratio: ${avgTailRatio.toFixed(2)}`);
  console.log(`Average omega_lag_30s: ${avgOmegaLag.toFixed(2)}`);

  return result;
}

// ============================================================================
// Example 3: Momentum-Based Screen
// ============================================================================

/**
 * Find wallets with improving recent performance
 */
export async function example3_momentumScreen() {
  console.log('\n=== Example 3: Momentum Screen ===\n');

  const result = await walletMetricsConnector.queryWalletMetrics({
    timeWindow: '30d', // Recent window for momentum
    selectFields: [
      'omega_ratio',
      'omega_momentum_30d',
      'performance_trend_flag',
      'hot_hand_z_score',
      'ev_per_hour_capital',
    ],
    filters: [
      // Improving performance
      { field: 'performance_trend_flag', operator: 'EQUALS', value: 'Improving' },

      // Positive omega momentum
      { field: 'omega_momentum_30d', operator: 'GREATER_THAN', value: 0 },

      // Recent hot streak
      { field: 'hot_hand_z_score', operator: 'GREATER_THAN', value: 1.5 },

      // Baseline performance
      { field: 'omega_ratio', operator: 'GREATER_THAN', value: 2.0 },
    ],
    orderBy: { field: 'omega_momentum_30d', direction: 'DESC' },
    limit: 100,
  });

  console.log(`Found ${result.data.length} wallets in ${result.executionTimeMs}ms`);
  console.log('\nTop momentum wallets:');
  result.data.slice(0, 5).forEach((wallet: any, i) => {
    console.log(
      `${i + 1}. ${wallet.wallet_address}: ` +
      `Omega=${wallet.omega_ratio?.toFixed(2)}, ` +
      `Momentum=${wallet.omega_momentum_30d?.toFixed(4)}, ` +
      `Trend=${wallet.performance_trend_flag}`
    );
  });

  return result;
}

// ============================================================================
// Example 4: Capital Efficiency Screen
// ============================================================================

/**
 * Find wallets with highest expected value per hour of capital
 */
export async function example4_capitalEfficiency() {
  console.log('\n=== Example 4: Capital Efficiency ===\n');

  const result = await walletMetricsConnector.queryWalletMetrics({
    timeWindow: 'lifetime',
    selectFields: [
      'ev_per_hour_capital',
      'capital_turnover_rate',
      'avg_holding_period_hours',
      'omega_ratio',
      'resolved_bets',
    ],
    filters: [
      // High EV per hour (indexed)
      { field: 'ev_per_hour_capital', operator: 'GREATER_THAN', value: 50 },

      // Active capital deployment
      { field: 'capital_turnover_rate', operator: 'GREATER_THAN', value: 2.0 },

      // Baseline performance
      { field: 'omega_ratio', operator: 'GREATER_THAN', value: 2.0 },

      // Minimum sample
      { field: 'resolved_bets', operator: 'GREATER_THAN', value: 25 },
    ],
    orderBy: { field: 'ev_per_hour_capital', direction: 'DESC' },
    limit: 50,
  });

  console.log(`Found ${result.data.length} wallets in ${result.executionTimeMs}ms`);

  // Analyze holding periods
  const avgHoldingPeriod = result.data.reduce((sum, w: any) => sum + (w.avg_holding_period_hours || 0), 0) / result.data.length;
  const avgEVPerHour = result.data.reduce((sum, w: any) => sum + (w.ev_per_hour_capital || 0), 0) / result.data.length;

  console.log(`\nAverage holding period: ${avgHoldingPeriod.toFixed(1)} hours`);
  console.log(`Average EV/hour: $${avgEVPerHour.toFixed(2)}`);

  return result;
}

// ============================================================================
// Example 5: Percentile-Based Screen
// ============================================================================

/**
 * Find wallets in top 10% of multiple metrics
 */
export async function example5_topPercentile() {
  console.log('\n=== Example 5: Top Percentile Screen ===\n');

  const result = await walletMetricsConnector.queryWalletMetrics({
    timeWindow: 'lifetime',
    selectFields: [
      'omega_ratio',
      'tail_ratio',
      'ev_per_hour_capital',
      'resolved_bets',
    ],
    filters: [
      // Minimum sample
      { field: 'resolved_bets', operator: 'GREATER_THAN', value: 20 },

      // Top 10% in omega ratio
      { field: 'omega_ratio', operator: 'IN_PERCENTILE', value: 0.90 },

      // Top 10% in tail ratio
      { field: 'tail_ratio', operator: 'IN_PERCENTILE', value: 0.90 },
    ],
    orderBy: { field: 'omega_ratio', direction: 'DESC' },
    limit: 100,
  });

  console.log(`Found ${result.data.length} wallets in ${result.executionTimeMs}ms`);
  console.log('(Wallets in top 10% of BOTH omega and tail ratio)');

  return result;
}

// ============================================================================
// Example 6: Category Specialist Screen
// ============================================================================

/**
 * Find top Politics category specialists
 */
export async function example6_categorySpecialists() {
  console.log('\n=== Example 6: Category Specialists (Politics) ===\n');

  const result = await walletMetricsConnector.queryWalletMetricsByCategory({
    category: 'Politics',
    timeWindow: '90d',
    selectFields: [
      'omega_ratio',
      'calibration_error',
      'brier_score',
      'resolved_bets',
      'is_primary_category',
    ],
    filters: [
      // This is their primary category
      { field: 'is_primary_category', operator: 'EQUALS', value: true },

      // Minimum sample
      { field: 'resolved_bets', operator: 'GREATER_THAN', value: 15 },

      // Strong performance
      { field: 'omega_ratio', operator: 'GREATER_THAN', value: 2.5 },

      // Good calibration
      { field: 'calibration_error', operator: 'LESS_THAN', value: 0.15 },
    ],
    orderBy: { field: 'omega_ratio', direction: 'DESC' },
    limit: 50,
  });

  console.log(`Found ${result.data.length} Politics specialists in ${result.executionTimeMs}ms`);

  return result;
}

// ============================================================================
// Example 7: Risk-Adjusted Screen
// ============================================================================

/**
 * Find wallets with strong risk-adjusted returns
 */
export async function example7_riskAdjusted() {
  console.log('\n=== Example 7: Risk-Adjusted Returns ===\n');

  const result = await walletMetricsConnector.queryWalletMetrics({
    timeWindow: 'lifetime',
    selectFields: [
      'omega_ratio',
      'sortino_ratio',
      'calmar_ratio',
      'max_drawdown',
      'cvar_95',
      'resolved_bets',
    ],
    filters: [
      // Minimum sample
      { field: 'resolved_bets', operator: 'GREATER_THAN', value: 30 },

      // Strong risk-adjusted metrics
      { field: 'sortino_ratio', operator: 'GREATER_THAN', value: 2.0 },
      { field: 'calmar_ratio', operator: 'GREATER_THAN', value: 3.0 },

      // Controlled drawdowns
      { field: 'max_drawdown', operator: 'GREATER_THAN', value: -0.30 }, // Less than 30% DD
    ],
    orderBy: { field: 'sortino_ratio', direction: 'DESC' },
    limit: 50,
  });

  console.log(`Found ${result.data.length} wallets in ${result.executionTimeMs}ms`);

  return result;
}

// ============================================================================
// Example 8: Batch Query (Multiple Strategies)
// ============================================================================

/**
 * Test multiple strategies simultaneously
 */
export async function example8_batchStrategies() {
  console.log('\n=== Example 8: Batch Strategy Testing ===\n');

  const startTime = Date.now();

  const results = await walletMetricsConnector.batchQuery([
    // Strategy 1: High Omega
    {
      timeWindow: 'lifetime',
      selectFields: ['omega_ratio', 'resolved_bets'],
      filters: [
        { field: 'omega_ratio', operator: 'GREATER_THAN', value: 4.0 },
        { field: 'resolved_bets', operator: 'GREATER_THAN', value: 20 },
      ],
      limit: 100,
    },

    // Strategy 2: High Convexity
    {
      timeWindow: 'lifetime',
      selectFields: ['tail_ratio', 'omega_ratio', 'resolved_bets'],
      filters: [
        { field: 'tail_ratio', operator: 'GREATER_THAN', value: 3.0 },
        { field: 'omega_ratio', operator: 'GREATER_THAN', value: 2.0 },
        { field: 'resolved_bets', operator: 'GREATER_THAN', value: 20 },
      ],
      limit: 100,
    },

    // Strategy 3: High EV/hour
    {
      timeWindow: 'lifetime',
      selectFields: ['ev_per_hour_capital', 'omega_ratio', 'resolved_bets'],
      filters: [
        { field: 'ev_per_hour_capital', operator: 'GREATER_THAN', value: 100 },
        { field: 'omega_ratio', operator: 'GREATER_THAN', value: 2.0 },
        { field: 'resolved_bets', operator: 'GREATER_THAN', value: 20 },
      ],
      limit: 100,
    },
  ]);

  const totalTime = Date.now() - startTime;

  console.log(`Executed 3 strategies in ${totalTime}ms (parallel)`);
  console.log(`\nStrategy 1 (High Omega): ${results[0].data.length} wallets in ${results[0].executionTimeMs}ms`);
  console.log(`Strategy 2 (High Convexity): ${results[1].data.length} wallets in ${results[1].executionTimeMs}ms`);
  console.log(`Strategy 3 (High EV/hour): ${results[2].data.length} wallets in ${results[2].executionTimeMs}ms`);

  // Find wallets that match ALL three strategies
  const strategy1Wallets = new Set(results[0].data.map((w: any) => w.wallet_address));
  const strategy2Wallets = new Set(results[1].data.map((w: any) => w.wallet_address));
  const strategy3Wallets = new Set(results[2].data.map((w: any) => w.wallet_address));

  const allThreeStrategies = [...strategy1Wallets].filter(
    (addr) => strategy2Wallets.has(addr) && strategy3Wallets.has(addr)
  );

  console.log(`\nWallets matching ALL 3 strategies: ${allThreeStrategies.length}`);

  return results;
}

// ============================================================================
// Example 9: Explain Query Performance
// ============================================================================

/**
 * Analyze query execution plan
 */
export async function example9_explainQuery() {
  console.log('\n=== Example 9: Query Execution Plan ===\n');

  const plan = await walletMetricsConnector.explainQuery({
    timeWindow: 'lifetime',
    selectFields: ['omega_ratio', 'tail_ratio'],
    filters: [
      { field: 'omega_ratio', operator: 'GREATER_THAN', value: 3.0 },
      { field: 'resolved_bets', operator: 'GREATER_THAN', value: 20 },
    ],
    limit: 100,
  });

  console.log('Execution Plan:');
  console.log(plan);

  return plan;
}

// ============================================================================
// Example 10: Advanced Filtering
// ============================================================================

/**
 * Complex multi-condition filtering with BETWEEN and NULL checks
 */
export async function example10_advancedFiltering() {
  console.log('\n=== Example 10: Advanced Filtering ===\n');

  const result = await walletMetricsConnector.queryWalletMetrics({
    timeWindow: '90d',
    selectFields: [
      'omega_ratio',
      'win_rate',
      'avg_holding_period_hours',
      'resolved_bets',
    ],
    filters: [
      // Minimum sample
      { field: 'resolved_bets', operator: 'GREATER_THAN', value: 25 },

      // Omega in specific range
      { field: 'omega_ratio', operator: 'BETWEEN', value: [2.5, 5.0] },

      // Win rate between 40-60% (balanced)
      { field: 'win_rate', operator: 'BETWEEN', value: [0.40, 0.60] },

      // Must have holding period data
      { field: 'avg_holding_period_hours', operator: 'IS_NOT_NULL', value: null },
    ],
    orderBy: { field: 'omega_ratio', direction: 'DESC' },
    limit: 100,
  });

  console.log(`Found ${result.data.length} wallets in ${result.executionTimeMs}ms`);

  return result;
}

// ============================================================================
// Run All Examples
// ============================================================================

export async function runAllExamples() {
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║  ClickHouse Connector - Example Usage         ║');
  console.log('╚════════════════════════════════════════════════╝');

  try {
    await example1_topPerformers();
    await example2_convexityStrategy();
    await example3_momentumScreen();
    await example4_capitalEfficiency();
    await example5_topPercentile();
    await example6_categorySpecialists();
    await example7_riskAdjusted();
    await example8_batchStrategies();
    await example9_explainQuery();
    await example10_advancedFiltering();

    console.log('\n✅ All examples completed successfully!');
  } catch (error) {
    console.error('\n❌ Error running examples:', error);
    throw error;
  }
}

// ============================================================================
// Export for use in other modules
// ============================================================================

export const examples = {
  topPerformers: example1_topPerformers,
  convexityStrategy: example2_convexityStrategy,
  momentumScreen: example3_momentumScreen,
  capitalEfficiency: example4_capitalEfficiency,
  topPercentile: example5_topPercentile,
  categorySpecialists: example6_categorySpecialists,
  riskAdjusted: example7_riskAdjusted,
  batchStrategies: example8_batchStrategies,
  explainQuery: example9_explainQuery,
  advancedFiltering: example10_advancedFiltering,
};
