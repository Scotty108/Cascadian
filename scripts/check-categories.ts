import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

async function checkCategories() {
  const result = await clickhouse.query({
    query: `
      SELECT category, COUNT(*) as count
      FROM pm_market_metadata
      GROUP BY category
      ORDER BY count DESC
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });

  const data = await result.json<{ category: string; count: string }>();
  console.log('\n📊 Category Breakdown (Top 20):');
  console.log('='.repeat(60));
  data.forEach(row => {
    console.log(`${row.category} : ${row.count}`);
  });

  // Check for "Uncategorized"
  const uncatResult = await clickhouse.query({
    query: `SELECT COUNT(*) as count FROM pm_market_metadata WHERE category = 'Uncategorized'`,
    format: 'JSONEachRow',
  });
  const uncatData = await uncatResult.json<{ count: string }>();
  console.log('='.repeat(60));
  console.log(`Uncategorized markets: ${uncatData[0].count}`);
}

checkCategories().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
