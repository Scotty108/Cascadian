import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('=== MISSING MARKETS DETAILED ANALYSIS ===\n')

  console.log('Sample missing markets (recent 20):')
  const q1 = await clickhouse.query({
    query: `
      SELECT gm.question, gm.category, gm.end_date
      FROM gamma_markets gm
      LEFT JOIN (SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid FROM clob_fills) cf 
      ON gm.condition_id = cf.cid
      WHERE cf.cid IS NULL
      ORDER BY gm.fetched_at DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  })
  const missing = await q1.json<Array<{ question: string; category: string; end_date: string }>>()
  
  missing.forEach((m, i) => {
    const q = (m.question || 'No question').substring(0, 55)
    const idx = i + 1
    console.log('   ' + idx + '. [' + (m.category || 'null') + '] ' + q + '...')
  })

  console.log('\nMissing markets by category:')
  const q2 = await clickhouse.query({
    query: `
      SELECT 
        cmm.canonical_category,
        count(*) as missing_count
      FROM gamma_markets gm
      LEFT JOIN (SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid FROM clob_fills) cf 
        ON gm.condition_id = cf.cid
      LEFT JOIN condition_market_map cmm ON gm.condition_id = cmm.condition_id
      WHERE cf.cid IS NULL
      GROUP BY cmm.canonical_category
      ORDER BY missing_count DESC
      LIMIT 15
    `,
    format: 'JSONEachRow',
  })
  const cats = await q2.json<Array<{ canonical_category: string; missing_count: string }>>()
  
  cats.forEach(c => {
    const cat = (c.canonical_category || 'null') + ':                         '
    const catPadded = cat.substring(0, 25)
    const count = '       ' + c.missing_count
    const countPadded = count.substring(count.length - 7)
    console.log('   ' + catPadded + ' ' + countPadded + ' markets')
  })
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); })
