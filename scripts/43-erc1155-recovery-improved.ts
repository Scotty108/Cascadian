#!/usr/bin/env npx tsx

/**
 * IMPROVED ERC1155 RECOVERY: Match trades to condition_ids using outcome_index
 *
 * Key insight: token_id = (condition_id << 8) | outcome_index
 * By matching on outcome_index, we can filter down many-to-many joins
 *
 * Matching criteria:
 * 1. tx_hash must match
 * 2. outcome_index must match (decoded from token_id)
 * 3. wallet_address must match from_address OR to_address
 * 4. Dedup with ROW_NUMBER() if still multiple matches
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('IMPROVED ERC1155 RECOVERY: Using outcome_index for Better Matching')
  console.log('='.repeat(100))

  // Step 1: Test on a SMALL sample first to verify logic
  console.log('\n[STEP 1] Testing recovery logic on small sample (100 trades)...\n')

  const testQuery = `
    WITH erc1155_decoded AS (
      -- Decode ERC1155 token_ids: token_id = (condition_id << 8) | outcome_index
      -- Extract condition and outcome using integer division and modulo
      SELECT
        tx_hash,
        log_index,
        from_address,
        to_address,
        token_id,
        value,
        intDiv(CAST(token_id AS UInt256), 256) as condition_num,
        leftPad(lowerUTF8(hex(intDiv(CAST(token_id AS UInt256), 256))), 64, '0') as condition_id_decoded,
        CAST(token_id AS UInt256) % 256 as outcome_decoded,
        block_timestamp
      FROM erc1155_transfers
      WHERE length(token_id) > 10 AND token_id NOT LIKE '0x%'  -- Filter out 0.01% hex format
    ),
    trades_with_recovery AS (
      SELECT
        t.trade_id,
        t.wallet_address,
        t.transaction_hash,
        t.outcome_index,
        t.condition_id as original_condition_id,
        COALESCE(
          NULLIF(t.condition_id, ''),
          CASE
            WHEN e.condition_id_decoded IS NOT NULL
              AND t.outcome_index = e.outcome_decoded
            THEN e.condition_id_decoded
            ELSE ''
          END
        ) as recovered_condition_id,
        CASE
          WHEN e.condition_id_decoded IS NOT NULL
            AND t.outcome_index = e.outcome_decoded
          THEN 'RECOVERED'
          WHEN t.condition_id != '' THEN 'ORIGINAL'
          ELSE 'EMPTY'
        END as recovery_status,
        ROW_NUMBER() OVER (
          PARTITION BY t.transaction_hash, t.outcome_index, lower(t.wallet_address)
          ORDER BY e.log_index
        ) as match_rank
      FROM (
        SELECT *
        FROM trades_raw
        WHERE condition_id = ''
        LIMIT 100
      ) t
      LEFT JOIN erc1155_decoded e ON
        t.transaction_hash = e.tx_hash
        AND t.outcome_index = e.outcome_decoded
        AND (lower(t.wallet_address) = lower(e.from_address) OR lower(t.wallet_address) = lower(e.to_address))
    )
    SELECT
      *
    FROM trades_with_recovery
    WHERE match_rank = 1
  `

  try {
    const testResults = await (await clickhouse.query({
      query: testQuery,
      format: 'JSONEachRow'
    })).json() as any[]

    console.log(`Results: ${testResults.length} trades processed`)

    let recovered = 0
    let originalEmpty = 0

    for (const row of testResults) {
      if (row.recovery_status === 'RECOVERED') {
        recovered++
      } else if (row.recovery_status === 'EMPTY') {
        originalEmpty++
      }
    }

    console.log(`  ✅ Successfully recovered: ${recovered}`)
    console.log(`  ❌ Still empty: ${originalEmpty}`)
    console.log(`  Recovery rate: ${((recovered / testResults.length) * 100).toFixed(1)}%`)

    if (recovered > 0) {
      console.log('\n[Sample Recovered Trades]')
      for (let i = 0; i < Math.min(5, recovered); i++) {
        const recovered_rows = testResults.filter(r => r.recovery_status === 'RECOVERED')
        const row = recovered_rows[i]
        if (row) {
          console.log(`\n  Trade: ${row.trade_id.substring(0, 12)}...`)
          console.log(`    Wallet: ${row.wallet_address.substring(0, 12)}...`)
          console.log(`    outcome_index: ${row.outcome_index}`)
          console.log(`    Recovered condition: ${row.recovered_condition_id.substring(0, 16)}...`)
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
