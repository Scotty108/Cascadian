import { clickhouse } from './lib/clickhouse/client';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(process.cwd(), '.env.local') });

async function verifyCoverage() {
  console.log('Verifying CLOB coverage...\n');

  // Count total markets
  const totalResult = await clickhouse.query({
    query: 'SELECT count(*) as total FROM gamma_markets',
    format: 'JSONEachRow'
  });
  const totalData: any = await totalResult.json();
  const totalMarkets = parseInt(totalData[0].total);

  // Count markets with fills
  const fillsResult = await clickhouse.query({
    query: `
      SELECT count(DISTINCT lower(replaceAll(condition_id, '0x', ''))) as with_fills
      FROM clob_fills
    `,
    format: 'JSONEachRow'
  });
  const fillsData: any = await fillsResult.json();
  const marketsWithFills = parseInt(fillsData[0].with_fills);

  // Count total fill records
  const recordsResult = await clickhouse.query({
    query: 'SELECT count(*) as records FROM clob_fills',
    format: 'JSONEachRow'
  });
  const recordsData: any = await recordsResult.json();
  const totalRecords = parseInt(recordsData[0].records);

  console.log(`Total markets in gamma_markets: ${totalMarkets.toLocaleString()}`);
  console.log(`Markets with fills in clob_fills: ${marketsWithFills.toLocaleString()}`);
  console.log(`Total fill records: ${totalRecords.toLocaleString()}`);
  console.log(`Coverage: ${((marketsWithFills / totalMarkets) * 100).toFixed(2)}%`);
  console.log(`Missing: ${(totalMarkets - marketsWithFills).toLocaleString()}`);
}

verifyCoverage().catch(console.error);
