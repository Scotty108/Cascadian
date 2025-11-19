import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function simpleDataAudit() {
  console.log('📊 SIMPLE DATA DISCOVERY - FINDING TRADE SOURCES');
  console.log('-'.repeat(65));

  // Simple overview
  console.log('\n🎯 DATABASE TABLE SUMMARY:');

  const tablesResult = await clickhouse.query({
    query: `
      SELECT database, name, engine, total_rows,
             formatReadableSize(total_bytes) as size
      FROM system.tables
      WHERE (name LIKE '%fill%' OR name LIKE '%trade%' OR name LIKE '%clob%')
        AND total_rows > 0
      ORDER BY total_rows DESC
      LIMIT 30
    `,
    format: 'JSONEachRow'
  });

  const tablesData = await tablesResult.json();

  console.log('Database          | Table Name                     | Engine      | Rows     | Size     ');
  console.log(''.padEnd(85, '-'));

  for (const row of tablesData) {
    const isHuge = row.total_rows > 1000000 ? '🔥' : '  ';
    console.log(`${isHuge} ${row.database.padEnd(17)} | ${row.name.padEnd(30)} | ${row.engine.padEnd(11)} | ${row.total_rows.toLocaleString().padStart(8)} | ${row.size.padStart(8)}`);
  }

  // Quick comparison with what we have
  console.log('\n🔎 COMPARISON WITH CURRENT DATA SOURCE:');
  console.log('We are using:')

  // Our current table sizes
  const currentResult = await clickhouse.query({
    query: `
      SELECT name, engine, total_rows, formatReadableSize(total_bytes) as size
      FROM system.tables
      WHERE database IN ('default', 'cascadian_clean', 'sandbox')
        AND (name = 'clob_fills'
             OR name = 'token_to_cid_bridge'
             OR name = 'fills_norm_fixed_v2'
             OR name IN ('token_cid_map', 'fills_norm', 'token_cid_map_fixed')
             OR name LIKE 'realized_pnl%')
      ORDER BY total_rows DESC
    `,
    format: 'JSONEachRow'
  });

  const currentData = await currentResult.json();
  currentData.forEach((row: any) => {
    console.log(`  ${row.database}.${row.name.padEnd(30)} | ${row.total_rows.toLocaleString().padStart(10)} rows`);
  });

  console.log('\n📊 STATUS ASSESSMENT:');
  console.log('   Our clob_fills approach works mechanically but calculations are off by 32,000x');
  console.log('   Major data sources identified above - we need to verify price/scaling factors');
  console.log('   Next steps: check if price/1e6 scaling is needed, and better fee calculations');
}

simpleDataAudit().catch(console.error);

export { simpleDataAudit };