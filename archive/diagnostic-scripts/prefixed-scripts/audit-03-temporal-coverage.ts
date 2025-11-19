import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function auditTemporalCoverage() {
  console.log('=== AUDIT #3: TEMPORAL COVERAGE ===\n')

  // CLOB fills by month
  console.log('CLOB fills by month (last 12 months):')
  const clobMonthly = await clickhouse.query({
    query: `
      SELECT 
        toStartOfMonth(matched_at) as month,
        count(*) as fill_count,
        count(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as unique_markets
      FROM clob_fills
      WHERE matched_at >= now() - INTERVAL 12 MONTH
      GROUP BY month
      ORDER BY month DESC
    `,
    format: 'JSONEachRow',
  })
  const clobM = await clobMonthly.json<Array<{ month: string; fill_count: string; unique_markets: string }>>()
  clobM.forEach(m => {
    console.log('   ' + m.month + ': ' + m.fill_count + ' fills, ' + m.unique_markets + ' markets')
  })

  // Gamma resolved staleness
  console.log('\nGamma resolutions staleness:')
  const resolutionStaleness = await clickhouse.query({
    query: `
      SELECT 
        max(resolved_at) as last_resolution,
        dateDiff('day', max(resolved_at), now()) as days_stale
      FROM gamma_resolved
    `,
    format: 'JSONEachRow',
  })
  const rs = await resolutionStaleness.json<{ last_resolution: string; days_stale: string }>()
  console.log('   Last resolution:', rs[0].last_resolution)
  console.log('   Days stale:', rs[0].days_stale, 'days')

  // ERC-1155 transfers date range
  console.log('\nERC-1155 transfers timeline:')
  const erc1155Range = await clickhouse.query({
    query: `
      SELECT 
        min(timestamp) as first_transfer,
        max(timestamp) as last_transfer,
        count(*) as total_transfers
      FROM erc1155_transfers
      WHERE timestamp > 0
    `,
    format: 'JSONEachRow',
  })
  const e1155 = await erc1155Range.json<{ first_transfer: string; last_transfer: string; total_transfers: string }>()
  console.log('   First transfer:', e1155[0].first_transfer)
  console.log('   Last transfer:', e1155[0].last_transfer)
  console.log('   Total transfers:', e1155[0].total_transfers)

  // Check for zero timestamps
  const zeroTs = await clickhouse.query({
    query: 'SELECT count(*) as zero_ts FROM erc1155_transfers WHERE timestamp = 0',
    format: 'JSONEachRow',
  })
  const zt = await zeroTs.json<{ zero_ts: string }>()
  console.log('   Zero timestamps:', zt[0].zero_ts)

  // CLOB fills per day (last 30 days)
  console.log('\nCLOB fills per day (last 30 days):')
  const dailyFills = await clickhouse.query({
    query: `
      SELECT 
        toDate(matched_at) as day,
        count(*) as fills
      FROM clob_fills
      WHERE matched_at >= now() - INTERVAL 30 DAY
      GROUP BY day
      ORDER BY day DESC
      LIMIT 30
    `,
    format: 'JSONEachRow',
  })
  const df = await dailyFills.json<Array<{ day: string; fills: string }>>()
  df.forEach(d => {
    const fillCount = parseInt(d.fills)
    const bar = fillCount > 0 ? '█'.repeat(Math.min(20, Math.ceil(fillCount / 10000))) : '░'
    console.log('   ' + d.day + ': ' + d.fills.padStart(7) + ' ' + bar)
  })
}

auditTemporalCoverage()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err)
    process.exit(1)
  })
