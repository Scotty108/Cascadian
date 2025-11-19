import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function auditMissingMarkets() {
  console.log('=== MISSING MARKETS ANALYSIS ===\n')

  // Sample missing markets
  console.log('Sample missing markets (first 30):')
  const missingRes = await clickhouse.query({
    query: `
      SELECT gm.condition_id, gm.question, gm.canonical_category, gm.end_date, gm.volume
      FROM gamma_markets gm
      LEFT JOIN (SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid FROM clob_fills) cf 
      ON gm.condition_id = cf.cid
      WHERE cf.cid IS NULL
      ORDER BY CAST(gm.volume AS Float64) DESC
      LIMIT 30
    `,
    format: 'JSONEachRow',
  })
  const missing = await missingRes.json<Array<{ condition_id: string; question: string; canonical_category: string; end_date: string; volume: string }>>()
  
  missing.forEach((m, i) => {
    const q = m.question || 'No question'
    const qShort = q.substring(0, 60)
    console.log('   ' + (i + 1) + '. [' + (m.canonical_category || 'unknown') + '] ' + qShort + '... (vol: $' + m.volume + ')')
  })

  // Missing by category
  console.log('\nMissing markets by category:')
  const categoryRes = await clickhouse.query({
    query: `
      SELECT 
        gm.canonical_category,
        count(*) as missing_count,
        sum(CAST(gm.volume AS Float64)) as total_volume
      FROM gamma_markets gm
      LEFT JOIN (SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid FROM clob_fills) cf 
      ON gm.condition_id = cf.cid
      WHERE cf.cid IS NULL
      GROUP BY gm.canonical_category
      ORDER BY missing_count DESC
      LIMIT 15
    `,
    format: 'JSONEachRow',
  })
  const categories = await categoryRes.json<Array<{ canonical_category: string; missing_count: string; total_volume: string }>>()
  
  categories.forEach(c => {
    console.log('   ' + (c.canonical_category || 'null').padEnd(25) + ': ' + c.missing_count.padStart(7) + ' markets')
  })

  // Missing by date range
  console.log('\nMissing markets by end_date (last 12 months):')
  const dateRes = await clickhouse.query({
    query: `
      SELECT 
        toStartOfMonth(CAST(gm.end_date AS DateTime)) as month,
        count(*) as missing_count
      FROM gamma_markets gm
      LEFT JOIN (SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid FROM clob_fills) cf 
      ON gm.condition_id = cf.cid
      WHERE cf.cid IS NULL
        AND CAST(gm.end_date AS DateTime) >= now() - INTERVAL 12 MONTH
      GROUP BY month
      ORDER BY month DESC
    `,
    format: 'JSONEachRow',
  })
  const dates = await dateRes.json<Array<{ month: string; missing_count: string }>>()
  
  dates.forEach(d => {
    console.log('   ' + d.month + ': ' + d.missing_count.padStart(6) + ' markets')
  })
}

auditMissingMarkets()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err)
    process.exit(1)
  })
