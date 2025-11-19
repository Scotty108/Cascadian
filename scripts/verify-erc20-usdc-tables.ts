#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function verifyERC20() {
  const client = getClickHouseClient()
  
  try {
    console.log('\n💵 USDC / ERC20 TRANSFER TABLES\n')
    
    // Check erc20_transfers_staging
    const stagingResult = await client.query({
      query: `
        SELECT 
          count() as total_rows,
          uniq(from_address) as unique_from,
          uniq(to_address) as unique_to,
          min(block_timestamp) as earliest,
          max(block_timestamp) as latest
        FROM default.erc20_transfers_staging
        LIMIT 1
      `,
      format: 'JSONEachRow'
    })
    const staging = await stagingResult.json<any>()
    
    console.log('1️⃣ ERC20_TRANSFERS_STAGING (The 388M table!)')
    console.log(`   Total rows: ${parseInt(staging[0].total_rows).toLocaleString()}`)
    console.log(`   Unique from addresses: ${parseInt(staging[0].unique_from).toLocaleString()}`)
    console.log(`   Unique to addresses: ${parseInt(staging[0].unique_to).toLocaleString()}`)
    console.log(`   Date range: ${staging[0].earliest} → ${staging[0].latest}`)
    
    // Check erc20_transfers_decoded
    const decodedResult = await client.query({
      query: `
        SELECT count() as total_rows
        FROM default.erc20_transfers_decoded
      `,
      format: 'JSONEachRow'
    })
    const decoded = await decodedResult.json<any>()
    
    console.log('\n2️⃣ ERC20_TRANSFERS_DECODED')
    console.log(`   Total rows: ${parseInt(decoded[0].total_rows).toLocaleString()}`)
    console.log(`   Purpose: Likely filtered/decoded USDC transfers`)
    
    // Check erc20_transfers (final?)
    const finalResult = await client.query({
      query: `
        SELECT count() as total_rows
        FROM default.erc20_transfers
      `,
      format: 'JSONEachRow'
    })
    const final = await finalResult.json<any>()
    
    console.log('\n3️⃣ ERC20_TRANSFERS')
    console.log(`   Total rows: ${parseInt(final[0].total_rows).toLocaleString()}`)
    console.log(`   Purpose: Final/production table?`)
    
    console.log('\n📊 RELATIONSHIP TO OTHER DATA:')
    console.log(`   ERC20 transfers are USDC payment movements`)
    console.log(`   ERC1155 transfers are conditional token (shares) movements`)
    console.log(`   CLOB fills are order book trades`)
    console.log(`   \n   These are THREE SEPARATE data streams:`)
    console.log(`   - USDC money flows (ERC20): ${parseInt(staging[0].total_rows).toLocaleString()} transfers`)
    console.log(`   - Share token flows (ERC1155): 61,379,951 transfers`)
    console.log(`   - Trade executions (CLOB): 37,267,385 fills`)
    
  } catch (error: any) {
    console.error('Error:', error.message)
  } finally {
    await client.close()
  }
}

verifyERC20()
