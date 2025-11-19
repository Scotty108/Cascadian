#!/usr/bin/env npx tsx

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  const result = await clickhouse.query({
    query: 'DESC pm_trades_canonical_v3',
    format: 'TSV'
  });

  const text = await result.text();
  const feeColumns = text.split('\n').filter(line => line.toLowerCase().includes('fee'));

  console.log('Fee-related columns in pm_trades_canonical_v3:');
  console.log('═══════════════════════════════════════════════════════════════');
  if (feeColumns.length === 0) {
    console.log('  (No fee columns found)');
  } else {
    feeColumns.forEach(col => console.log(`  ${col}`));
  }
}

main().catch(console.error);
