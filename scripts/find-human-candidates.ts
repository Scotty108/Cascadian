/**
 * Find Human Copy-Trading Candidates
 * Filter 1.8M wallets down to active humans:
 * 1. No external sells (CLOB-only traders)
 * 2. Active in last 10 days
 * 3. More than 10 trades
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

async function main() {
  console.log('=== FINDING HUMAN COPY-TRADING CANDIDATES ===\n');

  // Step 1: Count total wallets in pm_trader_events_v2
  console.log('Step 1: Counting total wallets in trade events...');
  const totalQuery = await clickhouse.query({
    query: `SELECT uniqExact(trader_wallet) as total FROM pm_trader_events_v2 WHERE is_deleted = 0`,
    format: 'JSONEachRow'
  });
  const totalResult = await totalQuery.json() as any[];
  console.log(`Total wallets in pm_trader_events_v2: ${totalResult[0]?.total?.toLocaleString()}\n`);

  // Step 2: Find wallets WITHOUT external sells (CLOB-only)
  // External sells would be in pm_erc1155_transfers but not in pm_trader_events_v2
  console.log('Step 2: Finding CLOB-only wallets (no external redemptions)...');

  const clobOnlyQuery = await clickhouse.query({
    query: `
      SELECT
        uniqExact(trader_wallet) as clob_only_wallets
      FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trader_wallet NOT IN (
          SELECT DISTINCT lower(from_address)
          FROM pm_erc1155_transfers
          WHERE is_deleted = 0
            AND lower(to_address) = '0x0000000000000000000000000000000000000000'
        )
    `,
    format: 'JSONEachRow'
  });
  const clobOnlyResult = await clobOnlyQuery.json() as any[];
  console.log(`CLOB-only wallets (no burns/redemptions): ${clobOnlyResult[0]?.clob_only_wallets?.toLocaleString()}\n`);

  // Step 3: Apply all filters together
  console.log('Step 3: Applying filters (active 10 days, 10+ trades, no external sells)...\n');

  const filteredQuery = await clickhouse.query({
    query: `
      SELECT
        wallet,
        trade_count,
        last_trade,
        first_trade,
        total_volume,
        days_active
      FROM (
        SELECT
          trader_wallet as wallet,
          count() as trade_count,
          max(trade_time) as last_trade,
          min(trade_time) as first_trade,
          sum(usdc_amount) / 1e6 as total_volume,
          dateDiff('day', min(trade_time), max(trade_time)) as days_active
        FROM (
          SELECT event_id, any(trader_wallet) as trader_wallet, any(trade_time) as trade_time, any(usdc_amount) as usdc_amount
          FROM pm_trader_events_v2
          WHERE is_deleted = 0
          GROUP BY event_id
        )
        GROUP BY trader_wallet
        HAVING
          trade_count >= 10
          AND last_trade >= now() - INTERVAL 10 DAY
      )
      ORDER BY trade_count DESC
      LIMIT 50000
    `,
    format: 'JSONEachRow'
  });

  const filtered = await filteredQuery.json() as any[];
  console.log(`Wallets with 10+ trades, active in last 10 days: ${filtered.length.toLocaleString()}\n`);

  // Step 4: Further filter to exclude wallets with external redemptions
  console.log('Step 4: Filtering out wallets with external redemptions...');

  const walletList = filtered.map(w => w.wallet);

  // Get wallets that have burned tokens (external redemptions)
  const burnersQuery = await clickhouse.query({
    query: `
      SELECT DISTINCT lower(from_address) as wallet
      FROM pm_erc1155_transfers
      WHERE is_deleted = 0
        AND lower(to_address) = '0x0000000000000000000000000000000000000000'
        AND lower(from_address) IN (${walletList.slice(0, 10000).map(w => `'${w}'`).join(',')})
    `,
    format: 'JSONEachRow'
  });

  const burners = new Set((await burnersQuery.json() as any[]).map(b => b.wallet));
  console.log(`Wallets with redemptions (to exclude): ${burners.size}`);

  const clobOnly = filtered.filter(w => !burners.has(w.wallet));
  console.log(`Final CLOB-only candidates: ${clobOnly.length.toLocaleString()}\n`);

  // Summary stats
  console.log('=== FINAL CANDIDATE POOL ===\n');
  console.log(`Total candidates: ${clobOnly.length}`);

  const avgTrades = clobOnly.reduce((sum, w) => sum + w.trade_count, 0) / clobOnly.length;
  const avgVolume = clobOnly.reduce((sum, w) => sum + w.total_volume, 0) / clobOnly.length;

  console.log(`Avg trades per wallet: ${avgTrades.toFixed(0)}`);
  console.log(`Avg volume per wallet: $${avgVolume.toFixed(0)}`);

  // Distribution by trade count
  const by10_50 = clobOnly.filter(w => w.trade_count >= 10 && w.trade_count < 50).length;
  const by50_100 = clobOnly.filter(w => w.trade_count >= 50 && w.trade_count < 100).length;
  const by100_500 = clobOnly.filter(w => w.trade_count >= 100 && w.trade_count < 500).length;
  const by500plus = clobOnly.filter(w => w.trade_count >= 500).length;

  console.log(`\nDistribution by trade count:`);
  console.log(`  10-49 trades:   ${by10_50.toLocaleString()}`);
  console.log(`  50-99 trades:   ${by50_100.toLocaleString()}`);
  console.log(`  100-499 trades: ${by100_500.toLocaleString()}`);
  console.log(`  500+ trades:    ${by500plus.toLocaleString()}`);

  // Show top by volume
  console.log('\n=== TOP 30 BY VOLUME ===\n');
  const byVolume = [...clobOnly].sort((a, b) => b.total_volume - a.total_volume);

  console.log('Wallet'.padEnd(44) + 'Trades'.padStart(8) + 'Volume'.padStart(12) + 'Last Trade'.padStart(14));
  console.log('='.repeat(80));

  for (const w of byVolume.slice(0, 30)) {
    const lastTrade = new Date(w.last_trade).toLocaleDateString();
    console.log(
      w.wallet.padEnd(44) +
      String(w.trade_count).padStart(8) +
      `$${(w.total_volume / 1000).toFixed(0)}k`.padStart(12) +
      lastTrade.padStart(14)
    );
  }

  // Show top by trade count
  console.log('\n=== TOP 30 BY TRADE COUNT ===\n');

  console.log('Wallet'.padEnd(44) + 'Trades'.padStart(8) + 'Volume'.padStart(12) + 'Days Active'.padStart(12));
  console.log('='.repeat(80));

  for (const w of clobOnly.slice(0, 30)) {
    console.log(
      w.wallet.padEnd(44) +
      String(w.trade_count).padStart(8) +
      `$${(w.total_volume / 1000).toFixed(0)}k`.padStart(12) +
      String(w.days_active).padStart(12)
    );
  }

  // Output all wallet addresses
  console.log(`\n=== ALL ${clobOnly.length} CANDIDATE ADDRESSES ===\n`);
  console.log('(First 100 shown)');
  for (const w of clobOnly.slice(0, 100)) {
    console.log(w.wallet);
  }

  // Save to file for further analysis
  const fs = await import('fs');
  fs.writeFileSync(
    '/tmp/human-candidates.json',
    JSON.stringify(clobOnly, null, 2)
  );
  console.log(`\nFull list saved to /tmp/human-candidates.json`);
}

main().catch(console.error);
