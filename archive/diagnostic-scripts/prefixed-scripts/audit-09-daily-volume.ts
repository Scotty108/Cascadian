import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('=== CLOB FILLS - LAST 30 DAYS ===\n')

  const q = await clickhouse.query({
    query: `
      SELECT 
        toDate(timestamp) as day,
        count(*) as fills,
        count(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as markets
      FROM clob_fills
      WHERE timestamp >= now() - INTERVAL 30 DAY
      GROUP BY day
      ORDER BY day DESC
    `,
    format: 'JSONEachRow',
  })
  
  const daily = await q.json<Array<{ day: string; fills: string; markets: string }>>()
  
  daily.forEach(d => {
    const fillCount = parseInt(d.fills)
    const maxBar = 20
    const maxFills = 300000
    const barLength = Math.min(maxBar, Math.ceil(fillCount / maxFills * maxBar))
    const bar = fillCount > 0 ? '█'.repeat(barLength) + '░'.repeat(maxBar - barLength) : '░'.repeat(maxBar)
    const fillsStr = ('       ' + d.fills).slice(-7)
    const marketsStr = ('     ' + d.markets).slice(-5)
    console.log('   ' + d.day + ': ' + fillsStr + ' fills, ' + marketsStr + ' markets ' + bar)
  })
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); })
