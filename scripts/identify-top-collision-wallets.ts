#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from '@/lib/clickhouse/client';

// Phase A: Identify top collision-heavy wallets by volume
// Rank wallets by total USD volume where they participate in collision trades

async function main() {
  console.log('═'.repeat(80));
  console.log('PHASE A: IDENTIFY TOP COLLISION WALLETS');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Analyzing pm_trades_canonical_v3 for wallets with collision trades...');
  console.log('');

  try {
    // Find wallets that participate in collision transactions (tx_hash with multiple wallet_addresses)
    // Rank by total USD volume
    const query = `
      WITH collision_tx AS (
        SELECT transaction_hash
        FROM pm_trades_canonical_v3
        GROUP BY transaction_hash
        HAVING countDistinct(wallet_address) > 1
      )
      SELECT
        lower(wallet_address) AS wallet,
        count(*) AS trade_count,
        sum(usd_value) AS total_volume_usd,
        countDistinct(transaction_hash) AS unique_tx,
        countIf(transaction_hash IN (SELECT transaction_hash FROM collision_tx)) AS collision_trades,
        round(collision_trades / trade_count * 100, 2) AS collision_rate_pct
      FROM pm_trades_canonical_v3
      WHERE wallet_address != ''
      GROUP BY wallet_address
      HAVING collision_trades > 0
      ORDER BY total_volume_usd DESC
      LIMIT 100
    `;

    const result = await clickhouse.query({ query, format: 'JSONEachRow' });
    const data = await result.json() as any[];

    console.log('TOP 100 COLLISION WALLETS BY VOLUME:');
    console.log('─'.repeat(80));
    console.log('');
    console.log('Rank  Wallet                                      Volume (USD)    Trades  Collision %');
    console.log('─'.repeat(90));

    let rank = 1;
    for (const row of data) {
      const wallet = row.wallet;
      const volume = parseFloat(row.total_volume_usd);
      const trades = parseInt(row.trade_count);
      const collisionPct = parseFloat(row.collision_rate_pct);

      const walletShort = `${wallet.substring(0, 6)}...${wallet.substring(38)}`;

      console.log(
        `${rank.toString().padStart(4)}  ${walletShort.padEnd(42)}  $${volume.toLocaleString('en-US', { maximumFractionDigits: 2 }).padStart(13)}  ${trades.toLocaleString().padStart(7)}  ${collisionPct.toFixed(2).padStart(6)}%`
      );

      rank++;
    }

    console.log('');
    console.log('═'.repeat(80));
    console.log('ANALYSIS COMPLETE');
    console.log('═'.repeat(80));
    console.log('');

    // Summary stats
    const totalVolume = data.reduce((sum, row) => sum + parseFloat(row.total_volume_usd), 0);
    const totalTrades = data.reduce((sum, row) => sum + parseInt(row.trade_count), 0);

    console.log('SUMMARY STATISTICS:');
    console.log('─'.repeat(80));
    console.log(`  Total Collision Wallets Found: ${data.length.toLocaleString()}`);
    console.log(`  Total Volume (Top 100):        $${totalVolume.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
    console.log(`  Total Trades (Top 100):        ${totalTrades.toLocaleString()}`);
    console.log('');

    // Write to file for further analysis
    const fs = require('fs');
    const outputPath = resolve(process.cwd(), 'collision-wallets-top100.json');
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));

    console.log(`✅ Results saved to: collision-wallets-top100.json`);
    console.log('');
    console.log('NEXT STEPS:');
    console.log('─'.repeat(80));
    console.log('1. For each wallet, investigate executor→account relationship');
    console.log('2. Look for ERC20 flow patterns (USDC transfers)');
    console.log('3. Validate via transaction hash overlap analysis');
    console.log('4. Add validated mappings to wallet_identity_overrides');
    console.log('');

  } catch (error: any) {
    console.error('❌ ERROR:', error.message);
    console.error('');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
