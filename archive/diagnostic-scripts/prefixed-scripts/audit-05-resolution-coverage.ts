import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function auditResolutionCoverage() {
  console.log('=== AUDIT #5: RESOLUTION COVERAGE ===\n')

  // Total resolutions
  console.log('Resolution data inventory:')
  const totalRes = await clickhouse.query({
    query: `SELECT count(*) as total, count(DISTINCT condition_id) as unique_conditions FROM gamma_resolved`,
    format: 'JSONEachRow',
  })
  const tr = await totalRes.json<{ total: string; unique_conditions: string }>()
  console.log('   Total rows in gamma_resolved:', tr[0].total)
  console.log('   Unique condition_ids:', tr[0].unique_conditions)

  // Traded markets without resolutions
  console.log('\nTraded markets missing resolutions:')
  const missingRes = await clickhouse.query({
    query: `
      SELECT count(*) as missing_resolutions
      FROM (
        SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid 
        FROM clob_fills
      ) cf
      LEFT JOIN gamma_resolved gr ON cf.cid = gr.condition_id
      WHERE gr.condition_id IS NULL
    `,
    format: 'JSONEachRow',
  })
  const mr = await missingRes.json<{ missing_resolutions: string }>()
  console.log('   Traded markets without resolution:', mr[0].missing_resolutions)

  // Markets in gamma_markets without resolutions
  console.log('\nAll markets (catalog) without resolutions:')
  const catalogMissing = await clickhouse.query({
    query: `
      SELECT count(*) as unresolved_markets
      FROM gamma_markets gm
      LEFT JOIN gamma_resolved gr ON gm.condition_id = gr.condition_id
      WHERE gr.condition_id IS NULL
    `,
    format: 'JSONEachRow',
  })
  const cm = await catalogMissing.json<{ unresolved_markets: string }>()
  console.log('   Markets in catalog without resolution:', cm[0].unresolved_markets)

  // Resolution status by month (last 6 months)
  console.log('\nResolutions by month (last 6 months):')
  const resByMonth = await clickhouse.query({
    query: `
      SELECT 
        toStartOfMonth(resolved_at) as month,
        count(*) as resolutions
      FROM gamma_resolved
      WHERE resolved_at >= now() - INTERVAL 6 MONTH
      GROUP BY month
      ORDER BY month DESC
    `,
    format: 'JSONEachRow',
  })
  const rbm = await resByMonth.json<Array<{ month: string; resolutions: string }>>()
  rbm.forEach(m => {
    console.log('   ' + m.month + ': ' + m.resolutions + ' resolutions')
  })

  // Sample markets with recent resolutions
  console.log('\nSample recently resolved markets (last 10):')
  const recentRes = await clickhouse.query({
    query: `
      SELECT 
        gr.condition_id,
        gr.resolved_at,
        gm.question
      FROM gamma_resolved gr
      LEFT JOIN gamma_markets gm ON gr.condition_id = gm.condition_id
      ORDER BY gr.resolved_at DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  })
  const rr = await recentRes.json<Array<{ condition_id: string; resolved_at: string; question: string }>>()
  rr.forEach((r, i) => {
    const q = r.question || 'No question'
    const qShort = q.substring(0, 50)
    console.log('   ' + (i + 1) + '. ' + r.resolved_at + ': ' + qShort + '...')
  })
}

auditResolutionCoverage()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err)
    process.exit(1)
  })
