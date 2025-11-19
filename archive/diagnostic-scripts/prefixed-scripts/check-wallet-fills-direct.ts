import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('CHECK CLOB_FILLS FOR WALLET (DIRECT QUERY)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Target wallet: ${WALLET}\n`);

  // Check if wallet appears as proxy_wallet
  console.log('1. Checking proxy_wallet field...\n');

  const proxyQuery = await clickhouse.query({
    query: `
      SELECT
        count() AS trade_count,
        sum(abs(size)) AS total_shares,
        sum(abs(size * price)) AS total_notional,
        min(timestamp) AS first_trade,
        max(timestamp) AS last_trade
      FROM default.clob_fills
      WHERE lower(proxy_wallet) = lower('${WALLET}')
    `,
    format: 'JSONEachRow'
  });

  const proxyResult: any[] = await proxyQuery.json();
  const p = proxyResult[0];

  console.log(`   Trades as proxy_wallet: ${parseInt(p.trade_count).toLocaleString()}`);
  console.log(`   Total shares: ${parseFloat(p.total_shares).toLocaleString()}`);
  console.log(`   Total notional: $${parseFloat(p.total_notional).toLocaleString()}`);
  console.log(`   First trade: ${p.first_trade || 'N/A'}`);
  console.log(`   Last trade: ${p.last_trade || 'N/A'}\n`);

  // Check if wallet appears as user_eoa
  console.log('2. Checking user_eoa field...\n');

  const eoaQuery = await clickhouse.query({
    query: `
      SELECT
        count() AS trade_count,
        sum(abs(size)) AS total_shares,
        sum(abs(size * price)) AS total_notional,
        min(timestamp) AS first_trade,
        max(timestamp) AS last_trade
      FROM default.clob_fills
      WHERE lower(user_eoa) = lower('${WALLET}')
    `,
    format: 'JSONEachRow'
  });

  const eoaResult: any[] = await eoaQuery.json();
  const e = eoaResult[0];

  console.log(`   Trades as user_eoa: ${parseInt(e.trade_count).toLocaleString()}`);
  console.log(`   Total shares: ${parseFloat(e.total_shares).toLocaleString()}`);
  console.log(`   Total notional: $${parseFloat(e.total_notional).toLocaleString()}`);
  console.log(`   First trade: ${e.first_trade || 'N/A'}`);
  console.log(`   Last trade: ${e.last_trade || 'N/A'}\n`);

  // Combined
  console.log('3. Combined total (either field)...\n');

  const combinedQuery = await clickhouse.query({
    query: `
      SELECT
        count() AS trade_count,
        sum(abs(size)) AS total_shares,
        sum(abs(size * price)) AS total_notional
      FROM default.clob_fills
      WHERE lower(proxy_wallet) = lower('${WALLET}') OR lower(user_eoa) = lower('${WALLET}')
    `,
    format: 'JSONEachRow'
  });

  const combined: any[] = await combinedQuery.json();
  const c = combined[0];

  console.log(`   Total trades: ${parseInt(c.trade_count).toLocaleString()}`);
  console.log(`   Total shares: ${parseFloat(c.total_shares).toLocaleString()}`);
  console.log(`   Total notional: $${parseFloat(c.total_notional).toLocaleString()}\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('ASSESSMENT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const totalTrades = parseInt(c.trade_count);

  if (totalTrades === 0) {
    console.log('❌ ZERO trades found for this wallet in clob_fills');
    console.log('   This explains the P&L gap!\n');
    console.log('Possible causes:');
    console.log('   1. Wallet uses different proxy addresses');
    console.log('   2. Wrong table (maybe another clob_* table?)');
    console.log('   3. Data not ingested yet\n');

    console.log('Next step: Check which tables contain fills data\n');
    console.log('   Run: SELECT name FROM system.tables WHERE database = \'default\' AND name LIKE \'%clob%\'\n');
  } else {
    console.log(`✅ Found ${totalTrades.toLocaleString()} trades\n`);

    // Compare to expected
    const expectedNotional = 23426 / 0.5; // Very rough estimate
    const actualNotional = parseFloat(c.total_notional);

    if (actualNotional < 10000) {
      console.log(`⚠️  Notional value seems low ($${actualNotional.toLocaleString()})`);
      console.log(`   Expected ~$50K+ if wallet has $23K realized P&L\n`);
      console.log('This suggests we found some trades but may be missing others\n');
    } else {
      console.log(`✅ Notional value looks reasonable ($${actualNotional.toLocaleString()})\n`);
    }

    console.log('Next step: Check for other trader addresses via tx_hash\n');
  }

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
