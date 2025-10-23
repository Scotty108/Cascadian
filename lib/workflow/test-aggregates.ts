/**
 * TEST AGGREGATES
 *
 * Simple test script to validate aggregate operations
 * Run with: tsx lib/workflow/test-aggregates.ts
 */

import { executeNodeByType } from './node-executors'
import type { ExecutionContext } from '@/types/workflow'

// Mock context
const mockContext: ExecutionContext = {
  workflowId: 'test-workflow',
  executionId: 'test-execution',
  startTime: Date.now(),
  outputs: new Map(),
  globalState: {},
  watchlists: new Map(),
  variables: {},
}

// Sample data
const sampleMarkets = [
  { id: 1, category: 'Politics', volume: 100000, price: 0.65 },
  { id: 2, category: 'Politics', volume: 250000, price: 0.52 },
  { id: 3, category: 'Crypto', volume: 75000, price: 0.45 },
  { id: 4, category: 'Crypto', volume: 125000, price: 0.70 },
  { id: 5, category: 'Sports', volume: 50000, price: 0.80 },
]

async function runTests() {
  console.log('🧪 Testing Aggregate Operations\n')

  try {
    // Test 1: COUNT
    console.log('Test 1: COUNT')
    const countResult = await executeNodeByType(
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
    console.log('✅ Result:', countResult.transformed[0])
    console.log('   Expected: 5, Got:', countResult.transformed[0].result)
    console.log('')

    // Test 2: SUM
    console.log('Test 2: SUM volume')
    const sumResult = await executeNodeByType(
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
    console.log('✅ Result:', sumResult.transformed[0])
    console.log('   Expected: 600000, Got:', sumResult.transformed[0].result)
    console.log('')

    // Test 3: AVG
    console.log('Test 3: AVG price')
    const avgResult = await executeNodeByType(
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
    console.log('✅ Result:', avgResult.transformed[0])
    console.log('   Expected: ~0.624, Got:', avgResult.transformed[0].result)
    console.log('')

    // Test 4: MIN
    console.log('Test 4: MIN price')
    const minResult = await executeNodeByType(
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
    console.log('✅ Result:', minResult.transformed[0])
    console.log('   Expected: 0.45, Got:', minResult.transformed[0].result)
    console.log('')

    // Test 5: MAX
    console.log('Test 5: MAX volume')
    const maxResult = await executeNodeByType(
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
    console.log('✅ Result:', maxResult.transformed[0])
    console.log('   Expected: 250000, Got:', maxResult.transformed[0].result)
    console.log('')

    // Test 6: GROUP BY COUNT
    console.log('Test 6: COUNT by category')
    const groupCountResult = await executeNodeByType(
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
    console.log('✅ Result:', groupCountResult.transformed)
    console.log('   Groups:', groupCountResult.transformed.length)
    groupCountResult.transformed.forEach((g: any) => {
      console.log(`   ${g.category}: ${g.result} markets`)
    })
    console.log('')

    // Test 7: GROUP BY SUM
    console.log('Test 7: SUM volume by category')
    const groupSumResult = await executeNodeByType(
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
    console.log('✅ Result:', groupSumResult.transformed)
    groupSumResult.transformed.forEach((g: any) => {
      console.log(`   ${g.category}: $${g.result.toLocaleString()} total volume`)
    })
    console.log('')

    // Test 8: GROUP BY AVG
    console.log('Test 8: AVG price by category')
    const groupAvgResult = await executeNodeByType(
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
    console.log('✅ Result:', groupAvgResult.transformed)
    groupAvgResult.transformed.forEach((g: any) => {
      console.log(`   ${g.category}: $${g.result.toFixed(3)} avg price`)
    })
    console.log('')

    console.log('✅ All tests passed!')
  } catch (error) {
    console.error('❌ Test failed:', error)
    process.exit(1)
  }
}

runTests()
