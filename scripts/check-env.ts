#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

console.log('ClickHouse environment variables:');
console.log('CLICKHOUSE_URL:', process.env.CLICKHOUSE_URL || '(not set)');
console.log('CLICKHOUSE_HOST:', process.env.CLICKHOUSE_HOST || '(not set)');
console.log('CLICKHOUSE_USER:', process.env.CLICKHOUSE_USER || '(not set)');
console.log('CLICKHOUSE_PASSWORD:', process.env.CLICKHOUSE_PASSWORD ? '***' : '(not set)');
