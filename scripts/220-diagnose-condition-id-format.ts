#!/usr/bin/env tsx
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  // Check gamma_resolved format
  const gammaResult = await clickhouse.query({
    query: `SELECT cid FROM gamma_resolved LIMIT 5`,
    format: 'JSONEachRow'
  });
  const gammaSamples = await gammaResult.json();

  console.log('gamma_resolved.cid samples:');
  gammaSamples.forEach((s: any) => console.log(`  ${s.cid}`));
  console.log('');

  // Check trades_raw format
  const tradesResult = await clickhouse.query({
    query: `SELECT DISTINCT condition_id FROM trades_raw LIMIT 5`,
    format: 'JSONEachRow'
  });
  const tradesSamples = await tradesResult.json();

  console.log('trades_raw.condition_id samples:');
  tradesSamples.forEach((s: any) => console.log(`  ${s.condition_id}`));
  console.log('');

  // Check if we need to add/remove 0x prefix
  const gammaHasPrefix = gammaSamples[0]?.cid?.startsWith('0x');
  const tradesHasPrefix = tradesSamples[0]?.condition_id?.startsWith('0x');

  console.log(`gamma_resolved has 0x prefix: ${gammaHasPrefix}`);
  console.log(`trades_raw has 0x prefix: ${tradesHasPrefix}`);
  console.log('');

  if (gammaHasPrefix !== tradesHasPrefix) {
    console.log('❌ FORMAT MISMATCH DETECTED!');
    console.log('');
    if (gammaHasPrefix && !tradesHasPrefix) {
      console.log('Solution: Remove 0x prefix from gamma_resolved.cid before joining');
      console.log('Use: substring(g.cid, 3) to remove "0x"');
    } else {
      console.log('Solution: Add 0x prefix to gamma_resolved.cid before joining');
      console.log('Use: concat(\'0x\', g.cid)');
    }
  } else {
    console.log('✅ Formats match - issue is elsewhere');
  }
}

main().catch(console.error);
