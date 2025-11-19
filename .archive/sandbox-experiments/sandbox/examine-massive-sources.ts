import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { clickhouse } from '../lib/clickhouse/client.js';

async function examineMassiveSources() {
  console.log('🎯 EXAMINING MASSIVE TRADE DATA SOURCES');
  console.log('='.repeat(50));

  // Get top trade sources
  const result = await clickhouse.query({
    query: `
      SELECT database, name, total_rows, formatReadableSize(total_bytes) as size
      FROM system.tables
      WHERE database IN ('default', 'cascadian_clean')
        AND (name LIKE '%trade%' OR name LIKE '%fill%' OR name LIKE '%clob%')
        AND total_rows > 100000
      ORDER BY total_rows DESC
      LIMIT 15`,
    format: 'JSONEachRow'
  });

  const data = await result.json();
  console.log('MASSIVE TRADE DATA SOURCES FOUND:');
  data.forEach((row: any) => {
    console.log(`  ${row.database}.${row.name}: ${row.total_rows.toLocaleString()} rows (${row.size})`);
  });

  console.log('\n📊 COMPARISON:');
  console.log('Our current clob_fills filter: 194 trades');
  console.log('Full clob_fills table: 38,945,566 trades (200,000x more!)');
  console.log('vw_trades_canonical: 157,541,131 trades (800,000x more!)');
  console.log('fact_trades_clean: 63,541,461 trades (300,000x more!)');

  // Let's check the wallet's presence in these larger sources
  console.log('\n🔍 WALLET PRESENCE IN LARGER SOURCES:');

  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  for (const table of data.slice(0, 5)) {
    try {
      const walletResult = await clickhouse.query({
        query: `
          SELECT count() as wallet_trades
          FROM ${table.database}.${table.name}
          WHERE lower(CAST(proxy_wallet AS String)) = lower('${wallet}')
             OR lower(CAST(user_eoa AS String)) = lower('${wallet}')
          LIMIT 1`,
        format: 'JSONEachRow'
      });

      const walletData = await walletResult.json();
      console.log(`  ${table.database}.${table.name}: ${walletData[0]?.wallet_trades || 0} wallet trades`);
    } catch (error) {
      console.log(`  ${table.database}.${table.name}: Error checking wallet (schema may differ)`);
    }
  }
}

examineMassiveSources().catch(console.error);