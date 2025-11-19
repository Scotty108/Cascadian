import { clickhouse } from '../lib/clickhouse/client'

async function analyzeRecoverySituation() {
  console.log('=== DATA COMPLETENESS CHECK ===\n')
  
  // 1. Verify table sizes and coverage
  const tradesStats = await clickhouse.query({
    query: `
      SELECT
        count() as total_trades,
        countIf(condition_id = '') as empty_condition_id,
        countIf(condition_id != '') as has_condition_id,
        min(timestamp) as min_ts,
        max(timestamp) as max_ts
      FROM trades_raw
    `,
    format: 'JSONEachRow'
  })
  
  console.log('trades_raw coverage:')
  console.log(JSON.stringify(await tradesStats.json(), null, 2))
  
  const erc1155Stats = await clickhouse.query({
    query: `
      SELECT
        count() as total_events,
        count(DISTINCT tx_hash) as unique_txhashes,
        count(DISTINCT token_id) as unique_tokens,
        min(block_number) as min_block,
        max(block_number) as max_block,
        min(block_timestamp) as min_ts,
        max(block_timestamp) as max_ts
      FROM erc1155_transfers
    `,
    format: 'JSONEachRow'
  })
  
  console.log('\nerc1155_transfers coverage:')
  console.log(JSON.stringify(await erc1155Stats.json(), null, 2))
  
  // 2. Check block overlap between tables
  console.log('\n=== BLOCK RANGE OVERLAP ===\n')
  
  const blockOverlap = await clickhouse.query({
    query: `
      SELECT
        (SELECT min(block_number) FROM erc1155_transfers) as erc_min,
        (SELECT max(block_number) FROM erc1155_transfers) as erc_max,
        (SELECT count() FROM erc1155_transfers) as erc_total
    `,
    format: 'JSONEachRow'
  })
  
  console.log('Block overlap analysis:')
  console.log(JSON.stringify(await blockOverlap.json(), null, 2))
  
  // 3. Analyze missing condition_id trades by block range
  console.log('\n=== MISSING CONDITION_ID DISTRIBUTION ===\n')
  
  const missingByTs = await clickhouse.query({
    query: `
      SELECT
        toStartOfMonth(timestamp) as month,
        count() as total_trades,
        round(count() / (SELECT count() FROM trades_raw WHERE condition_id = '') * 100, 2) as pct_of_missing
      FROM trades_raw
      WHERE condition_id = ''
      GROUP BY month
      ORDER BY month
    `,
    format: 'JSONEachRow'
  })
  
  console.log('Missing condition_id by month:')
  for (const row of await missingByTs.json() as any[]) {
    console.log(row)
  }
  
  // 4. Check if missing trades fall OUTSIDE erc1155_transfers block range
  console.log('\n=== CRITICAL: Are missing trades OUTSIDE ERC1155 coverage? ===\n')
  
  const outsideCoverage = await clickhouse.query({
    query: `
      SELECT
        countIf(t.timestamp < (SELECT min(block_timestamp) FROM erc1155_transfers)) as trades_before_erc_coverage,
        countIf(t.timestamp > (SELECT max(block_timestamp) FROM erc1155_transfers)) as trades_after_erc_coverage,
        countIf(t.timestamp >= (SELECT min(block_timestamp) FROM erc1155_transfers)
            AND t.timestamp <= (SELECT max(block_timestamp) FROM erc1155_transfers)) as trades_within_erc_coverage
      FROM trades_raw t
      WHERE t.condition_id = ''
    `,
    format: 'JSONEachRow'
  })
  
  console.log('Missing trades vs ERC1155 block coverage:')
  console.log(JSON.stringify(await outsideCoverage.json(), null, 2))
  
  // 5. Sample missing trades to check tx_hash patterns
  console.log('\n=== SAMPLE MISSING TRADES ===\n')
  
  const sampleMissing = await clickhouse.query({
    query: `
      SELECT
        transaction_hash,
        timestamp,
        length(transaction_hash) as hash_len
      FROM trades_raw
      WHERE condition_id = ''
      ORDER BY timestamp DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  })
  
  console.log('Sample missing trades (most recent):')
  for (const row of await sampleMissing.json() as any[]) {
    console.log(row)
  }
  
  // 6. Check if tx_hash format/case differs
  console.log('\n=== TX_HASH FORMAT VALIDATION ===\n')
  
  const hashFormats = await clickhouse.query({
    query: `
      SELECT
        'trades_raw' as table_name,
        count() as total,
        countIf(startsWith(transaction_hash, '0x')) as starts_with_0x,
        countIf(length(transaction_hash) = 66) as length_66,
        countIf(transaction_hash = lower(transaction_hash)) as all_lowercase
      FROM trades_raw
      WHERE condition_id = ''

      UNION ALL

      SELECT
        'erc1155_transfers' as table_name,
        count() as total,
        countIf(startsWith(tx_hash, '0x')) as starts_with_0x,
        countIf(length(tx_hash) = 66) as length_66,
        countIf(tx_hash = lower(tx_hash)) as all_lowercase
      FROM erc1155_transfers
    `,
    format: 'JSONEachRow'
  })
  
  console.log('Hash format comparison:')
  for (const row of await hashFormats.json() as any[]) {
    console.log(row)
  }
  
  // 7. Direct JOIN test on WITHIN coverage blocks
  console.log('\n=== JOIN TEST: Missing trades WITHIN ERC1155 block range ===\n')
  
  const joinTest = await clickhouse.query({
    query: `
      SELECT
        count(DISTINCT t.transaction_hash) as missing_trades_in_range,
        count(DISTINCT e.tx_hash) as matched_hashes,
        round(count(DISTINCT e.tx_hash) / count(DISTINCT t.transaction_hash) * 100, 2) as match_rate_pct
      FROM trades_raw t
      LEFT JOIN erc1155_transfers e ON t.transaction_hash = e.tx_hash
      WHERE t.condition_id = ''
        AND t.timestamp >= (SELECT min(block_timestamp) FROM erc1155_transfers)
        AND t.timestamp <= (SELECT max(block_timestamp) FROM erc1155_transfers)
    `,
    format: 'JSONEachRow'
  })
  
  console.log('JOIN test results (missing trades within ERC1155 coverage):')
  console.log(JSON.stringify(await joinTest.json(), null, 2))
  
  console.log('\n=== ANALYSIS COMPLETE ===')
}

analyzeRecoverySituation().catch(console.error)
