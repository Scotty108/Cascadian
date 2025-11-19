#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || ''
});

async function main() {
  const tablesResult = await client.query({ 
    query: `
      SELECT database, name, total_rows 
      FROM system.tables 
      WHERE name LIKE '%price%' OR name LIKE '%midprice%'
      ORDER BY database, total_rows DESC
    `, 
    format: 'JSONEachRow' 
  });
  const tables = await tablesResult.json();
  console.log('Price-related tables:');
  console.log(JSON.stringify(tables, null, 2));
  
  await client.close();
}

main().catch(console.error);
