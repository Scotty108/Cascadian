#!/usr/bin/env tsx
/**
 * Phase 5.3 Test: Quick validation with first 10 ghost wallets
 *
 * Purpose: Test the --from-ghost-wallets mode on a small sample before full run
 */
import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function main() {
  console.log('═'.repeat(80));
  console.log('Phase 5.3 Quick Test: First 10 Ghost Wallets');
  console.log('═'.repeat(80));
  console.log('');

  // Get first 10 wallets
  const result = await clickhouse.query({
    query: `SELECT DISTINCT wallet FROM ghost_market_wallets ORDER BY wallet LIMIT 10`,
    format: 'JSONEachRow'
  });

  const wallets: any[] = await result.json();

  console.log(`Testing with ${wallets.length} wallets:`);
  wallets.forEach(w => console.log(`  ${w.wallet}`));
  console.log('');

  // Build CLI command
  const walletFlags = wallets.map(w => `--wallet ${w.wallet}`).join(' ');
  const conditionFlags = '--condition-id 0x293fb49f43b12631ec4ad0617d9c0efc0eacce33416ef16f68521427daca1678,0xf2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1,0xbff3fad6e9c96b6e3714c52e6d916b1ffb0f52cdfdb77c7fb153a8ef1ebff608,0xe9c127a8c35f045d37b5344b0a36711084fa20c2fc1618bf178a5386f90610be,0xce733629b3b1bea0649c9c9433401295eb8e1ba6d572803cb53446c93d28cd44,0xfc4453f83b30fdad8ac707b7bd11309aa4c4c90d0c17ad0c4680d4142d4471f7';

  const command = `npx tsx scripts/203-ingest-amm-trades-from-data-api.ts ${walletFlags} ${conditionFlags} --dry-run`;

  console.log('Running ingestion test...');
  console.log('');

  try {
    const { stdout, stderr } = await execAsync(command, { maxBuffer: 10 * 1024 * 1024 });

    console.log(stdout);

    if (stderr && !stderr.includes('dotenv')) {
      console.error('STDERR:', stderr);
    }

    console.log('');
    console.log('✅ Test completed successfully');
    console.log('');
    console.log('Next step: Run full 604-wallet ingestion');
    console.log('  npx tsx scripts/203-ingest-amm-trades-from-data-api.ts --from-ghost-wallets --dry-run');

  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    throw error;
  }
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
