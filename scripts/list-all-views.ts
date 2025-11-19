#!/usr/bin/env npx tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function listAllViews() {
  console.log('='.repeat(140));
  console.log('VIEW INVENTORY - 98 TOTAL VIEWS');
  console.log('='.repeat(140));

  const result = await client.query({
    query: `
      SELECT
        database,
        name AS view_name,
        create_table_query
      FROM system.tables
      WHERE database IN ('default', 'cascadian_clean')
        AND engine = 'View'
      ORDER BY database, name
    `,
    format: 'JSONEachRow',
  });
  
  const views = await result.json<any[]>();
  
  // Group by database
  const byDb: Record<string, any[]> = {};
  for (const v of views) {
    if (!byDb[v.database]) byDb[v.database] = [];
    byDb[v.database].push(v);
  }

  for (const [db, viewList] of Object.entries(byDb)) {
    console.log(`\n${db.toUpperCase()} SCHEMA - ${viewList.length} views`);
    console.log('-'.repeat(140));
    
    // Categorize views
    const categories: Record<string, string[]> = {
      'PNL Views': [],
      'Resolution Views': [],
      'Trade Views': [],
      'Mapping/Token Views': [],
      'Wallet Views': [],
      'Utility Views': [],
    };

    for (const v of viewList) {
      if (v.view_name.includes('pnl')) {
        categories['PNL Views'].push(v.view_name);
      } else if (v.view_name.includes('resolution')) {
        categories['Resolution Views'].push(v.view_name);
      } else if (v.view_name.includes('trade')) {
        categories['Trade Views'].push(v.view_name);
      } else if (v.view_name.includes('token') || v.view_name.includes('cid') || v.view_name.includes('map')) {
        categories['Mapping/Token Views'].push(v.view_name);
      } else if (v.view_name.includes('wallet')) {
        categories['Wallet Views'].push(v.view_name);
      } else {
        categories['Utility Views'].push(v.view_name);
      }
    }

    for (const [category, names] of Object.entries(categories)) {
      if (names.length > 0) {
        console.log(`\n${category} (${names.length}):`);
        names.forEach(n => console.log(`  - ${n}`));
      }
    }
  }

  console.log('\n' + '='.repeat(140));
  console.log(`TOTAL VIEWS: ${views.length}`);
  console.log('='.repeat(140));

  await client.close();
}

listAllViews().catch(console.error);
