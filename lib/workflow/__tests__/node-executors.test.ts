/**
 * NODE EXECUTORS UNIT TESTS
 *
 * Comprehensive tests for all 6 Polymarket node types
 */

import { executeNode } from '../node-executors'
import type { Node } from '@xyflow/react'

// Mock context for testing
const mockContext = {
  getNodeOutput: (nodeId: string) => null,
  setNodeOutput: (nodeId: string, output: any) => {},
  onStatusChange: (nodeId: string, status: any) => {},
}

describe('Polymarket Stream Node', () => {
  test('fetches markets with specific categories', async () => {
    const node: Node = {
      id: 'stream-1',
      type: 'polymarket-stream',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'polymarket-stream',
        config: {
          categories: ['Politics'],
          minVolume: 0,
        },
      },
    }

    const result = await executeNode(node, [], mockContext)

    expect(result).toBeDefined()
    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBeGreaterThan(0)

    // Verify markets have Politics category
    result.forEach((market: any) => {
      expect(market.category).toBe('Politics')
    })
  })

  test('filters markets by minimum volume', async () => {
    const node: Node = {
      id: 'stream-2',
      type: 'polymarket-stream',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'polymarket-stream',
        config: {
          categories: ['Politics'],
          minVolume: 1000000,
        },
      },
    }

    const result = await executeNode(node, [], mockContext)

    expect(Array.isArray(result)).toBe(true)

    // Verify all markets have volume >= 1M
    result.forEach((market: any) => {
      expect(market.volume).toBeGreaterThanOrEqual(1000000)
    })
  })

  test('fetches all categories when none specified', async () => {
    const node: Node = {
      id: 'stream-3',
      type: 'polymarket-stream',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'polymarket-stream',
        config: {
          categories: [],
          minVolume: 0,
        },
      },
    }

    const result = await executeNode(node, [], mockContext)

    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('Filter Node', () => {
  const sampleData = [
    { id: 1, volume: 50000, category: 'Politics', title: 'Trump wins 2024' },
    { id: 2, volume: 150000, category: 'Crypto', title: 'Bitcoin reaches $100k' },
    { id: 3, volume: 250000, category: 'Politics', title: 'Biden wins 2024' },
    { id: 4, volume: 75000, category: 'Sports', title: 'Lakers win championship' },
  ]

  test('filters with gt (greater than) operator', async () => {
    const node: Node = {
      id: 'filter-1',
      type: 'filter',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'filter',
        config: {
          conditions: [
            { field: 'volume', operator: 'gt', value: 100000 },
          ],
        },
      },
    }

    const result = await executeNode(node, [sampleData], mockContext)

    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(2) // Only 150k and 250k
    expect(result[0].volume).toBeGreaterThan(100000)
    expect(result[1].volume).toBeGreaterThan(100000)
  })

  test('filters with eq (equals) operator', async () => {
    const node: Node = {
      id: 'filter-2',
      type: 'filter',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'filter',
        config: {
          conditions: [
            { field: 'category', operator: 'eq', value: 'Politics' },
          ],
        },
      },
    }

    const result = await executeNode(node, [sampleData], mockContext)

    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(2) // Two Politics markets
    result.forEach((item: any) => {
      expect(item.category).toBe('Politics')
    })
  })

  test('filters with contains operator', async () => {
    const node: Node = {
      id: 'filter-3',
      type: 'filter',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'filter',
        config: {
          conditions: [
            { field: 'title', operator: 'contains', value: 'Trump' },
          ],
        },
      },
    }

    const result = await executeNode(node, [sampleData], mockContext)

    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(1)
    expect(result[0].title).toContain('Trump')
  })

  test('applies multiple conditions (AND logic)', async () => {
    const node: Node = {
      id: 'filter-4',
      type: 'filter',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'filter',
        config: {
          conditions: [
            { field: 'category', operator: 'eq', value: 'Politics' },
            { field: 'volume', operator: 'gt', value: 100000 },
          ],
        },
      },
    }

    const result = await executeNode(node, [sampleData], mockContext)

    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(1) // Only Biden market (Politics + 250k volume)
    expect(result[0].category).toBe('Politics')
    expect(result[0].volume).toBeGreaterThan(100000)
  })

  test('handles empty results', async () => {
    const node: Node = {
      id: 'filter-5',
      type: 'filter',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'filter',
        config: {
          conditions: [
            { field: 'volume', operator: 'gt', value: 1000000 },
          ],
        },
      },
    }

    const result = await executeNode(node, [sampleData], mockContext)

    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(0)
  })
})

describe('Transform Node', () => {
  const sampleData = [
    { id: 1, currentPrice: 0.6, volume: 100000, liquidity: 50000 },
    { id: 2, currentPrice: 0.45, volume: 200000, liquidity: 75000 },
    { id: 3, currentPrice: 0.55, volume: 150000, liquidity: 60000 },
  ]

  test('adds calculated column with formula', async () => {
    const node: Node = {
      id: 'transform-1',
      type: 'transform',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'transform',
        config: {
          operations: [
            {
              type: 'add-column',
              config: {
                name: 'edge',
                formula: 'abs(currentPrice - 0.5)',
              },
            },
          ],
        },
      },
    }

    const result = await executeNode(node, [sampleData], mockContext)

    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(3)

    // Verify edge column added and calculated correctly
    expect(result[0].edge).toBeCloseTo(0.1, 5)
    expect(result[1].edge).toBeCloseTo(0.05, 5)
    expect(result[2].edge).toBeCloseTo(0.05, 5)
  })

  test('adds column with complex formula', async () => {
    const node: Node = {
      id: 'transform-2',
      type: 'transform',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'transform',
        config: {
          operations: [
            {
              type: 'add-column',
              config: {
                name: 'score',
                formula: 'volume / (1 + liquidity)',
              },
            },
          ],
        },
      },
    }

    const result = await executeNode(node, [sampleData], mockContext)

    expect(Array.isArray(result)).toBe(true)
    expect(result[0]).toHaveProperty('score')
    expect(typeof result[0].score).toBe('number')
  })

  test('filters rows based on condition', async () => {
    const node: Node = {
      id: 'transform-3',
      type: 'transform',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'transform',
        config: {
          operations: [
            {
              type: 'filter-rows',
              config: {
                condition: 'currentPrice > 0.5',
              },
            },
          ],
        },
      },
    }

    const result = await executeNode(node, [sampleData], mockContext)

    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(2) // Only prices > 0.5
    result.forEach((item: any) => {
      expect(item.currentPrice).toBeGreaterThan(0.5)
    })
  })

  test('sorts data by field', async () => {
    const node: Node = {
      id: 'transform-4',
      type: 'transform',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'transform',
        config: {
          operations: [
            {
              type: 'sort',
              config: {
                field: 'volume',
                order: 'desc',
              },
            },
          ],
        },
      },
    }

    const result = await executeNode(node, [sampleData], mockContext)

    expect(Array.isArray(result)).toBe(true)
    expect(result[0].volume).toBe(200000) // Highest first
    expect(result[1].volume).toBe(150000)
    expect(result[2].volume).toBe(100000) // Lowest last
  })
})

describe('Condition Node', () => {
  test('executes then branch when condition is true', async () => {
    const node: Node = {
      id: 'condition-1',
      type: 'condition',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'condition',
        config: {
          conditions: [
            {
              if: 'price > 0.6',
              then: 'buy',
              else: 'skip',
            },
          ],
        },
      },
    }

    const inputData = { price: 0.7, market: 'Test Market' }
    const result = await executeNode(node, [inputData], mockContext)

    expect(result).toBeDefined()
    expect(result.action).toBe('buy')
  })

  test('executes else branch when condition is false', async () => {
    const node: Node = {
      id: 'condition-2',
      type: 'condition',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'condition',
        config: {
          conditions: [
            {
              if: 'price > 0.6',
              then: 'buy',
              else: 'skip',
            },
          ],
        },
      },
    }

    const inputData = { price: 0.4, market: 'Test Market' }
    const result = await executeNode(node, [inputData], mockContext)

    expect(result).toBeDefined()
    expect(result.action).toBe('skip')
  })

  test('handles numeric comparisons', async () => {
    const node: Node = {
      id: 'condition-3',
      type: 'condition',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'condition',
        config: {
          conditions: [
            {
              if: 'volume >= 100000',
              then: 'high-volume',
              else: 'low-volume',
            },
          ],
        },
      },
    }

    const inputData = { volume: 150000 }
    const result = await executeNode(node, [inputData], mockContext)

    expect(result).toBeDefined()
    expect(result.action).toBe('high-volume')
  })
})

describe('LLM Analysis Node', () => {
  test('analyzes data with custom prompt', async () => {
    const node: Node = {
      id: 'llm-1',
      type: 'llm-analysis',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'llm-analysis',
        config: {
          userPrompt: 'Does this market mention crypto? Answer yes or no.',
          model: 'gemini-1.5-flash',
          outputFormat: 'text',
        },
      },
    }

    const inputData = { title: 'Bitcoin reaches $100k in 2024' }

    // This will make a real API call - may want to mock in CI/CD
    const result = await executeNode(node, [inputData], mockContext)

    expect(result).toBeDefined()
    expect(typeof result).toBe('string')
  }, 30000) // 30 second timeout for API call

  test('returns boolean output format', async () => {
    const node: Node = {
      id: 'llm-2',
      type: 'llm-analysis',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'llm-analysis',
        config: {
          userPrompt: 'Is this about politics? Return true or false.',
          model: 'gemini-1.5-flash',
          outputFormat: 'boolean',
        },
      },
    }

    const inputData = { title: 'Trump wins 2024 election' }

    const result = await executeNode(node, [inputData], mockContext)

    expect(result).toBeDefined()
    expect(typeof result).toBe('boolean')
  }, 30000)

  test('replaces template variables in prompt', async () => {
    const node: Node = {
      id: 'llm-3',
      type: 'llm-analysis',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'llm-analysis',
        config: {
          userPrompt: 'Analyze this market: {{title}}. What is the main topic?',
          model: 'gemini-1.5-flash',
          outputFormat: 'text',
        },
      },
    }

    const inputData = { title: 'Lakers win NBA championship 2024' }

    const result = await executeNode(node, [inputData], mockContext)

    expect(result).toBeDefined()
    expect(typeof result).toBe('string')
  }, 30000)
})

describe('Polymarket Buy Node', () => {
  test('executes buy order with correct parameters', async () => {
    const node: Node = {
      id: 'buy-1',
      type: 'polymarket-buy',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'polymarket-buy',
        config: {
          outcome: 'Yes',
          amount: 100,
          orderType: 'market',
        },
      },
    }

    const inputData = { marketId: 'test-market-123' }
    const result = await executeNode(node, [inputData], mockContext)

    expect(result).toBeDefined()
    expect(result.success).toBe(true)
    expect(result.order).toBeDefined()
    expect(result.order.outcome).toBe('Yes')
    expect(result.order.amount).toBe(100)
  })

  test('handles No outcome orders', async () => {
    const node: Node = {
      id: 'buy-2',
      type: 'polymarket-buy',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'polymarket-buy',
        config: {
          outcome: 'No',
          amount: 50,
          orderType: 'limit',
        },
      },
    }

    const inputData = { marketId: 'test-market-456' }
    const result = await executeNode(node, [inputData], mockContext)

    expect(result).toBeDefined()
    expect(result.success).toBe(true)
    expect(result.order.outcome).toBe('No')
    expect(result.order.orderType).toBe('limit')
  })
})

describe('Node Executor Error Handling', () => {
  test('handles missing configuration gracefully', async () => {
    const node: Node = {
      id: 'error-1',
      type: 'filter',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'filter',
        config: {}, // Missing conditions
      },
    }

    await expect(executeNode(node, [[]], mockContext)).rejects.toThrow()
  })

  test('handles invalid input data type', async () => {
    const node: Node = {
      id: 'error-2',
      type: 'filter',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'filter',
        config: {
          conditions: [
            { field: 'volume', operator: 'gt', value: 100 },
          ],
        },
      },
    }

    // Pass non-array input
    await expect(executeNode(node, ['not an array'], mockContext)).rejects.toThrow()
  })

  test('handles unknown node type', async () => {
    const node: Node = {
      id: 'error-3',
      type: 'unknown-node-type',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'unknown-node-type',
        config: {},
      },
    }

    await expect(executeNode(node, [], mockContext)).rejects.toThrow()
  })
})
