import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function runAllAudits() {
  console.log('========================================')
  console.log('CASCADIAN DATABASE COVERAGE AUDIT')
  console.log('Coverage Auditor Agent (C1)')
  console.log('Generated:', new Date().toISOString())
  console.log('========================================\n')

  // AUDIT #1: CLOB COVERAGE
  console.log('=== AUDIT #1: CLOB COVERAGE ===\n')
  
  const catalogResult = await clickhouse.query({
    query: 'SELECT count(*) as total FROM gamma_markets',
    format: 'JSONEachRow',
  })
  const catalog = await catalogResult.json<{ total: string }>()
  const totalMarkets = parseInt(catalog[0].total)
  console.log('Total markets in gamma_markets:', totalMarkets)

  const fillsResult = await clickhouse.query({
    query: `SELECT count(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as markets_with_fills FROM clob_fills`,
    format: 'JSONEachRow',
  })
  const fills = await fillsResult.json<{ markets_with_fills: string }>()
  const marketsWithFills = parseInt(fills[0].markets_with_fills)
  console.log('Markets with fills:', marketsWithFills)

  const coveragePct = (marketsWithFills / totalMarkets * 100).toFixed(2)
  const missingCount = totalMarkets - marketsWithFills
  const missingPct = ((missingCount / totalMarkets) * 100).toFixed(2)

  console.log('\nCoverage:', coveragePct + '%', '(' + marketsWithFills + '/' + totalMarkets + ')')
  console.log('Missing:', missingPct + '%', '(' + missingCount + ' markets)')

  const totalFillsResult = await clickhouse.query({
    query: 'SELECT count(*) as total FROM clob_fills',
    format: 'JSONEachRow',
  })
  const totalFills = await totalFillsResult.json<{ total: string }>()
  console.log('\nTotal clob_fills rows:', totalFills[0].total)

  const dateRangeResult = await clickhouse.query({
    query: `SELECT min(timestamp) as first_fill, max(timestamp) as last_fill, dateDiff('day', min(timestamp), max(timestamp)) as days_covered FROM clob_fills`,
    format: 'JSONEachRow',
  })
  const dateRange = await dateRangeResult.json<{ first_fill: string; last_fill: string; days_covered: string }>()
  console.log('\nDate range:')
  console.log('   First fill:', dateRange[0].first_fill)
  console.log('   Last fill:', dateRange[0].last_fill)
  console.log('   Days covered:', dateRange[0].days_covered)

  // AUDIT #2: JOIN SUCCESS RATES
  console.log('\n=== AUDIT #2: CRITICAL JOIN SUCCESS RATES ===\n')

  console.log('Join #1: clob_fills -> market_key_map')
  const join1 = await clickhouse.query({
    query: `
      SELECT 
        count(*) as total_fills,
        countIf(mkm.condition_id IS NOT NULL) as matched,
        countIf(mkm.condition_id IS NULL) as unmatched,
        round(100.0 * matched / total_fills, 2) as success_pct
      FROM clob_fills cf
      LEFT JOIN market_key_map mkm 
        ON lower(replaceAll(cf.condition_id, '0x', '')) = mkm.condition_id
    `,
    format: 'JSONEachRow',
  })
  const j1 = await join1.json<{ total_fills: string; matched: string; unmatched: string; success_pct: string }>()
  console.log('   Total fills:', j1[0].total_fills)
  console.log('   Matched:', j1[0].matched)
  console.log('   Unmatched:', j1[0].unmatched)
  console.log('   Success rate:', j1[0].success_pct + '%')

  console.log('\nJoin #2: gamma_markets -> gamma_resolved')
  const join2 = await clickhouse.query({
    query: `
      SELECT 
        count(*) as total_markets,
        countIf(gr.condition_id IS NOT NULL) as resolved_markets,
        round(100.0 * resolved_markets / total_markets, 2) as resolution_pct
      FROM gamma_markets gm
      LEFT JOIN gamma_resolved gr ON gm.condition_id = gr.condition_id
    `,
    format: 'JSONEachRow',
  })
  const j2 = await join2.json<{ total_markets: string; resolved_markets: string; resolution_pct: string }>()
  console.log('   Total markets:', j2[0].total_markets)
  console.log('   Resolved:', j2[0].resolved_markets)
  console.log('   Resolution rate:', j2[0].resolution_pct + '%')

  console.log('\nJoin #3: Traded markets -> gamma_resolved')
  const join3 = await clickhouse.query({
    query: `
      SELECT 
        count(*) as traded_markets,
        countIf(gr.condition_id IS NOT NULL) as resolved_traded,
        round(100.0 * resolved_traded / traded_markets, 2) as pct
      FROM (
        SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid 
        FROM clob_fills
      ) cf
      LEFT JOIN gamma_resolved gr ON cf.cid = gr.condition_id
    `,
    format: 'JSONEachRow',
  })
  const j3 = await join3.json<{ traded_markets: string; resolved_traded: string; pct: string }>()
  console.log('   Traded markets:', j3[0].traded_markets)
  console.log('   With resolutions:', j3[0].resolved_traded)
  console.log('   Resolution rate:', j3[0].pct + '%')

  // AUDIT #3: RESOLUTION COVERAGE
  console.log('\n=== AUDIT #3: RESOLUTION COVERAGE ===\n')

  const totalRes = await clickhouse.query({
    query: `SELECT count(*) as total, count(DISTINCT condition_id) as unique_conditions FROM gamma_resolved`,
    format: 'JSONEachRow',
  })
  const tr = await totalRes.json<{ total: string; unique_conditions: string }>()
  console.log('Total rows in gamma_resolved:', tr[0].total)
  console.log('Unique condition_ids:', tr[0].unique_conditions)

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
  console.log('\nResolution staleness:')
  console.log('   Last resolution:', rs[0].last_resolution)
  console.log('   Days stale:', rs[0].days_stale, 'days')

  // AUDIT #4: TOKEN MAPPING
  console.log('\n=== AUDIT #4: TOKEN MAPPING COVERAGE ===\n')

  const erc1155Tokens = await clickhouse.query({
    query: `
      SELECT 
        count(*) as total_transfers,
        count(DISTINCT token_id) as unique_token_ids
      FROM erc1155_transfers
    `,
    format: 'JSONEachRow',
  })
  const e1155t = await erc1155Tokens.json<{ total_transfers: string; unique_token_ids: string }>()
  console.log('ERC-1155 transfers:')
  console.log('   Total transfers:', e1155t[0].total_transfers)
  console.log('   Unique token_ids:', e1155t[0].unique_token_ids)

  const erc1155Range = await clickhouse.query({
    query: `
      SELECT 
        min(block_timestamp) as first_transfer,
        max(block_timestamp) as last_transfer
      FROM erc1155_transfers
      WHERE block_timestamp > toDateTime('1970-01-01')
    `,
    format: 'JSONEachRow',
  })
  const e1155r = await erc1155Range.json<{ first_transfer: string; last_transfer: string }>()
  console.log('   Date range:', e1155r[0].first_transfer, 'to', e1155r[0].last_transfer)

  const zeroTs = await clickhouse.query({
    query: 'SELECT count(*) as zero_ts FROM erc1155_transfers WHERE block_timestamp = toDateTime(0)',
    format: 'JSONEachRow',
  })
  const zt = await zeroTs.json<{ zero_ts: string }>()
  console.log('   Zero timestamps:', zt[0].zero_ts)

  // AUDIT #5: TEMPORAL COVERAGE
  console.log('\n=== AUDIT #5: TEMPORAL COVERAGE (Last 12 Months) ===\n')

  const clobMonthly = await clickhouse.query({
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
  const clobM = await clobMonthly.json<Array<{ month: string; fill_count: string; unique_markets: string }>>()
  console.log('CLOB fills by month:')
  clobM.forEach(m => {
    console.log('   ' + m.month + ': ' + m.fill_count + ' fills, ' + m.unique_markets + ' markets')
  })

  console.log('\n========================================')
  console.log('AUDIT COMPLETE')
  console.log('========================================\n')
}

runAllAudits()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err)
    process.exit(1)
  })
