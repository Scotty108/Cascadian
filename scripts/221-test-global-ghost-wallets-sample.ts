#!/usr/bin/env tsx
/**
 * Phase 7.2: Test Global Ghost Wallets Ingestion (Sample)
 *
 * Purpose: Validate --from-ghost-wallets-all mode with a small sample
 *          before running full ingestion
 *
 * Test: First 100 wallets from ghost_market_wallets_all
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
  console.log('Phase 7.2: Dry-Run Test with Global Ghost Wallets Sample');
  console.log('═'.repeat(80));
  console.log('');

  // Get first 100 wallets
  const walletsResult = await clickhouse.query({
    query: `SELECT DISTINCT wallet FROM ghost_market_wallets_all ORDER BY wallet LIMIT 100`,
    format: 'JSONEachRow'
  });

  const wallets: any[] = await walletsResult.json();

  console.log(`Testing with ${wallets.length} wallets from global table`);
  console.log('');

  // Get their markets
  const walletList = wallets.map(w => `'${w.wallet}'`).join(', ');
  const marketsResult = await clickhouse.query({
    query: `
      SELECT DISTINCT condition_id, COUNT(DISTINCT wallet) as wallet_count
      FROM ghost_market_wallets_all
      WHERE wallet IN (${walletList})
      GROUP BY condition_id
      ORDER BY wallet_count DESC
    `,
    format: 'JSONEachRow'
  });

  const markets: any[] = await marketsResult.json();

  console.log(`These wallets trade on ${markets.length} markets:`);
  markets.forEach((m, i) => {
    console.log(`  ${i + 1}. ${m.condition_id.substring(0, 24)}... → ${m.wallet_count} wallets`);
  });
  console.log('');

  // Build CLI command with explicit wallets and condition_ids
  const walletFlags = wallets.map(w => `--wallet ${w.wallet}`).join(' ');
  const conditionIds = markets.map(m => m.condition_id).join(',');

  const command = `npx tsx scripts/203-ingest-amm-trades-from-data-api.ts ${walletFlags} --condition-id ${conditionIds} --dry-run`;

  console.log('Running dry-run ingestion...');
  console.log('(This will query Data-API for each wallet and show what would be ingested)');
  console.log('');

  try {
    const { stdout, stderr } = await execAsync(command, { maxBuffer: 50 * 1024 * 1024, timeout: 600000 });

    // Parse output for key metrics
    const lines = stdout.split('\n');

    let totalActivities = 0;
    let totalTrades = 0;
    let totalValue = 0;

    lines.forEach(line => {
      const activitiesMatch = line.match(/Total activities fetched: (\\d+)/);
      if (activitiesMatch) {
        totalActivities = parseInt(activitiesMatch[1]);
      }

      const tradesMatch = line.match(/Trades \\(type=TRADE\\): (\\d+)/);
      if (tradesMatch) {
        totalTrades = parseInt(tradesMatch[1]);
      }

      const valueMatch = line.match(/Total Value:\\s+\\$([\\d,\\.]+)/);
      if (valueMatch) {
        totalValue = parseFloat(valueMatch[1].replace(/,/g, ''));
      }
    });

    console.log('');
    console.log('═'.repeat(80));
    console.log('DRY-RUN RESULTS');
    console.log('═'.repeat(80));
    console.log('');
    console.log(`✅ Wallets tested:       ${wallets.length}`);
    console.log(`✅ Markets covered:      ${markets.length}`);
    console.log(`✅ Activities found:     ${totalActivities}`);
    console.log(`✅ Trades found:         ${totalTrades}`);
    console.log(`✅ Total value:          $${totalValue.toFixed(2)}`);
    console.log('');

    if (totalTrades > 0) {
      console.log('✅ Dry-run successful! Data-API integration working correctly.');
      console.log('');
      console.log('Next step: Run full ingestion with all 12,717 wallets');
      console.log('  npx tsx scripts/203-ingest-amm-trades-from-data-api.ts --from-ghost-wallets-all --dry-run');
      console.log('');
    } else {
      console.log('⚠️  No trades found for sample wallets');
      console.log('This could mean:');
      console.log('  1. Sample wallets genuinely have no external trades');
      console.log('  2. Data-API rate limiting');
      console.log('  3. Network issues');
      console.log('');
      console.log('Check logs above for details');
      console.log('');
    }

  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    throw error;
  }
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});
