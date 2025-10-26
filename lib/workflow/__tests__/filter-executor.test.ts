/**
 * Filter Executor Tests
 *
 * Task Group 6: Filter Executor Logic
 * Tests for enhanced multi-condition filter execution with AND/OR logic
 */

import { executeFilterV2, FilterFailures } from '../filter-executor-v2';
import type { FilterCondition, FilterLogic } from '@/lib/strategy-builder/types';

describe('Filter Executor V2', () => {
  // Sample market data for testing
  const sampleMarkets = [
    {
      id: 'market-1',
      title: 'Will Trump win the 2024 election?',
      category: 'Politics',
      tags: ['election', 'trump', 'usa'],
      volume: 150000,
      liquidity: 50000,
      currentPrice: 0.65,
      endDate: '2024-11-05',
    },
    {
      id: 'market-2',
      title: 'Will Bitcoin reach $100k by end of year?',
      category: 'Crypto',
      tags: ['bitcoin', 'crypto', 'price'],
      volume: 250000,
      liquidity: 75000,
      currentPrice: 0.45,
      endDate: '2024-12-31',
    },
    {
      id: 'market-3',
      title: 'Will Biden win reelection?',
      category: 'Politics',
      tags: ['election', 'biden', 'usa'],
      volume: 80000,
      liquidity: 30000,
      currentPrice: 0.35,
      endDate: '2024-11-05',
    },
    {
      id: 'market-4',
      title: 'Ethereum to surpass Bitcoin market cap?',
      category: 'Crypto',
      tags: ['ethereum', 'bitcoin', 'crypto'],
      volume: 120000,
      liquidity: 40000,
      currentPrice: 0.15,
      endDate: '2025-12-31',
    },
    {
      id: 'market-5',
      title: 'Will SpaceX land on Mars by 2030?',
      category: 'Science',
      tags: ['spacex', 'mars', 'space'],
      volume: 90000,
      liquidity: 35000,
      currentPrice: 0.25,
      endDate: '2030-12-31',
    },
  ];

  describe('Multi-Condition AND Logic', () => {
    it('should filter markets matching ALL conditions with AND logic', () => {
      const conditions: FilterCondition[] = [
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
      ];

      const result = executeFilterV2(sampleMarkets, conditions, 'AND');

      expect(result.filtered).toHaveLength(1);
      expect(result.filtered[0].id).toBe('market-1'); // Only market-1 matches both conditions
      expect(result.filterFailures).toBeDefined();
    });

    it('should filter with three AND conditions (category, volume, price)', () => {
      const conditions: FilterCondition[] = [
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
          operator: 'GREATER_THAN_OR_EQUAL',
          value: 120000,
          fieldType: 'number',
        },
        {
          id: 'cond-3',
          field: 'currentPrice',
          operator: 'LESS_THAN',
          value: 0.50,
          fieldType: 'number',
        },
      ];

      const result = executeFilterV2(sampleMarkets, conditions, 'AND');

      expect(result.filtered).toHaveLength(2); // market-2 and market-4
      expect(result.filtered.map(m => m.id)).toContain('market-2');
      expect(result.filtered.map(m => m.id)).toContain('market-4');
    });
  });

  describe('Multi-Condition OR Logic', () => {
    it('should filter markets matching ANY condition with OR logic', () => {
      const conditions: FilterCondition[] = [
        {
          id: 'cond-1',
          field: 'category',
          operator: 'EQUALS',
          value: 'Science',
          fieldType: 'string',
        },
        {
          id: 'cond-2',
          field: 'volume',
          operator: 'GREATER_THAN',
          value: 200000,
          fieldType: 'number',
        },
      ];

      const result = executeFilterV2(sampleMarkets, conditions, 'OR');

      expect(result.filtered).toHaveLength(2); // market-2 (high volume) and market-5 (Science)
      expect(result.filtered.map(m => m.id)).toContain('market-2');
      expect(result.filtered.map(m => m.id)).toContain('market-5');
    });

    it('should return all markets when OR with loose conditions', () => {
      const conditions: FilterCondition[] = [
        {
          id: 'cond-1',
          field: 'volume',
          operator: 'GREATER_THAN',
          value: 50000,
          fieldType: 'number',
        },
        {
          id: 'cond-2',
          field: 'category',
          operator: 'IN',
          value: ['Politics', 'Crypto', 'Science'],
          fieldType: 'string',
        },
      ];

      const result = executeFilterV2(sampleMarkets, conditions, 'OR');

      expect(result.filtered).toHaveLength(5); // All markets match at least one condition
    });
  });

  describe('Category Filtering', () => {
    it('should filter by single category using EQUALS', () => {
      const conditions: FilterCondition[] = [
        {
          id: 'cond-1',
          field: 'category',
          operator: 'EQUALS',
          value: 'Crypto',
          fieldType: 'string',
        },
      ];

      const result = executeFilterV2(sampleMarkets, conditions, 'AND');

      expect(result.filtered).toHaveLength(2);
      expect(result.filtered.every(m => m.category === 'Crypto')).toBe(true);
    });

    it('should filter by multiple categories using IN operator', () => {
      const conditions: FilterCondition[] = [
        {
          id: 'cond-1',
          field: 'category',
          operator: 'IN',
          value: ['Politics', 'Science'],
          fieldType: 'string',
        },
      ];

      const result = executeFilterV2(sampleMarkets, conditions, 'AND');

      expect(result.filtered).toHaveLength(3); // market-1, market-3, market-5
      expect(result.filtered.every(m => ['Politics', 'Science'].includes(m.category))).toBe(true);
    });
  });

  describe('Tag Filtering', () => {
    it('should filter markets that contain a specific tag using CONTAINS', () => {
      const conditions: FilterCondition[] = [
        {
          id: 'cond-1',
          field: 'tags',
          operator: 'CONTAINS',
          value: 'bitcoin',
          fieldType: 'array',
        },
      ];

      const result = executeFilterV2(sampleMarkets, conditions, 'AND');

      expect(result.filtered).toHaveLength(2); // market-2 and market-4
      expect(result.filtered.every(m => m.tags.includes('bitcoin'))).toBe(true);
    });

    it('should filter markets with any of specified tags using IN operator on arrays', () => {
      const conditions: FilterCondition[] = [
        {
          id: 'cond-1',
          field: 'tags',
          operator: 'IN',
          value: ['trump', 'biden'],
          fieldType: 'array',
        },
      ];

      const result = executeFilterV2(sampleMarkets, conditions, 'AND');

      expect(result.filtered).toHaveLength(2); // market-1 and market-3
    });
  });

  describe('Text Search Filtering', () => {
    it('should filter using CONTAINS operator (case-insensitive by default)', () => {
      const conditions: FilterCondition[] = [
        {
          id: 'cond-1',
          field: 'title',
          operator: 'CONTAINS',
          value: 'bitcoin',
          fieldType: 'string',
          caseSensitive: false,
        },
      ];

      const result = executeFilterV2(sampleMarkets, conditions, 'AND');

      expect(result.filtered).toHaveLength(2); // market-2 and market-4
      expect(result.filtered.every(m => m.title.toLowerCase().includes('bitcoin'))).toBe(true);
    });

    it('should filter using STARTS_WITH operator', () => {
      const conditions: FilterCondition[] = [
        {
          id: 'cond-1',
          field: 'title',
          operator: 'STARTS_WITH',
          value: 'Will',
          fieldType: 'string',
        },
      ];

      const result = executeFilterV2(sampleMarkets, conditions, 'AND');

      expect(result.filtered).toHaveLength(4); // market-1, market-2, market-3, market-5
      expect(result.filtered.every(m => m.title.startsWith('Will'))).toBe(true);
    });

    it('should respect case-sensitive flag for text search', () => {
      const conditions: FilterCondition[] = [
        {
          id: 'cond-1',
          field: 'title',
          operator: 'CONTAINS',
          value: 'Bitcoin', // Capital B
          fieldType: 'string',
          caseSensitive: true,
        },
      ];

      const result = executeFilterV2(sampleMarkets, conditions, 'AND');

      expect(result.filtered).toHaveLength(2); // market-2 and market-4 have "Bitcoin"
    });
  });

  describe('BETWEEN Operator', () => {
    it('should filter numeric values using BETWEEN operator', () => {
      const conditions: FilterCondition[] = [
        {
          id: 'cond-1',
          field: 'volume',
          operator: 'BETWEEN',
          value: [80000, 150000],
          fieldType: 'number',
        },
      ];

      const result = executeFilterV2(sampleMarkets, conditions, 'AND');

      expect(result.filtered).toHaveLength(4); // market-1, market-3, market-4, market-5 (all in range)
      expect(result.filtered.every(m => m.volume >= 80000 && m.volume <= 150000)).toBe(true);
    });
  });

  describe('All Operators Support', () => {
    it('should support NOT_EQUALS operator', () => {
      const conditions: FilterCondition[] = [
        {
          id: 'cond-1',
          field: 'category',
          operator: 'NOT_EQUALS',
          value: 'Politics',
          fieldType: 'string',
        },
      ];

      const result = executeFilterV2(sampleMarkets, conditions, 'AND');

      expect(result.filtered).toHaveLength(3); // All except Politics markets
      expect(result.filtered.every(m => m.category !== 'Politics')).toBe(true);
    });

    it('should support DOES_NOT_CONTAIN operator for text', () => {
      const conditions: FilterCondition[] = [
        {
          id: 'cond-1',
          field: 'title',
          operator: 'DOES_NOT_CONTAIN',
          value: 'election',
          fieldType: 'string',
        },
      ];

      const result = executeFilterV2(sampleMarkets, conditions, 'AND');

      expect(result.filtered).toHaveLength(3); // All markets without "election" in title
      expect(result.filtered.every(m => !m.title.toLowerCase().includes('election'))).toBe(true);
    });

    it('should support ENDS_WITH operator', () => {
      const conditions: FilterCondition[] = [
        {
          id: 'cond-1',
          field: 'title',
          operator: 'ENDS_WITH',
          value: '?',
          fieldType: 'string',
        },
      ];

      const result = executeFilterV2(sampleMarkets, conditions, 'AND');

      expect(result.filtered).toHaveLength(5); // All markets end with "?"
    });
  });

  describe('Filter Failure Tracking', () => {
    it('should track which condition failed for filtered-out items', () => {
      const conditions: FilterCondition[] = [
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
      ];

      const result = executeFilterV2(sampleMarkets, conditions, 'AND');

      expect(result.filterFailures).toBeDefined();

      // market-2, market-4, market-5 should fail category check
      expect(result.filterFailures['market-2']).toContain('category');
      expect(result.filterFailures['market-4']).toContain('category');

      // market-3 should fail volume check
      expect(result.filterFailures['market-3']).toContain('volume');
      expect(result.filterFailures['market-3']).toContain('80000');
    });

    it('should provide detailed failure reasons in human-readable format', () => {
      const conditions: FilterCondition[] = [
        {
          id: 'cond-1',
          field: 'volume',
          operator: 'GREATER_THAN',
          value: 200000,
          fieldType: 'number',
        },
      ];

      const result = executeFilterV2(sampleMarkets, conditions, 'AND');

      // Check that failure reasons are descriptive
      expect(result.filterFailures['market-1']).toBe('volume (150000) <= 200000');
      expect(result.filterFailures['market-3']).toBe('volume (80000) <= 200000');
    });
  });

  describe('Performance and Edge Cases', () => {
    it('should handle empty conditions array (no filtering)', () => {
      const result = executeFilterV2(sampleMarkets, [], 'AND');

      expect(result.filtered).toHaveLength(5); // All markets pass through
      expect(result.filterFailures).toEqual({});
    });

    it('should handle empty input data', () => {
      const conditions: FilterCondition[] = [
        {
          id: 'cond-1',
          field: 'category',
          operator: 'EQUALS',
          value: 'Politics',
          fieldType: 'string',
        },
      ];

      const result = executeFilterV2([], conditions, 'AND');

      expect(result.filtered).toHaveLength(0);
      expect(result.filterFailures).toEqual({});
    });

    it('should handle large datasets efficiently (performance check)', () => {
      // Create 1000 test markets
      const largeDataset = Array.from({ length: 1000 }, (_, i) => ({
        id: `market-${i}`,
        title: `Market ${i}`,
        category: i % 3 === 0 ? 'Politics' : i % 3 === 1 ? 'Crypto' : 'Science',
        tags: ['tag1', 'tag2'],
        volume: Math.random() * 500000,
        liquidity: Math.random() * 100000,
        currentPrice: Math.random(),
        endDate: '2024-12-31',
      }));

      const conditions: FilterCondition[] = [
        {
          id: 'cond-1',
          field: 'volume',
          operator: 'GREATER_THAN',
          value: 250000,
          fieldType: 'number',
        },
      ];

      const startTime = Date.now();
      const result = executeFilterV2(largeDataset, conditions, 'AND');
      const executionTime = Date.now() - startTime;

      expect(executionTime).toBeLessThan(100); // Should execute in less than 100ms
      expect(result.filtered.length).toBeGreaterThan(0);
    });
  });
});
