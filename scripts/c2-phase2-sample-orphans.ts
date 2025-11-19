import { clickhouse } from '../lib/clickhouse/client'

async function sampleOrphans() {
  console.log('📊 C2 Phase 2: Sampling V3 Orphans for fact_trades_clean Test\n')

  // Drop temp table if exists
  console.log('Dropping any existing sample table...')
  await clickhouse.query({ query: 'DROP TABLE IF EXISTS tmp_c2_orphan_sample_100k' })

  // Create sample using MergeTree (Memory engine gets lost between connections)
  console.log('Sampling 100k orphans from pm_trades_canonical_v3 (this may take a moment)...')
  await clickhouse.command({
    query: `
      CREATE TABLE tmp_c2_orphan_sample_100k
      ENGINE = MergeTree()
      ORDER BY trade_id AS
      SELECT
        trade_id,
        transaction_hash,
        wallet_address,
        outcome_index_v3,
        timestamp,
        toYYYYMM(timestamp) AS month
      FROM pm_trades_canonical_v3
      WHERE condition_id_norm_v3 = ''
      ORDER BY rand()
      LIMIT 100000
    `
  })

  // Verify sample
  const sampleStatsResult = await clickhouse.query({
    query: `
      SELECT
        count() AS total_sample,
        count(DISTINCT transaction_hash) AS unique_txs,
        count(DISTINCT month) AS months_covered,
        min(timestamp) AS earliest,
        max(timestamp) AS latest
      FROM tmp_c2_orphan_sample_100k
    `,
    format: 'JSONEachRow'
  })

  const sampleStats = await sampleStatsResult.json()
  const stats = sampleStats[0]
  console.log('\n✅ Sample Created:')
  console.log('  Total orphans:', stats.total_sample.toLocaleString())
  console.log('  Unique tx_hashes:', stats.unique_txs.toLocaleString())
  console.log('  Months covered:', stats.months_covered)
  console.log('  Date range:', stats.earliest, 'to', stats.latest)

  // Month breakdown
  const monthBreakdownResult = await clickhouse.query({
    query: `
      SELECT
        month,
        count() AS orphan_count,
        round(100.0 * count() / 100000, 2) AS pct_of_sample
      FROM tmp_c2_orphan_sample_100k
      GROUP BY month
      ORDER BY month DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  })

  const monthBreakdown = await monthBreakdownResult.json()
  console.log('\nSample Distribution by Month:')
  monthBreakdown.forEach((row: any) => {
    console.log(`  ${row.month}: ${row.orphan_count.toLocaleString()} orphans (${row.pct_of_sample}% of sample)`)
  })

  console.log('\n✅ Ready for Phase 2B: Testing fact_trades_clean joins')
}

sampleOrphans().catch(console.error)
