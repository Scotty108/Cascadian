#!/usr/bin/env npx tsx
/**
 * Ultra-Investigation: Position Count Discrepancies
 *
 * Compare position counts across different views and tables to find where data is lost
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 120000
});

const WALLETS = [
  { addr: '0x4ce73141dbfce41e65db3723e31059a730f0abad', polymarket: 2816, name: 'Wallet #1' },
  { addr: '0x9155e8cf81a3fb557639d23d43f1528675bcfcad', polymarket: 9577, name: 'Wallet #2' },
  { addr: '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', polymarket: 192, name: 'Wallet #3' }
];

async function main() {
  console.log('\n🔍 ULTRA-INVESTIGATION: POSITION COUNT DISCREPANCIES\n');
  console.log('═'.repeat(100));

  for (const wallet of WALLETS) {
    console.log(`\n${wallet.name}: ${wallet.addr.substring(0, 10)}...`);
    console.log(`Polymarket shows: ${wallet.polymarket} predictions\n`);
    console.log('─'.repeat(100));

    // Check raw trades in fact_trades_clean
    const tradesRaw = await ch.query({
      query: `
        SELECT COUNT(*) as trade_count
        FROM default.fact_trades_clean
        WHERE lower(wallet_address) = lower('${wallet.addr}')
      `,
      format: 'JSONEachRow'
    });
    const tradesData = await tradesRaw.json();
    console.log(`1. fact_trades_clean (raw trades):           ${parseInt(tradesData[0].trade_count).toLocaleString()} trades`);

    // Check unique markets traded
    const marketsRaw = await ch.query({
      query: `
        SELECT COUNT(DISTINCT cid) as market_count
        FROM default.fact_trades_clean
        WHERE lower(wallet_address) = lower('${wallet.addr}')
      `,
      format: 'JSONEachRow'
    });
    const marketsData = await marketsRaw.json();
    console.log(`   Unique markets in fact_trades_clean:       ${parseInt(marketsData[0].market_count).toLocaleString()} markets`);

    // Check unique market+outcome combinations
    const positionsRaw = await ch.query({
      query: `
        SELECT COUNT(*) as position_count
        FROM (
          SELECT DISTINCT cid, outcome_index
          FROM default.fact_trades_clean
          WHERE lower(wallet_address) = lower('${wallet.addr}')
        )
      `,
      format: 'JSONEachRow'
    });
    const positionsData = await positionsRaw.json();
    console.log(`   Unique positions (market+outcome):         ${parseInt(positionsData[0].position_count).toLocaleString()} positions\n`);

    // Check vw_trades_canonical
    const canonical = await ch.query({
      query: `
        SELECT COUNT(*) as trade_count
        FROM default.vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${wallet.addr}')
      `,
      format: 'JSONEachRow'
    });
    const canonicalData = await canonical.json();
    console.log(`2. vw_trades_canonical:                       ${parseInt(canonicalData[0].trade_count).toLocaleString()} trades`);

    // Check vw_wallet_pnl_calculated
    const pnlCalc = await ch.query({
      query: `
        SELECT COUNT(*) as position_count
        FROM default.vw_wallet_pnl_calculated
        WHERE lower(wallet) = lower('${wallet.addr}')
      `,
      format: 'JSONEachRow'
    });
    const pnlData = await pnlCalc.json();
    console.log(`3. vw_wallet_pnl_calculated:                  ${parseInt(pnlData[0].position_count).toLocaleString()} positions`);

    // Check with different filters
    const pnlResolved = await ch.query({
      query: `
        SELECT
          COUNT(*) as total,
          COUNT(CASE WHEN payout_denominator > 0 THEN 1 END) as resolved,
          COUNT(CASE WHEN payout_denominator = 0 OR payout_denominator IS NULL THEN 1 END) as unresolved
        FROM default.vw_wallet_pnl_calculated
        WHERE lower(wallet) = lower('${wallet.addr}')
      `,
      format: 'JSONEachRow'
    });
    const pnlResolvedData = await pnlResolved.json();
    const pr = pnlResolvedData[0];
    console.log(`   - Resolved positions:                       ${parseInt(pr.resolved).toLocaleString()}`);
    console.log(`   - Unresolved positions:                     ${parseInt(pr.unresolved).toLocaleString()}\n`);

    // Check vw_wallet_total_pnl (if it exists)
    try {
      const totalPnl = await ch.query({
        query: `
          SELECT COUNT(*) as position_count
          FROM default.vw_wallet_total_pnl
          WHERE lower(wallet) = lower('${wallet.addr}')
        `,
        format: 'JSONEachRow'
      });
      const totalPnlData = await totalPnl.json();
      console.log(`4. vw_wallet_total_pnl:                       ${parseInt(totalPnlData[0].position_count).toLocaleString()} positions`);

      const totalPnlStatus = await ch.query({
        query: `
          SELECT
            status,
            COUNT(*) as count
          FROM default.vw_wallet_total_pnl
          WHERE lower(wallet) = lower('${wallet.addr}')
          GROUP BY status
        `,
        format: 'JSONEachRow'
      });
      const statusData = await totalPnlStatus.json();
      statusData.forEach(s => {
        console.log(`   - ${s.status.padEnd(20)} ${parseInt(s.count).toLocaleString()}`);
      });
    } catch (e) {
      console.log(`4. vw_wallet_total_pnl:                       [View doesn't exist]`);
    }

    console.log('\n' + '─'.repeat(100));
    console.log(`COMPARISON:`);
    console.log(`  Raw trades:              ${parseInt(tradesData[0].trade_count).toLocaleString()}`);
    console.log(`  Unique positions:        ${parseInt(positionsData[0].position_count).toLocaleString()}`);
    console.log(`  vw_wallet_pnl_calc:      ${parseInt(pnlData[0].position_count).toLocaleString()}`);
    console.log(`  Polymarket predictions:  ${wallet.polymarket.toLocaleString()}`);
    console.log(`  `);
    console.log(`  ⚠️  GAP: ${wallet.polymarket - parseInt(positionsData[0].position_count)} positions missing`);
    console.log('─'.repeat(100));
  }

  console.log('\n═'.repeat(100));
  console.log('\n🔍 INVESTIGATION FINDINGS:\n');

  console.log('If position counts are consistent across fact_trades_clean → vw_trades_canonical → vw_wallet_pnl_calculated:');
  console.log('  → Data integrity is OK, but we have fewer positions than Polymarket counts\n');

  console.log('If position counts DROP significantly between tables:');
  console.log('  → We have a filtering/join issue losing data\n');

  console.log('If Polymarket counts are 10x our counts:');
  console.log('  → They count every order placement/modification as a "prediction"');
  console.log('  → We only count actual fills that moved shares\n');

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
