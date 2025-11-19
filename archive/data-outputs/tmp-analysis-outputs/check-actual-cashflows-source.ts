#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

const TARGET_WALLET = '0x7f3c8979d0afa00007bae4747d5347122af05613'
const PHANTOM_CONDITION = '03f1de7caf5b3f972d403b83c78011c8ab500b158122322f61b68f8e6fd90ba4'

async function checkSource() {
  const client = getClickHouseClient()
  try {
    console.log('\nChecking trade_cashflows_v3 structure...\n')
    
    const schemaResult = await client.query({
      query: 'DESCRIBE TABLE trade_cashflows_v3',
      format: 'JSONEachRow'
    })
    const schema = await schemaResult.json<any[]>()
    
    console.log('Schema:')
    schema.forEach(col => console.log(`  ${col.name}: ${col.type}`))
    
    // Sample one phantom row to see the data
    console.log('\nSample phantom cashflow row:\n')
    
    const sampleResult = await client.query({
      query: `
        SELECT *
        FROM trade_cashflows_v3
        WHERE lower(replaceAll(condition_id_norm, '0x', '')) = '${PHANTOM_CONDITION}'
          AND lower(wallet) = lower('${TARGET_WALLET}')
        LIMIT 1
      `,
      format: 'JSONEachRow'
    })
    const sample = await sampleResult.json<any[]>()
    
    if (sample.length > 0) {
      console.log(JSON.stringify(sample[0], null, 2))
      console.log('')
    }
    
    // Check if there's a wallet column mismatch
    console.log('Checking wallet representation in trade_cashflows_v3...\n')
    
    const walletCheckResult = await client.query({
      query: `
        SELECT DISTINCT wallet
        FROM trade_cashflows_v3
        WHERE lower(replaceAll(condition_id_norm, '0x', '')) = '${PHANTOM_CONDITION}'
        LIMIT 20
      `,
      format: 'JSONEachRow'
    })
    const wallets = await walletCheckResult.json<any[]>()
    
    console.log(`Found ${wallets.length} unique wallets for this condition_id:`)
    wallets.forEach((w: any, idx: number) => {
      const isTarget = w.wallet.toLowerCase() === TARGET_WALLET.toLowerCase()
      console.log(`${idx + 1}. ${w.wallet} ${isTarget ? '⬅️  TARGET' : ''}`)
    })
    console.log('')
    
  } catch (error: any) {
    console.error('Error:', error.message)
  } finally {
    await client.close()
  }
}

checkSource()
