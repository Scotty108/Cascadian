import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function checkSchemas() {
  console.log('🔍 Checking table schemas...');

  // Check ctf_to_market_bridge_mat schema
  console.log('\n📋 default.ctf_to_market_bridge_mat schema:');
  const ctfSchema = await clickhouse.query({
    query: `
      DESCRIBE TABLE default.ctf_to_market_bridge_mat
    `,
    format: 'JSONEachRow'
  });
  const ctfColumns = await ctfSchema.json();
  ctfColumns.forEach((col: any) => {
    console.log(`  ${col.name}: ${col.type}`);
  });

  // Check cascadian_clean.bridge_ctf_condition if it exists
  console.log('\n📋 Checking if cascadian_clean.bridge_ctf_condition exists...');
  const bridgeCheck = await clickhouse.query({
    query: `
      SELECT count() as total
      FROM system.tables
      WHERE database = 'cascadian_clean' AND name = 'bridge_ctf_condition'
    `,
    format: 'JSONEachRow'
  });
  const bridgeData = await bridgeCheck.json();
  console.log('Bridge table exists:', bridgeData[0].total > 0);

  // Sample data from ctf_to_market_bridge_mat
  console.log('\n🔍 Sample CTF bridge data:');
  const sampleCtf = await clickhouse.query({
    query: `
      SELECT ctf_hex64, market_hex64
      FROM default.ctf_to_market_bridge_mat
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const ctfData = await sampleCtf.json();
  ctfData.forEach((row: any) => {
    console.log(`  CTF: ${row.ctf_hex64.slice(0, 12)}... → Market: ${row.market_hex64.slice(0, 12)}...`);
  });
}

checkSchemas().catch(console.error);