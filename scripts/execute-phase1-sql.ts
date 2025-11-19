#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

async function main() {
  console.log('');
  console.log('═'.repeat(80));
  console.log('EXECUTING PHASE 1 SQL VIEWS');
  console.log('═'.repeat(80));
  console.log('');

  const sql = readFileSync('phase1-sql-views.sql', 'utf-8');

  // Split by semicolons and execute each statement
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    if (!stmt) continue;

    console.log(`Executing statement ${i + 1}/${statements.length}...`);

    try {
      await ch.command({ query: stmt });
      console.log(`✓ Success`);
    } catch (err: any) {
      console.error(`✗ Error: ${err.message}`);
      // Continue with other statements
    }
  }

  console.log('');
  console.log('═'.repeat(80));
  console.log('PHASE 1 SQL EXECUTION COMPLETE');
  console.log('═'.repeat(80));
  console.log('');

  await ch.close();
}

main().catch(console.error);
