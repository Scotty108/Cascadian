import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const CORRECT_WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const WRONG_WALLET = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';
const XI_CID_NORM = 'F2CE8D3897AC5009A131637D3575F1F91C579BD08EECCE6AE2B2DA0F32BBE6F1';
const XI_CID_LOWER = 'f2ce8d3897ac5009a131637d3575f1f91c579bd08eecce6ae2b2da0f32bbe6f1';
const XI_CID_0X = '0x' + XI_CID_LOWER;

async function traceXiMarketWallet() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('🔍 TRACING XI MARKET WALLET ATTRIBUTION');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  try {
    // Step 1: Check pm_wallet_market_pnl_v2 for Xi market
    console.log('STEP 1: Checking pm_wallet_market_pnl_v2 for Xi market\n');

    const pnlQuery = `
      SELECT
        wallet_address,
        condition_id_norm,
        total_trades,
        total_cost_usd,
        final_position_size,
        total_pnl_usd
      FROM pm_wallet_market_pnl_v2
      WHERE upper(condition_id_norm) = '${XI_CID_NORM}'
      ORDER BY total_trades DESC
    `;

    const pnlResult = await clickhouse.query({ query: pnlQuery, format: 'JSONEachRow' });
    const pnlData = await pnlResult.json<any[]>();

    console.log(`Found ${pnlData.length} wallets trading Xi market in pm_wallet_market_pnl_v2:\n`);
    if (pnlData.length > 0) {
      console.log('Wallet                                       | Trades | Cost         | Position     | PnL');
      console.log('---------------------------------------------|--------|--------------|--------------|-------------');
      pnlData.forEach(row => {
        const marker = row.wallet_address === CORRECT_WALLET ? ' ✅' :
                      row.wallet_address === WRONG_WALLET ? ' ❌' : '';
        const wallet = row.wallet_address.padEnd(44);
        const trades = Number(row.total_trades).toLocaleString().padStart(6);
        const cost = '$' + Number(row.total_cost_usd).toLocaleString().padStart(11);
        const position = Number(row.final_position_size).toLocaleString().padStart(12);
        const pnl = '$' + Number(row.total_pnl_usd).toLocaleString().padStart(11);
        console.log(`${wallet} | ${trades} | ${cost} | ${position} | ${pnl}${marker}`);
      });
    }
    console.log('');

    // Step 2: Check pm_trades_canonical_v3 for Xi market
    console.log('STEP 2: Checking pm_trades_canonical_v3 for Xi market\n');

    const tradesQuery = `
      SELECT
        lower(wallet_address) AS wallet,
        count() AS trades,
        sum(abs(usd_value)) AS volume
      FROM pm_trades_canonical_v3
      WHERE lower(replaceRegexpAll(condition_id_norm_v3, '^0x', '')) = '${XI_CID_LOWER}'
      GROUP BY wallet
      ORDER BY trades DESC
    `;

    const tradesResult = await clickhouse.query({ query: tradesQuery, format: 'JSONEachRow' });
    const tradesData = await tradesResult.json<any[]>();

    console.log(`Found ${tradesData.length} wallets trading Xi market in pm_trades_canonical_v3:\n`);
    if (tradesData.length > 0) {
      console.log('Wallet                                       | Trades | Volume');
      console.log('---------------------------------------------|--------|-------------');
      tradesData.forEach(row => {
        const marker = row.wallet === CORRECT_WALLET.toLowerCase() ? ' ✅' :
                      row.wallet === WRONG_WALLET.toLowerCase() ? ' ❌' : '';
        console.log(`${row.wallet} | ${Number(row.trades).toLocaleString().padStart(6)} | $${Number(row.volume).toLocaleString().padStart(11)}${marker}`);
      });
    }
    console.log('');

    // Step 3: Check ERC1155 transfers for Xi token
    console.log('STEP 3: Checking ERC1155 transfers for Xi tokens\n');

    // First, find Xi market token IDs from token map
    const tokenMapQuery = `
      SELECT
        erc1155_token_id_hex,
        outcome_index,
        outcome_label
      FROM pm_erc1155_token_map
      WHERE lower(condition_id) = '${XI_CID_0X}'
      ORDER BY outcome_index
    `;

    const tokenMapResult = await clickhouse.query({ query: tokenMapQuery, format: 'JSONEachRow' });
    const tokenMapData = await tokenMapResult.json<{ erc1155_token_id_hex: string; outcome_index: string; outcome_label: string }[]>();

    if (tokenMapData.length === 0) {
      console.log('⚠️  No token IDs found in pm_erc1155_token_map for Xi market\n');
    } else {
      console.log('Xi market token IDs:');
      tokenMapData.forEach(row => {
        console.log(`  Outcome ${row.outcome_index} (${row.outcome_label}): ${row.erc1155_token_id_hex}`);
      });
      console.log('');

      // Check erc1155_transfers for these token IDs
      for (const tokenRow of tokenMapData) {
        console.log(`Checking ERC1155 transfers for outcome ${tokenRow.outcome_index}...\n`);

        const transferQuery = `
          SELECT
            lower(from_address) AS from_addr,
            lower(to_address) AS to_addr,
            count() AS transfers,
            sum(value) AS total_value
          FROM erc1155_transfers
          WHERE lower(token_id) = lower('${tokenRow.erc1155_token_id_hex}')
            AND (lower(from_address) IN ('${CORRECT_WALLET.toLowerCase()}', '${WRONG_WALLET.toLowerCase()}')
                 OR lower(to_address) IN ('${CORRECT_WALLET.toLowerCase()}', '${WRONG_WALLET.toLowerCase()}'))
          GROUP BY from_addr, to_addr
          ORDER BY transfers DESC
          LIMIT 20
        `;

        try {
          const transferResult = await clickhouse.query({ query: transferQuery, format: 'JSONEachRow' });
          const transferData = await transferResult.json<any[]>();

          if (transferData.length === 0) {
            console.log('  ✓ No transfers involving our wallets\n');
          } else {
            console.log('  From                                         | To                                           | Transfers | Value');
            console.log('  ---------------------------------------------|----------------------------------------------|-----------|-------------');
            transferData.forEach(row => {
              const fromMarker = row.from_addr === CORRECT_WALLET.toLowerCase() ? ' ✅' :
                                row.from_addr === WRONG_WALLET.toLowerCase() ? ' ❌' : '';
              const toMarker = row.to_addr === CORRECT_WALLET.toLowerCase() ? ' ✅' :
                              row.to_addr === WRONG_WALLET.toLowerCase() ? ' ❌' : '';
              console.log(`  ${row.from_addr}${fromMarker} | ${row.to_addr}${toMarker} | ${Number(row.transfers).toLocaleString().padStart(9)} | ${Number(row.total_value).toLocaleString().padStart(11)}`);
            });
            console.log('');
          }
        } catch (error: any) {
          console.log(`  ⚠️  Query failed: ${error.message}\n`);
        }
      }
    }

    // Step 4: Get pm_trades_canonical_v3 view definition
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('STEP 4: Getting pm_trades_canonical_v3 view definition');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const viewDefQuery = `SHOW CREATE TABLE pm_trades_canonical_v3`;
    try {
      const viewDefResult = await clickhouse.query({ query: viewDefQuery, format: 'TabSeparated' });
      const viewDef = await viewDefResult.text();

      // Extract just the SELECT part
      const lines = viewDef.split('\n');
      const selectStart = lines.findIndex(line => line.includes('SELECT'));
      if (selectStart >= 0) {
        console.log('View SQL (truncated):');
        console.log(lines.slice(selectStart, Math.min(selectStart + 30, lines.length)).join('\n'));
        console.log('\n... (view definition continues) ...\n');
      }
    } catch (error: any) {
      console.log(`⚠️  Cannot get view definition: ${error.message}\n`);
    }

    // Step 5: Check ghost_market_wallets
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('STEP 5: Checking ghost_market_wallets');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    const ghostQuery = `
      SELECT *
      FROM ghost_market_wallets
      WHERE lower(condition_id) = '${XI_CID_0X}'
    `;

    try {
      const ghostResult = await clickhouse.query({ query: ghostQuery, format: 'JSONEachRow' });
      const ghostData = await ghostResult.json<any[]>();

      if (ghostData.length === 0) {
        console.log('✓ No entries in ghost_market_wallets for Xi market\n');
      } else {
        console.log(`Found ${ghostData.length} entries:\n`);
        ghostData.forEach(row => {
          const marker = row.wallet === CORRECT_WALLET ? ' ✅' :
                        row.wallet === WRONG_WALLET ? ' ❌' : '';
          console.log(JSON.stringify(row, null, 2) + marker);
        });
        console.log('');
      }
    } catch (error: any) {
      console.log(`⚠️  Query failed: ${error.message}\n`);
    }

    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════════════════════\n');

    console.log('✅ = Correct wallet (per Polymarket API)');
    console.log('❌ = Wrong wallet (misattributed trades)\n');

  } catch (error: any) {
    console.log('❌ ERROR:', error.message);
    console.error(error);
  }
}

traceXiMarketWallet().catch(console.error);
