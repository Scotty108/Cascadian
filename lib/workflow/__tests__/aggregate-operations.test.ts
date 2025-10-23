/**
 * AGGREGATE OPERATIONS TESTS
 *
 * Tests for Transform Node aggregate operations
 */

import { executeNodeByType } from '../node-executors'
import type { ExecutionContext } from '@/types/workflow'

// Mock context for testing
const mockContext: ExecutionContext = {
  workflowId: 'test-workflow',
  executionId: 'test-execution',
  startTime: Date.now(),
  outputs: new Map(),
  globalState: {},
  watchlists: new Map(),
  variables: {},
}

// Sample market data for testing
const sampleMarkets = [
  { id: 1, category: 'Politics', volume: 100000, price: 0.65 },
  { id: 2, category: 'Politics', volume: 250000, price: 0.52 },
  { id: 3, category: 'Crypto', volume: 75000, price: 0.45 },
  { id: 4, category: 'Crypto', volume: 125000, price: 0.70 },
  { id: 5, category: 'Sports', volume: 50000, price: 0.80 },
]

describe('Aggregate Operations', () => {
  describe('Simple Aggregates (No Grouping)', () => {
    test('COUNT: should count total rows', async () => {
      const result = await executeNodeByType(
        'transform',
        {
          operations: [
            {
              type: 'aggregate',
              config: {
                operation: 'count',
              },
            },
          ],
        },
        sampleMarkets,
        mockContext
      )

      expect(result.transformed).toHaveLength(1)
      expect(result.transformed[0].result).toBe(5)
      expect(result.transformed[0].operation).toBe('count')
    })

    test('SUM: should sum values in a field', async () => {
      const result = await executeNodeByType(
        'transform',
        {
          operations: [
            {
              type: 'aggregate',
              config: {
                operation: 'sum',
                field: 'volume',
              },
            },
          ],
        },
        sampleMarkets,
        mockContext
      )

      expect(result.transformed).toHaveLength(1)
      expect(result.transformed[0].result).toBe(600000) // 100k + 250k + 75k + 125k + 50k
      expect(result.transformed[0].field).toBe('volume')
    })

    test('AVG: should calculate average value', async () => {
      const result = await executeNodeByType(
        'transform',
        {
          operations: [
            {
              type: 'aggregate',
              config: {
                operation: 'avg',
                field: 'price',
              },
            },
          ],
        },
        sampleMarkets,
        mockContext
      )

      expect(result.transformed).toHaveLength(1)
      expect(result.transformed[0].result).toBeCloseTo(0.624, 2) // (0.65 + 0.52 + 0.45 + 0.70 + 0.80) / 5
    })

    test('MIN: should find minimum value', async () => {
      const result = await executeNodeByType(
        'transform',
        {
          operations: [
            {
              type: 'aggregate',
              config: {
                operation: 'min',
                field: 'price',
              },
            },
          ],
        },
        sampleMarkets,
        mockContext
      )

      expect(result.transformed).toHaveLength(1)
      expect(result.transformed[0].result).toBe(0.45)
    })

    test('MAX: should find maximum value', async () => {
      const result = await executeNodeByType(
        'transform',
        {
          operations: [
            {
              type: 'aggregate',
              config: {
                operation: 'max',
                field: 'volume',
              },
            },
          ],
        },
        sampleMarkets,
        mockContext
      )

      expect(result.transformed).toHaveLength(1)
      expect(result.transformed[0].result).toBe(250000)
    })
  })

  describe('Group-By Aggregates', () => {
    test('COUNT by category', async () => {
      const result = await executeNodeByType(
        'transform',
        {
          operations: [
            {
              type: 'aggregate',
              config: {
                operation: 'count',
                groupBy: 'category',
              },
            },
          ],
        },
        sampleMarkets,
        mockContext
      )

      expect(result.transformed).toHaveLength(3) // Politics, Crypto, Sports

      const politics = result.transformed.find(r => r.category === 'Politics')
      expect(politics.result).toBe(2)

      const crypto = result.transformed.find(r => r.category === 'Crypto')
      expect(crypto.result).toBe(2)

      const sports = result.transformed.find(r => r.category === 'Sports')
      expect(sports.result).toBe(1)
    })

    test('SUM volume by category', async () => {
      const result = await executeNodeByType(
        'transform',
        {
          operations: [
            {
              type: 'aggregate',
              config: {
                operation: 'sum',
                field: 'volume',
                groupBy: 'category',
              },
            },
          ],
        },
        sampleMarkets,
        mockContext
      )

      const politics = result.transformed.find(r => r.category === 'Politics')
      expect(politics.result).toBe(350000) // 100k + 250k

      const crypto = result.transformed.find(r => r.category === 'Crypto')
      expect(crypto.result).toBe(200000) // 75k + 125k

      const sports = result.transformed.find(r => r.category === 'Sports')
      expect(sports.result).toBe(50000)
    })

    test('AVG price by category', async () => {
      const result = await executeNodeByType(
        'transform',
        {
          operations: [
            {
              type: 'aggregate',
              config: {
                operation: 'avg',
                field: 'price',
                groupBy: 'category',
              },
            },
          ],
        },
        sampleMarkets,
        mockContext
      )

      const politics = result.transformed.find(r => r.category === 'Politics')
      expect(politics.result).toBeCloseTo(0.585, 2) // (0.65 + 0.52) / 2

      const crypto = result.transformed.find(r => r.category === 'Crypto')
      expect(crypto.result).toBeCloseTo(0.575, 2) // (0.45 + 0.70) / 2
    })

    test('MIN/MAX price by category', async () => {
      const minResult = await executeNodeByType(
        'transform',
        {
          operations: [
            {
              type: 'aggregate',
              config: {
                operation: 'min',
                field: 'price',
                groupBy: 'category',
              },
            },
          ],
        },
        sampleMarkets,
        mockContext
      )

      const cryptoMin = minResult.transformed.find(r => r.category === 'Crypto')
      expect(cryptoMin.result).toBe(0.45)

      const maxResult = await executeNodeByType(
        'transform',
        {
          operations: [
            {
              type: 'aggregate',
              config: {
                operation: 'max',
                field: 'price',
                groupBy: 'category',
              },
            },
          ],
        },
        sampleMarkets,
        mockContext
      )

      const cryptoMax = maxResult.transformed.find(r => r.category === 'Crypto')
      expect(cryptoMax.result).toBe(0.70)
    })
  })

  describe('Edge Cases', () => {
    test('should handle empty data', async () => {
      const result = await executeNodeByType(
        'transform',
        {
          operations: [
            {
              type: 'aggregate',
              config: {
                operation: 'sum',
                field: 'volume',
              },
            },
          ],
        },
        [],
        mockContext
      )

      expect(result.transformed).toHaveLength(1)
      expect(result.transformed[0].result).toBe(0)
      expect(result.transformed[0].count).toBe(0)
    })

    test('should handle missing field values', async () => {
      const dataWithMissing = [
        { id: 1, volume: 100 },
        { id: 2 }, // missing volume
        { id: 3, volume: 200 },
      ]

      const result = await executeNodeByType(
        'transform',
        {
          operations: [
            {
              type: 'aggregate',
              config: {
                operation: 'sum',
                field: 'volume',
              },
            },
          ],
        },
        dataWithMissing,
        mockContext
      )

      expect(result.transformed[0].result).toBe(300) // 100 + 0 + 200
    })

    test('should handle non-numeric values gracefully', async () => {
      const dataWithStrings = [
        { id: 1, volume: '100' },
        { id: 2, volume: 'invalid' },
        { id: 3, volume: '200' },
      ]

      const result = await executeNodeByType(
        'transform',
        {
          operations: [
            {
              type: 'aggregate',
              config: {
                operation: 'sum',
                field: 'volume',
              },
            },
          ],
        },
        dataWithStrings,
        mockContext
      )

      expect(result.transformed[0].result).toBe(300) // 100 + 0 + 200
    })
  })
})
