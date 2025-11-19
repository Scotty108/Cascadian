import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('DISCOVER ALL TRADER ADDRESSES FOR WALLET');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Target wallet: ${WALLET}\n`);

  console.log('Step 1: Find all transactions involving wallet in ERC1155 transfers...\n');

  // Find all tx_hashes where wallet sent or received ERC1155 tokens
  const txQuery = await clickhouse.query({
    query: `
      WITH w AS (
        SELECT lower('${WALLET}') AS w
      ),
      tx_hits AS (
        SELECT DISTINCT t.tx_hash
        FROM default.erc1155_transfers t, w
        WHERE lower(t.to_address) = w.w OR lower(t.from_address) = w.w
      )
      SELECT
        count(DISTINCT tx_hash) AS tx_count
      FROM tx_hits
    `,
    format: 'JSONEachRow'
  });

  const txResult: any[] = await txQuery.json();
  const txCount = txResult[0]?.tx_count || 0;

  console.log(`   Found ${txCount} transactions involving wallet\n`);

  console.log('Step 2: Find ALL trader addresses in those transactions...\n');

  // Find all distinct trader addresses from fills in those same transactions
  const tradersQuery = await clickhouse.query({
    query: `
      WITH w AS (
        SELECT lower('${WALLET}') AS w
      ),
      tx_hits AS (
        SELECT DISTINCT t.tx_hash
        FROM default.erc1155_transfers t, w
        WHERE lower(t.to_address) = w.w OR lower(t.from_address) = w.w
      )
      SELECT DISTINCT
        lower(f.proxy_wallet) AS trader
      FROM default.clob_fills f
      INNER JOIN tx_hits h ON h.tx_hash = f.tx_hash
      WHERE proxy_wallet != ''
      UNION DISTINCT
      SELECT DISTINCT
        lower(f.user_eoa) AS trader
      FROM default.clob_fills f
      INNER JOIN tx_hits h ON h.tx_hash = f.tx_hash
      WHERE user_eoa != ''
      ORDER BY trader
    `,
    format: 'JSONEachRow'
  });

  const traders: any[] = await tradersQuery.json();

  console.log(`   Found ${traders.length} unique trader addresses:\n`);

  traders.forEach((t, i) => {
    const isWallet = t.trader === WALLET.toLowerCase();
    console.log(`   ${i + 1}. ${t.trader} ${isWallet ? '← Target wallet' : ''}`);
  });
  console.log();

  // Check if wallet itself is in the list
  const walletInList = traders.some(t => t.trader === WALLET.toLowerCase());

  if (!walletInList) {
    console.log('⚠️  Target wallet NOT in trader list!');
    console.log('   This suggests wallet uses proxy addresses for trading\n');
  }

  console.log('Step 3: Check trade volume for each trader...\n');

  for (const trader of traders) {
    const statsQuery = await clickhouse.query({
      query: `
        SELECT
          count() AS trade_count,
          sum(abs(size)) AS total_shares,
          sum(abs(size * price)) AS total_notional
        FROM default.clob_fills
        WHERE lower(proxy_wallet) = '${trader.trader}' OR lower(user_eoa) = '${trader.trader}'
      `,
      format: 'JSONEachRow'
    });

    const stats: any[] = await statsQuery.json();
    const s = stats[0];

    console.log(`   ${trader.trader.substring(0, 10)}...`);
    console.log(`      Trades: ${parseInt(s.trade_count).toLocaleString()}`);
    console.log(`      Shares: ${parseFloat(s.total_shares).toLocaleString()}`);
    console.log(`      Notional: $${parseFloat(s.total_notional).toLocaleString()}\n`);
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`   Transactions found: ${txCount}`);
  console.log(`   Trader addresses: ${traders.length}`);
  console.log(`   Wallet in list: ${walletInList ? 'Yes ✅' : 'No ❌'}\n`);

  if (traders.length === 0) {
    console.log('❌ No trader addresses found');
    console.log('   This suggests a mapping gap between ERC1155 and CLOB tables\n');
  } else if (traders.length === 1 && walletInList) {
    console.log('✅ Only wallet address trades (no proxies)');
    console.log('   Gap must be from other causes (time range, fees, cost basis)\n');
  } else {
    console.log('✅ Found multiple trader addresses!');
    console.log('   This explains the P&L gap - missing proxy addresses\n');

    console.log('Next steps:');
    console.log('   1. Compute realized P&L for ALL traders');
    console.log('   2. Compare to Dune per-market breakdown');
    console.log('   3. Fix wallet_metrics to include all traders\n');
  }

  // Save for next script
  const fs = require('fs');
  fs.writeFileSync(
    'trader-addresses.json',
    JSON.stringify(traders.map(t => t.trader), null, 2)
  );
  console.log('Saved trader addresses to trader-addresses.json\n');

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
