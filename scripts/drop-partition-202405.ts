#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('Dropping partition 202405 from pm_trades_canonical_v3...');

  await clickhouse.command({
    query: 'ALTER TABLE pm_trades_canonical_v3 DROP PARTITION 202405'
  });

  console.log('✅ Partition 202405 dropped successfully');
}

main().catch(console.error);
