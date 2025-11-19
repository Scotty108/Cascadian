#!/usr/bin/env npx tsx

/**
 * SIMPLE ERC1155 RECOVERY: Match trades to condition_ids using BEST JOIN
 *
 * Key insight: The simple LEFT JOIN on tx_hash works (24.7% match rate)
 * The many-to-many problem exists but can be handled with deduplication:
 * - Use ROW_NUMBER() to pick ONE condition_id per trade
 * - Prefer the transfer that matches wallet_address
 * - Fall back to first log_index if still ambiguous
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('SIMPLE ERC1155 RECOVERY: Using tx_hash JOIN + Deduplication')
  console.log('='.repeat(100))

  // Step 1: Test on a SMALL sample first
  console.log('\n[STEP 1] Testing simple JOIN + dedup on small sample (100 trades)...\n')

  const testQuery = `
    WITH erc1155_decoded AS (
      -- Decode ERC1155 token_ids: token_id = (condition_id << 8) | outcome_index
      SELECT
        tx_hash,
        log_index,
        from_address,
        to_address,
        block_timestamp,
        leftPad(lowerUTF8(hex(intDiv(CAST(token_id AS UInt256), 256))), 64, '0') as condition_id_decoded
      FROM erc1155_transfers
      WHERE length(token_id) > 10 AND token_id NOT LIKE '0x%'
    ),
    trades_with_join AS (
      SELECT
        t.trade_id,
        t.wallet_address,
        t.transaction_hash,
        t.outcome_index,
        t.condition_id as original_condition_id,
        e.condition_id_decoded,
        e.from_address,
        e.to_address,
        CASE
          WHEN e.condition_id_decoded IS NOT NULL THEN 'MATCHED'
          ELSE 'NO_MATCH'
        END as match_status,
        -- Ranking: prefer transfers where wallet is involved (from or to)
        ROW_NUMBER() OVER (
          PARTITION BY t.transaction_hash
          ORDER BY
            -- Prefer transfers involving the trade's wallet
            CASE
              WHEN lower(t.wallet_address) = lower(e.from_address) THEN 0
              WHEN lower(t.wallet_address) = lower(e.to_address) THEN 1
              ELSE 2
            END,
            -- Then prefer earliest log_index
            e.log_index
        ) as dedup_rank
      FROM (
        SELECT * FROM trades_raw
        WHERE condition_id = ''
        LIMIT 100
      ) t
      LEFT JOIN erc1155_decoded e ON
        t.transaction_hash = e.tx_hash
    )
    SELECT
      *
    FROM trades_with_join
    WHERE dedup_rank = 1
  `

  try {
    const testResults = await (await clickhouse.query({
      query: testQuery,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log(`Results: ${testResults.length} trades processed`)

    let recovered = 0
    let noMatch = 0

    for (const row of testResults) {
      if (row.match_status === 'MATCHED' && row.condition_id_decoded) {
        recovered++
      } else {
        noMatch++
      }
    }

    console.log(`  ✅ Successfully recovered: ${recovered}`)
    console.log(`  ❌ No match found: ${noMatch}`)
    console.log(`  Recovery rate: ${((recovered / testResults.length) * 100).toFixed(1)}%`)

    if (recovered > 0) {
      console.log('\n[Sample Recovered Trades]')
      let shown = 0
      for (let i = 0; i < testResults.length && shown < 5; i++) {
        const row = testResults[i]
        if (row.match_status === 'MATCHED' && row.condition_id_decoded) {
          shown++
          console.log(`\n  [${shown}] Trade: ${row.trade_id.substring(0, 12)}...`)
          console.log(`      Wallet: ${row.wallet_address.substring(0, 12)}...`)
          console.log(`      tx_hash: ${row.transaction_hash.substring(0, 12)}...`)
          console.log(`      Transfer FROM: ${row.from_address.substring(0, 12)}...`)
          console.log(`      Transfer TO: ${row.to_address.substring(0, 12)}...`)
          console.log(`      Recovered condition: ${row.condition_id_decoded.substring(0, 16)}...`)
          console.log(`      Dedup rank: ${row.dedup_rank}`)
        }
      }
    }

  } catch (e: any) {
    console.error('  ❌ Test query failed:', e.message)
    return
  }

  console.log('\n' + '='.repeat(100))
}

main().catch(e => console.error('Fatal error:', e))
