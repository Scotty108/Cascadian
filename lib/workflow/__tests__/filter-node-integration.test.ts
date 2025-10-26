/**
 * Filter Node Integration Tests
 *
 * Task Group 6: Filter Executor Logic
 * Integration tests for the updated executeFilterNode function
 * with backward compatibility for legacy filters
 */

import { executeNodeByType } from '../node-executors';
import type { ExecutionContext } from '@/types/workflow';

describe('Filter Node Integration', () => {
  const mockContext: ExecutionContext = {
    workflowId: 'test-workflow-123',
    executionId: 'test-execution-456',
    userId: 'test-user',
  };

  const sampleMarkets = [
    {
      id: 'market-1',
      title: 'Will Trump win 2024?',
      category: 'Politics',
      volume: 150000,
    },
    {
      id: 'market-2',
      title: 'Bitcoin to $100k?',
      category: 'Crypto',
      volume: 250000,
    },
    {
      id: 'market-3',
      title: 'Will Biden win?',
      category: 'Politics',
      volume: 80000,
    },
  ];

  describe('Enhanced Filter (V2)', () => {
    it('should execute enhanced filter with AND logic', async () => {
      const config = {
        version: 2,
        conditions: [
          {
            id: 'cond-1',
            field: 'category',
            operator: 'EQUALS',
            value: 'Politics',
            fieldType: 'string',
          },
          {
            id: 'cond-2',
            field: 'volume',
            operator: 'GREATER_THAN',
            value: 100000,
            fieldType: 'number',
          },
        ],
        logic: 'AND',
      };

      const result = await executeNodeByType('filter', config, { markets: sampleMarkets }, mockContext);

      expect(result.filtered).toHaveLength(1);
      expect(result.filtered[0].id).toBe('market-1');
      expect(result.filter_failures).toBeDefined();
      expect(result.filter_failures['market-2']).toContain('category');
    });

    it('should execute enhanced filter with OR logic', async () => {
      const config = {
        version: 2,
        conditions: [
          {
            id: 'cond-1',
            field: 'category',
            operator: 'EQUALS',
            value: 'Crypto',
            fieldType: 'string',
          },
          {
            id: 'cond-2',
            field: 'volume',
            operator: 'GREATER_THAN',
            value: 200000,
            fieldType: 'number',
          },
        ],
        logic: 'OR',
      };

      const result = await executeNodeByType('filter', config, { markets: sampleMarkets }, mockContext);

      expect(result.filtered).toHaveLength(1); // Only market-2 matches (both conditions)
      expect(result.filtered[0].id).toBe('market-2');
    });

    it('should track filter failures for debugging', async () => {
      const config = {
        version: 2,
        conditions: [
          {
            id: 'cond-1',
            field: 'volume',
            operator: 'GREATER_THAN',
            value: 200000,
            fieldType: 'number',
          },
        ],
        logic: 'AND',
      };

      const result = await executeNodeByType('filter', config, { markets: sampleMarkets }, mockContext);

      expect(result.filtered).toHaveLength(1);
      expect(result.filter_failures).toBeDefined();
      expect(result.filter_failures['market-1']).toBe('volume (150000) <= 200000');
      expect(result.filter_failures['market-3']).toBe('volume (80000) <= 200000');
    });
  });

  describe('Legacy Filter (Backward Compatibility)', () => {
    it('should execute legacy filter with old config format', async () => {
      const config = {
        conditions: [
          {
            field: 'category',
            operator: 'eq',
            value: 'Politics',
          },
        ],
      };

      const result = await executeNodeByType('filter', config, { markets: sampleMarkets }, mockContext);

      expect(result.filtered).toHaveLength(2); // market-1 and market-3
      expect(result.count).toBe(2);
      expect(result.original_count).toBe(3);
      expect(result.filter_failures).toBeUndefined(); // Legacy doesn't track failures
    });

    it('should handle legacy operators (eq, gt, lt, etc.)', async () => {
      const config = {
        conditions: [
          {
            field: 'volume',
            operator: 'gt',
            value: 100000,
          },
        ],
      };

      const result = await executeNodeByType('filter', config, { markets: sampleMarkets }, mockContext);

      expect(result.filtered).toHaveLength(2); // market-1 and market-2
    });

    it('should handle empty conditions array in legacy mode', async () => {
      const config = {
        conditions: [],
      };

      const result = await executeNodeByType('filter', config, { markets: sampleMarkets }, mockContext);

      expect(result.filtered).toHaveLength(3); // All markets pass through
    });
  });

  describe('Edge Cases', () => {
    it('should handle non-array input data', async () => {
      const config = {
        version: 2,
        conditions: [
          {
            id: 'cond-1',
            field: 'category',
            operator: 'EQUALS',
            value: 'Politics',
            fieldType: 'string',
          },
        ],
        logic: 'AND',
      };

      const singleMarket = sampleMarkets[0];
      const result = await executeNodeByType('filter', config, singleMarket, mockContext);

      expect(result.filtered).toHaveLength(1);
      expect(result.filtered[0].id).toBe('market-1');
    });

    it('should handle empty input data', async () => {
      const config = {
        version: 2,
        conditions: [
          {
            id: 'cond-1',
            field: 'category',
            operator: 'EQUALS',
            value: 'Politics',
            fieldType: 'string',
          },
        ],
        logic: 'AND',
      };

      const result = await executeNodeByType('filter', config, { markets: [] }, mockContext);

      expect(result.filtered).toHaveLength(0);
      expect(result.filter_failures).toEqual({});
    });
  });
});
