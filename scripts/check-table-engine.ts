#!/usr/bin/env tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

(async () => {
  console.log('\n🔍 Checking resolutions_external_ingest table...\n');

  // Check CREATE TABLE statement
  const showCreate = await ch.query({
    query: 'SHOW CREATE TABLE default.resolutions_external_ingest',
    format: 'TabSeparated',
  });
  const createStmt = await showCreate.text();
  console.log('Table definition:');
  console.log(createStmt);
  console.log('\n');

  // Check system.tables info
  const tableInfo = await ch.query({
    query: `
      SELECT 
        engine,
        engine_full,
        total_rows,
        total_bytes
      FROM system.tables
      WHERE database = 'default' AND name = 'resolutions_external_ingest'
    `,
    format: 'JSONEachRow',
  });
  const info = await tableInfo.json();
  console.log('System info:');
  console.log(JSON.stringify(info[0], null, 2));

  await ch.close();
})();
