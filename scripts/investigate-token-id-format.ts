#!/usr/bin/env npx tsx
/**
 * Investigate the actual token_id format in erc1155_transfers
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function investigate() {
  console.log('Investigating token_id format')
  console.log('='.repeat(80))

  // Get some trades WITH condition_id
  console.log('\n📝 Sample trades WITH condition_id:')
  const goodTradesResult = await clickhouse.query({
    query: `
      SELECT
        transaction_hash,
        condition_id,
        market_id
      FROM trades_raw
      WHERE condition_id != '' AND condition_id IS NOT NULL
      LIMIT 5
    `,
    format: 'JSONEachRow'
  })
  const goodTrades = await goodTradesResult.json<any>()
  console.table(goodTrades)

  // Match these to erc1155_transfers
  console.log('\n🔗 Matching erc1155 transfers for these trades:')
  for (const trade of goodTrades.slice(0, 2)) {
    const erc1155Result = await clickhouse.query({
      query: `
        SELECT
          tx_hash,
          token_id,
          from_address,
          to_address,
          value
        FROM erc1155_transfers
        WHERE lower(tx_hash) = lower('${trade.transaction_hash}')
      `,
      format: 'JSONEachRow'
    })
    const transfers = await erc1155Result.json<any>()

    console.log(`\nTrade condition_id: ${trade.condition_id}`)
    console.log(`Transaction: ${trade.transaction_hash}`)
    console.log('Associated ERC1155 transfers:')
    console.table(transfers)

    // Try different extraction strategies
    if (transfers.length > 0) {
      const tokenId = transfers[0].token_id
      console.log(`\nToken ID: ${tokenId}`)
      console.log(`Length: ${tokenId.length}`)

      // The token_id is stored as DECIMAL, not hex!
      // We need to convert it
      console.log('\nExtraction attempts:')
      console.log(`  Raw value: ${tokenId}`)

      // Convert to hex
      const hexTokenId = '0x' + BigInt(tokenId).toString(16).padStart(64, '0')
      console.log(`  As hex: ${hexTokenId}`)
      console.log(`  Extracted condition_id: ${hexTokenId.slice(2, 66)}`)
      console.log(`  Actual condition_id: ${trade.condition_id}`)
      console.log(`  Match: ${hexTokenId.slice(2, 66).toLowerCase() === trade.condition_id.toLowerCase()}`)
    }
  }

  // Check if there's a better table to use
  console.log('\n🔍 Checking ctf_token_map:')
  const ctfMapResult = await clickhouse.query({
    query: `
      SELECT
        token_id,
        condition_id_norm,
        outcome_index,
        market_id
      FROM ctf_token_map
      WHERE condition_id_norm != ''
      LIMIT 5
    `,
    format: 'JSONEachRow'
  })
  const ctfMap = await ctfMapResult.json<any>()
  console.table(ctfMap)

  console.log('\n='.repeat(80))
}

investigate().catch(console.error)
