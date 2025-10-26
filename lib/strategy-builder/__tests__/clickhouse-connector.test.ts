/**
 * ClickHouse Connector Tests
 *
 * Test suite for the ClickHouse connector query builder and executor.
 *
 * @module lib/strategy-builder/__tests__/clickhouse-connector.test
 */

import { describe, it, expect } from '@jest/globals';
import { buildQuery, METRIC_FIELD_MAP } from '../clickhouse-connector';
import type { WalletMetricsQueryBuilder } from '../clickhouse-connector';

// ============================================================================
// Query Builder Tests
// ============================================================================

describe('ClickHouse Query Builder', () => {
  describe('buildQuery', () => {
    it('should build simple SELECT with single filter', () => {
      const config: WalletMetricsQueryBuilder = {
        table: 'wallet_metrics_complete',
        filters: [
          { field: 'omega_ratio', operator: 'GREATER_THAN', value: 3.0 },
        ],
      };

      const query = buildQuery(config);

      expect(query).toContain('FROM wallet_metrics_complete');
      expect(query).toContain('PREWHERE metric_2_omega_net > 3.0');
    });

    it('should apply partition pruning with timeWindow', () => {
      const config: WalletMetricsQueryBuilder = {
        table: 'wallet_metrics_complete',
        timeWindow: 'lifetime',
        filters: [
          { field: 'omega_ratio', operator: 'GREATER_THAN', value: 3.0 },
        ],
      };

      const query = buildQuery(config);

      expect(query).toContain("WHERE window = 'lifetime'");
    });

    it('should apply column pruning with selectFields', () => {
      const config: WalletMetricsQueryBuilder = {
        table: 'wallet_metrics_complete',
        selectFields: ['omega_ratio', 'tail_ratio'],
        filters: [],
      };

      const query = buildQuery(config);

      expect(query).toContain('SELECT');
      expect(query).toContain('wallet_address');
      expect(query).toContain('metric_2_omega_net AS omega_ratio');
      expect(query).toContain('metric_60_tail_ratio AS tail_ratio');
      expect(query).not.toContain('SELECT *');
    });

    it('should handle multiple filters with AND logic', () => {
      const config: WalletMetricsQueryBuilder = {
        table: 'wallet_metrics_complete',
        filters: [
          { field: 'omega_ratio', operator: 'GREATER_THAN', value: 3.0 },
          { field: 'resolved_bets', operator: 'GREATER_THAN', value: 20 },
          { field: 'tail_ratio', operator: 'GREATER_THAN', value: 2.0 },
        ],
      };

      const query = buildQuery(config);

      expect(query).toContain('metric_2_omega_net > 3.0');
      expect(query).toContain('metric_22_resolved_bets > 20');
      expect(query).toContain('metric_60_tail_ratio > 2.0');
    });

    it('should handle ORDER BY', () => {
      const config: WalletMetricsQueryBuilder = {
        table: 'wallet_metrics_complete',
        filters: [],
        orderBy: { field: 'omega_ratio', direction: 'DESC' },
      };

      const query = buildQuery(config);

      expect(query).toContain('ORDER BY metric_2_omega_net DESC');
    });

    it('should handle LIMIT and OFFSET', () => {
      const config: WalletMetricsQueryBuilder = {
        table: 'wallet_metrics_complete',
        filters: [],
        limit: 100,
        offset: 50,
      };

      const query = buildQuery(config);

      expect(query).toContain('LIMIT 100');
      expect(query).toContain('OFFSET 50');
    });

    it('should handle BETWEEN operator', () => {
      const config: WalletMetricsQueryBuilder = {
        table: 'wallet_metrics_complete',
        filters: [
          { field: 'omega_ratio', operator: 'BETWEEN', value: [2.0, 5.0] },
        ],
      };

      const query = buildQuery(config);

      expect(query).toContain('metric_2_omega_net BETWEEN 2 AND 5');
    });

    it('should handle IN operator', () => {
      const config: WalletMetricsQueryBuilder = {
        table: 'wallet_metrics_complete',
        filters: [
          { field: 'performance_trend_flag', operator: 'IN', value: ['Improving', 'Stable'] },
        ],
      };

      const query = buildQuery(config);

      expect(query).toContain("metric_85_performance_trend_flag IN ('Improving', 'Stable')");
    });

    it('should handle NULL checks', () => {
      const config: WalletMetricsQueryBuilder = {
        table: 'wallet_metrics_complete',
        filters: [
          { field: 'omega_ratio', operator: 'IS_NOT_NULL', value: null },
        ],
      };

      const query = buildQuery(config);

      expect(query).toContain('metric_2_omega_net IS NOT NULL');
    });

    it('should handle percentile operator', () => {
      const config: WalletMetricsQueryBuilder = {
        table: 'wallet_metrics_complete',
        filters: [
          { field: 'omega_ratio', operator: 'IN_PERCENTILE', value: 0.90 },
        ],
      };

      const query = buildQuery(config);

      expect(query).toContain('metric_2_omega_net >= quantile(0.9)(metric_2_omega_net)');
    });

    it('should handle category filtering on by_category table', () => {
      const config: WalletMetricsQueryBuilder = {
        table: 'wallet_metrics_by_category',
        category: 'Politics',
        filters: [],
      };

      const query = buildQuery(config);

      expect(query).toContain("category = 'Politics'");
    });

    it('should disable PREWHERE when usePrewhere=false', () => {
      const config: WalletMetricsQueryBuilder = {
        table: 'wallet_metrics_complete',
        filters: [
          { field: 'omega_ratio', operator: 'GREATER_THAN', value: 3.0 },
        ],
        usePrewhere: false,
      };

      const query = buildQuery(config);

      expect(query).not.toContain('PREWHERE');
      expect(query).toContain('WHERE metric_2_omega_net > 3.0');
    });

    it('should combine PREWHERE and WHERE correctly', () => {
      const config: WalletMetricsQueryBuilder = {
        table: 'wallet_metrics_complete',
        timeWindow: 'lifetime',
        filters: [
          { field: 'omega_ratio', operator: 'GREATER_THAN', value: 3.0 }, // PREWHERE candidate
          { field: 'skewness', operator: 'GREATER_THAN', value: 0.5 },    // WHERE (not indexed)
        ],
      };

      const query = buildQuery(config);

      expect(query).toContain('PREWHERE metric_2_omega_net > 3.0');
      expect(query).toContain('WHERE');
      expect(query).toContain('metric_61_skewness > 0.5');
      expect(query).toContain("window = 'lifetime'");
    });

    it('should handle string escaping in values', () => {
      const config: WalletMetricsQueryBuilder = {
        table: 'wallet_metrics_by_category',
        category: "O'Reilly's Category", // Test quote escaping
        filters: [],
      };

      const query = buildQuery(config);

      expect(query).toContain("category = 'O''Reilly''s Category'");
    });

    it('should add performance settings', () => {
      const config: WalletMetricsQueryBuilder = {
        table: 'wallet_metrics_complete',
        filters: [],
      };

      const query = buildQuery(config);

      expect(query).toContain('SETTINGS max_threads = 4');
    });
  });

  // ==========================================================================
  // Metric Field Mapping Tests
  // ==========================================================================

  describe('Metric Field Mapping', () => {
    it('should map all Phase 1 metrics', () => {
      expect(METRIC_FIELD_MAP['omega_ratio']).toBe('metric_2_omega_net');
      expect(METRIC_FIELD_MAP['sortino_ratio']).toBe('metric_5_sortino');
      expect(METRIC_FIELD_MAP['calmar_ratio']).toBe('metric_8_calmar');
      expect(METRIC_FIELD_MAP['net_pnl']).toBe('metric_9_net_pnl_usd');
      expect(METRIC_FIELD_MAP['win_rate']).toBe('metric_12_hit_rate');
      expect(METRIC_FIELD_MAP['profit_factor']).toBe('metric_4_profit_factor');
    });

    it('should map critical TIER 1 metrics', () => {
      expect(METRIC_FIELD_MAP['omega_ratio']).toBe('metric_2_omega_net');
      expect(METRIC_FIELD_MAP['omega_lag_30s']).toBe('metric_48_omega_lag_30s');
      expect(METRIC_FIELD_MAP['tail_ratio']).toBe('metric_60_tail_ratio');
      expect(METRIC_FIELD_MAP['ev_per_hour_capital']).toBe('metric_69_ev_per_hour_capital');
    });

    it('should map lag-adjusted metrics', () => {
      expect(METRIC_FIELD_MAP['omega_lag_30s']).toBe('metric_48_omega_lag_30s');
      expect(METRIC_FIELD_MAP['omega_lag_2min']).toBe('metric_49_omega_lag_2min');
      expect(METRIC_FIELD_MAP['omega_lag_5min']).toBe('metric_50_omega_lag_5min');
    });

    it('should map momentum metrics', () => {
      expect(METRIC_FIELD_MAP['omega_momentum_30d']).toBe('metric_56_omega_momentum_30d');
      expect(METRIC_FIELD_MAP['clv_momentum_30d']).toBe('metric_82_clv_momentum_30d');
      expect(METRIC_FIELD_MAP['performance_trend_flag']).toBe('metric_85_performance_trend_flag');
    });
  });

  // ==========================================================================
  // Filter Operator Tests
  // ==========================================================================

  describe('Filter Operators', () => {
    const operators: Array<[string, any, string]> = [
      ['EQUALS', 3.0, '='],
      ['NOT_EQUALS', 3.0, '!='],
      ['GREATER_THAN', 3.0, '>'],
      ['GREATER_THAN_OR_EQUAL', 3.0, '>='],
      ['LESS_THAN', 3.0, '<'],
      ['LESS_THAN_OR_EQUAL', 3.0, '<='],
    ];

    operators.forEach(([operator, value, expectedSQL]) => {
      it(`should handle ${operator} operator`, () => {
        const config: WalletMetricsQueryBuilder = {
          table: 'wallet_metrics_complete',
          filters: [
            { field: 'omega_ratio', operator: operator as any, value },
          ],
        };

        const query = buildQuery(config);
        expect(query).toContain(`metric_2_omega_net ${expectedSQL} ${value}`);
      });
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty filters', () => {
      const config: WalletMetricsQueryBuilder = {
        table: 'wallet_metrics_complete',
        filters: [],
      };

      const query = buildQuery(config);
      expect(query).toContain('SELECT *');
      expect(query).toContain('FROM wallet_metrics_complete');
      expect(query).not.toContain('WHERE');
      expect(query).not.toContain('PREWHERE');
    });

    it('should handle zero limit', () => {
      const config: WalletMetricsQueryBuilder = {
        table: 'wallet_metrics_complete',
        filters: [],
        limit: 0,
      };

      const query = buildQuery(config);
      expect(query).toContain('LIMIT 0');
    });

    it('should handle very large numbers', () => {
      const config: WalletMetricsQueryBuilder = {
        table: 'wallet_metrics_complete',
        filters: [
          { field: 'net_pnl', operator: 'GREATER_THAN', value: 1000000 },
        ],
      };

      const query = buildQuery(config);
      expect(query).toContain('1000000');
    });

    it('should handle negative values', () => {
      const config: WalletMetricsQueryBuilder = {
        table: 'wallet_metrics_complete',
        filters: [
          { field: 'max_drawdown', operator: 'GREATER_THAN', value: -0.30 },
        ],
      };

      const query = buildQuery(config);
      expect(query).toContain('-0.3');
    });

    it('should handle boolean values', () => {
      const config: WalletMetricsQueryBuilder = {
        table: 'wallet_metrics_by_category',
        filters: [
          { field: 'is_primary_category', operator: 'EQUALS', value: true },
        ],
      };

      const query = buildQuery(config);
      expect(query).toContain('is_primary_category = 1');
    });
  });
});

// ============================================================================
// Performance Optimization Tests
// ============================================================================

describe('Query Optimization', () => {
  it('should use PREWHERE for indexed columns', () => {
    const config: WalletMetricsQueryBuilder = {
      table: 'wallet_metrics_complete',
      filters: [
        { field: 'omega_ratio', operator: 'GREATER_THAN', value: 3.0 },
      ],
    };

    const query = buildQuery(config);
    expect(query).toContain('PREWHERE metric_2_omega_net > 3.0');
  });

  it('should optimize query with partition + index + column pruning', () => {
    const config: WalletMetricsQueryBuilder = {
      table: 'wallet_metrics_complete',
      timeWindow: 'lifetime',              // Partition pruning
      selectFields: ['omega_ratio'],       // Column pruning
      filters: [
        { field: 'omega_ratio', operator: 'GREATER_THAN', value: 3.0 }, // PREWHERE
      ],
      limit: 100,                          // Result limiting
    };

    const query = buildQuery(config);

    // Check all optimizations are present
    expect(query).toContain('metric_2_omega_net AS omega_ratio'); // Column pruning
    expect(query).toContain('PREWHERE metric_2_omega_net > 3.0'); // PREWHERE
    expect(query).toContain("window = 'lifetime'");               // Partition pruning
    expect(query).toContain('LIMIT 100');                         // Result limiting
    expect(query).not.toContain('SELECT *');                      // Not selecting all
  });
});

// ============================================================================
// Integration Test Helpers
// ============================================================================

/**
 * Mock test to verify connector can be instantiated
 */
describe('Connector Instantiation', () => {
  it('should export walletMetricsConnector', async () => {
    const { walletMetricsConnector } = await import('../clickhouse-connector');
    expect(walletMetricsConnector).toBeDefined();
    expect(walletMetricsConnector.queryWalletMetrics).toBeDefined();
    expect(walletMetricsConnector.queryWalletMetricsByCategory).toBeDefined();
    expect(walletMetricsConnector.batchQuery).toBeDefined();
    expect(walletMetricsConnector.explainQuery).toBeDefined();
  });
});
