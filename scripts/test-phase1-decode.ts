#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { clickhouse } from './lib/clickhouse/client'

async function test() {
  console.log('TEST 1: Validate USDC Transfer Decode\n')
  
  try {
    const result = await clickhouse.query({
      query: `
        SELECT 
          COUNT(*) as decoded_count,
          COUNT(DISTINCT from_address) as unique_senders,
          COUNT(DISTINCT to_address) as unique_receivers,
          MIN(amount) as min_amount,
          MAX(amount) as max_amount,
          AVG(amount) as avg_amount
        FROM erc20_transfers
        WHERE timestamp >= '2024-01-01'
      `,
      format: 'JSONEachRow'
    })
    
    const data = await result.json()
    const row = data[0]
    
    console.log('✓ Successfully decoded USDC transfers')
    console.log(`  Decoded count: ${row.decoded_count.toLocaleString()}`)
    console.log(`  Unique senders: ${row.unique_senders.toLocaleString()}`)
    console.log(`  Unique receivers: ${row.unique_receivers.toLocaleString()}`)
    console.log(`  Amount range: ${row.min_amount} - ${row.max_amount}`)
    console.log(`  Average amount: ${Number(row.avg_amount).toFixed(2)}`)
    
    const avgUSD = Number(row.avg_amount) / 1e6
    console.log(`\n  Average in USD: $${avgUSD.toFixed(2)}`)
    
    if (avgUSD > 0.01 && avgUSD < 1000000) {
      console.log(`  ✅ PASS: Amounts look reasonable`)
      return true
    } else {
      console.log(`  ❌ FAIL: Amounts look wrong`)
      return false
    }
  } catch (e) {
    console.error('❌ Test failed:', (e as Error).message)
    return false
  }
}

test().then(success => process.exit(success ? 0 : 1))
