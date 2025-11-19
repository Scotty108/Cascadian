import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function auditCLOBCoverage() {
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
    query: `SELECT min(matched_at) as first_fill, max(matched_at) as last_fill, dateDiff('day', min(matched_at), max(matched_at)) as days_covered FROM clob_fills`,
    format: 'JSONEachRow',
  })
  const dateRange = await dateRangeResult.json<{ first_fill: string; last_fill: string; days_covered: string }>()
  console.log('\nDate range:')
  console.log('   First fill:', dateRange[0].first_fill)
  console.log('   Last fill:', dateRange[0].last_fill)
  console.log('   Days covered:', dateRange[0].days_covered)

  const missingResult = await clickhouse.query({
    query: `
      SELECT gm.condition_id, gm.question, gm.canonical_category, gm.end_date
      FROM gamma_markets gm
      LEFT JOIN (SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid FROM clob_fills) cf 
      ON gm.condition_id = cf.cid
      WHERE cf.cid IS NULL
      ORDER BY gm.end_date DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  })
  const missing = await missingResult.json<Array<{ condition_id: string; question: string; canonical_category: string; end_date: string }>>()
  
  console.log('\nSample missing markets (first 20):')
  missing.forEach((m, i) => {
    const q = m.question || 'No question'
    const qShort = q.substring(0, 60)
    console.log('   ' + (i + 1) + '. [' + (m.canonical_category || 'unknown') + '] ' + qShort + '... (ends: ' + m.end_date + ')')
  })
}

auditCLOBCoverage()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err)
    process.exit(1)
  })
