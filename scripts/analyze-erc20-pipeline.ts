#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function analyzeERC20() {
  const client = getClickHouseClient()
  
  try {
    console.log('\n💵 USDC / ERC20 PIPELINE ANALYSIS\n')
    
    // staging (raw logs)
    const stagingResult = await client.query({
      query: 'SELECT count() as c FROM default.erc20_transfers_staging',
      format: 'JSONEachRow'
    })
    const staging = await stagingResult.json<any>()
    
    // decoded (parsed transfers)
    const decodedSchema = await client.query({
      query: 'SELECT * FROM default.erc20_transfers_decoded LIMIT 1',
      format: 'JSONEachRow'
    })
    const decodedFields = await decodedSchema.json<any>()
    
    const decodedResult = await client.query({
      query: 'SELECT count() as c FROM default.erc20_transfers_decoded',
      format: 'JSONEachRow'
    })
    const decoded = await decodedResult.json<any>()
    
    // final
    const finalResult = await client.query({
      query: 'SELECT count() as c FROM default.erc20_transfers',
      format: 'JSONEachRow'
    })
    const final = await finalResult.json<any>()
    
    console.log('📊 ERC20 (USDC) PIPELINE:')
    console.log('')
    console.log(`1. erc20_transfers_staging: ${parseInt(staging[0].c).toLocaleString()} rows`)
    console.log(`   - Raw blockchain logs (not decoded)`)
    console.log(`   - Fields: tx_hash, block_number, address, topics, data`)
    console.log(`   - Purpose: Raw ingestion from Alchemy`)
    console.log('')
    console.log(`2. erc20_transfers_decoded: ${parseInt(decoded[0].c).toLocaleString()} rows`)
    console.log(`   - Decoded transfer events`)
    console.log(`   - Fields: ${Object.keys(decodedFields[0]).join(', ')}`)
    console.log(`   - Reduction: ${(parseInt(decoded[0].c) / parseInt(staging[0].c) * 100).toFixed(1)}% of staging`)
    console.log('')
    console.log(`3. erc20_transfers: ${parseInt(final[0].c).toLocaleString()} rows`)
    console.log(`   - Final/filtered table`)
    console.log(`   - Reduction: ${(parseInt(final[0].c) / parseInt(decoded[0].c) * 100).toFixed(1)}% of decoded`)
    console.log('')
    console.log('💡 USDC ROLE IN SYSTEM:')
    console.log('   - Tracks money flows (USDC payments)')
    console.log('   - Used for: Trade settlement verification, wallet cash flows')
    console.log('   - Complements: CLOB (trade execution) + ERC1155 (share tokens)')
    
  } catch (error: any) {
    console.error('Error:', error.message)
  } finally {
    await client.close()
  }
}

analyzeERC20()
