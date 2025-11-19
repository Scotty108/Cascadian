import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

console.log('Environment test:');
console.log('CLICKHOUSE_HOST:', process.env.CLICKHOUSE_HOST);
console.log('CLICKHOUSE_USER:', process.env.CLICKHOUSE_USER);
console.log('CLICKHOUSE_PASSWORD:', process.env.CLICKHOUSE_PASSWORD ? '***SET***' : 'MISSING');
console.log('CLICKHOUSE_DATABASE:', process.env.CLICKHOUSE_DATABASE);

import { testClickHouseConnection } from '../lib/clickhouse/client.js';

async function testConnection() {
  console.log('\nTesting connection...');
  const result = await testClickHouseConnection();
  console.log('Result:', result);
}

testConnection().catch(console.error);