import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function runComprehensiveAudit() {
  const results: any = {};
  
  console.log('========================================')
  console.log('CASCADIAN DATABASE COVERAGE AUDIT')
  console.log('Coverage Auditor Agent (C1)')
  console.log('Generated:', new Date().toISOString())
  console.log('========================================\n')

  // AUDIT #1: CLOB COVERAGE
  console.log('=== AUDIT #1: CLOB COVERAGE ===\n')
  
  const totalMarketsRes = await clickhouse.query({
    query: 'SELECT count(*) as total FROM gamma_markets',
    format: 'JSONEachRow',
  })
  const totalMarkets = parseInt((await totalMarketsRes.json<{ total: string }>())[0].total)
  
  const marketsWithFillsRes = await clickhouse.query({
    query: `SELECT count(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as count FROM clob_fills`,
    format: 'JSONEachRow',
  })
  const marketsWithFills = parseInt((await marketsWithFillsRes.json<{ count: string }>())[0].count)
  
  const coveragePct = (marketsWithFills / totalMarkets * 100).toFixed(2)
  const missingCount = totalMarkets - marketsWithFills
  
  results.clob = {
    totalMarkets,
    marketsWithFills,
    coveragePct: parseFloat(coveragePct),
    missingCount
  }
  
  console.log('Total markets in catalog:', totalMarkets)
  console.log('Markets with fills:', marketsWithFills)
  console.log('Coverage:', coveragePct + '%')
  console.log('Missing:', missingCount, 'markets')

  const totalFillsRes = await clickhouse.query({
    query: 'SELECT count(*) as total FROM clob_fills',
    format: 'JSONEachRow',
  })
  const totalFills = parseInt((await totalFillsRes.json<{ total: string }>())[0].total)
  results.clob.totalFills = totalFills
  console.log('\nTotal clob_fills rows:', totalFills)

  const dateRangeRes = await clickhouse.query({
    query: `SELECT min(timestamp) as first_fill, max(timestamp) as last_fill, dateDiff('day', min(timestamp), max(timestamp)) as days_covered FROM clob_fills`,
    format: 'JSONEachRow',
  })
  const dateRange = (await dateRangeRes.json<{ first_fill: string; last_fill: string; days_covered: string }>())[0]
  results.clob.dateRange = dateRange
  
  console.log('\nDate range:')
  console.log('   First fill:', dateRange.first_fill)
  console.log('   Last fill:', dateRange.last_fill)
  console.log('   Days covered:', dateRange.days_covered)

  // AUDIT #2: JOIN SUCCESS RATES
  console.log('\n=== AUDIT #2: CRITICAL JOIN SUCCESS RATES ===\n')

  console.log('Join #1: clob_fills -> market_key_map')
  const join1Res = await clickhouse.query({
    query: `
      SELECT 
        count(*) as total_fills,
        countIf(mkm.condition_id IS NOT NULL) as matched,
        round(100.0 * matched / total_fills, 2) as success_pct
      FROM clob_fills cf
      LEFT JOIN market_key_map mkm 
        ON lower(replaceAll(cf.condition_id, '0x', '')) = mkm.condition_id
    `,
    format: 'JSONEachRow',
  })
  const j1 = (await join1Res.json<{ total_fills: string; matched: string; success_pct: string }>())[0]
  results.join_clob_to_mkm = {
    totalFills: parseInt(j1.total_fills),
    matched: parseInt(j1.matched),
    successPct: parseFloat(j1.success_pct)
  }
  console.log('   Total fills:', j1.total_fills)
  console.log('   Matched:', j1.matched)
  console.log('   Success rate:', j1.success_pct + '%')

  console.log('\nJoin #2: gamma_markets -> gamma_resolved')
  const join2Res = await clickhouse.query({
    query: `
      SELECT 
        count(*) as total_markets,
        countIf(gr.cid IS NOT NULL) as resolved_markets,
        round(100.0 * resolved_markets / total_markets, 2) as resolution_pct
      FROM gamma_markets gm
      LEFT JOIN gamma_resolved gr ON gm.condition_id = gr.cid
    `,
    format: 'JSONEachRow',
  })
  const j2 = (await join2Res.json<{ total_markets: string; resolved_markets: string; resolution_pct: string }>())[0]
  results.join_markets_to_resolved = {
    totalMarkets: parseInt(j2.total_markets),
    resolved: parseInt(j2.resolved_markets),
    resolutionPct: parseFloat(j2.resolution_pct)
  }
  console.log('   Total markets:', j2.total_markets)
  console.log('   Resolved:', j2.resolved_markets)
  console.log('   Resolution rate:', j2.resolution_pct + '%')

  console.log('\nJoin #3: Traded markets -> gamma_resolved')
  const join3Res = await clickhouse.query({
    query: `
      SELECT 
        count(*) as traded_markets,
        countIf(gr.cid IS NOT NULL) as resolved_traded,
        round(100.0 * resolved_traded / traded_markets, 2) as pct
      FROM (
        SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid 
        FROM clob_fills
      ) cf
      LEFT JOIN gamma_resolved gr ON cf.cid = gr.cid
    `,
    format: 'JSONEachRow',
  })
  const j3 = (await join3Res.json<{ traded_markets: string; resolved_traded: string; pct: string }>())[0]
  results.join_traded_to_resolved = {
    tradedMarkets: parseInt(j3.traded_markets),
    resolved: parseInt(j3.resolved_traded),
    resolutionPct: parseFloat(j3.pct)
  }
  console.log('   Traded markets:', j3.traded_markets)
  console.log('   With resolutions:', j3.resolved_traded)
  console.log('   Resolution rate:', j3.pct + '%')

  // AUDIT #3: RESOLUTION COVERAGE
  console.log('\n=== AUDIT #3: RESOLUTION COVERAGE ===\n')

  const totalResRes = await clickhouse.query({
    query: `SELECT count(*) as total, count(DISTINCT cid) as unique_conditions FROM gamma_resolved`,
    format: 'JSONEachRow',
  })
  const totalRes = (await totalResRes.json<{ total: string; unique_conditions: string }>())[0]
  results.resolutions = {
    totalRows: parseInt(totalRes.total),
    uniqueConditions: parseInt(totalRes.unique_conditions)
  }
  console.log('Total rows in gamma_resolved:', totalRes.total)
  console.log('Unique condition_ids:', totalRes.unique_conditions)

  const stalenessRes = await clickhouse.query({
    query: `
      SELECT 
        max(fetched_at) as last_resolution,
        dateDiff('day', max(fetched_at), now()) as days_stale
      FROM gamma_resolved
    `,
    format: 'JSONEachRow',
  })
  const staleness = (await stalenessRes.json<{ last_resolution: string; days_stale: string }>())[0]
  results.resolutions.lastResolution = staleness.last_resolution
  results.resolutions.daysStale = parseInt(staleness.days_stale)
  
  console.log('\nResolution staleness:')
  console.log('   Last resolution:', staleness.last_resolution)
  console.log('   Days stale:', staleness.days_stale, 'days')

  // AUDIT #4: ERC-1155 COVERAGE
  console.log('\n=== AUDIT #4: ERC-1155 TOKEN COVERAGE ===\n')

  const erc1155Res = await clickhouse.query({
    query: `
      SELECT 
        count(*) as total_transfers,
        count(DISTINCT token_id) as unique_token_ids
      FROM erc1155_transfers
    `,
    format: 'JSONEachRow',
  })
  const erc1155 = (await erc1155Res.json<{ total_transfers: string; unique_token_ids: string }>())[0]
  results.erc1155 = {
    totalTransfers: parseInt(erc1155.total_transfers),
    uniqueTokenIds: parseInt(erc1155.unique_token_ids)
  }
  console.log('Total transfers:', erc1155.total_transfers)
  console.log('Unique token_ids:', erc1155.unique_token_ids)

  const erc1155RangeRes = await clickhouse.query({
    query: `
      SELECT 
        min(block_timestamp) as first_transfer,
        max(block_timestamp) as last_transfer
      FROM erc1155_transfers
      WHERE block_timestamp > toDateTime('1970-01-01')
    `,
    format: 'JSONEachRow',
  })
  const erc1155Range = (await erc1155RangeRes.json<{ first_transfer: string; last_transfer: string }>())[0]
  results.erc1155.dateRange = erc1155Range
  console.log('Date range:', erc1155Range.first_transfer, 'to', erc1155Range.last_transfer)

  const zeroTsRes = await clickhouse.query({
    query: 'SELECT count(*) as zero_ts FROM erc1155_transfers WHERE block_timestamp = toDateTime(0)',
    format: 'JSONEachRow',
  })
  const zeroTs = (await zeroTsRes.json<{ zero_ts: string }>())[0]
  results.erc1155.zeroTimestamps = parseInt(zeroTs.zero_ts)
  console.log('Zero timestamps:', zeroTs.zero_ts)

  // AUDIT #5: TEMPORAL COVERAGE
  console.log('\n=== AUDIT #5: TEMPORAL COVERAGE ===\n')

  console.log('CLOB fills by month (last 12 months):')
  const clobMonthlyRes = await clickhouse.query({
    query: `
      SELECT 
        toStartOfMonth(timestamp) as month,
        count(*) as fill_count,
        count(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as unique_markets
      FROM clob_fills
      WHERE timestamp >= now() - INTERVAL 12 MONTH
      GROUP BY month
      ORDER BY month DESC
    `,
    format: 'JSONEachRow',
  })
  const clobMonthly = await clobMonthlyRes.json<Array<{ month: string; fill_count: string; unique_markets: string }>>()
  results.temporal = { clobMonthly }
  
  clobMonthly.forEach(m => {
    const fillCount = parseInt(m.fill_count)
    const bar = fillCount > 0 ? '█'.repeat(Math.min(20, Math.ceil(fillCount / 100000))) : '░'
    console.log('   ' + m.month + ': ' + m.fill_count.padStart(8) + ' fills ' + bar)
  })

  console.log('\n========================================')
  console.log('AUDIT COMPLETE')
  console.log('========================================\n')
  
  return results
}

runComprehensiveAudit()
  .then((results) => {
    console.log('\nSummary of findings saved to results object')
    process.exit(0)
  })
  .catch((err) => {
    console.error('Error:', err)
    process.exit(1)
  })
