#!/usr/bin/env npx tsx
/**
 * CALCULATE TOTAL WALLETS (ALL SOURCES)
 *
 * Include:
 * - CLOB trades
 * - ERC-1155 transfers (in progress but use what we have)
 * - ERC20 USDC transfers (complete)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getClickHouseClient } from './lib/clickhouse/client';

async function main() {
  const ch = getClickHouseClient();

  console.log('\n' + '='.repeat(100));
  console.log('TOTAL POLYMARKET WALLETS CALCULATION');
  console.log('='.repeat(100));

  console.log('\nCalculating unique wallets across ALL data sources...');
  console.log('This may take 1-2 minutes due to 387M USDC transfers...\n');

  const startTime = Date.now();

  try {
    const result = await ch.query({
      query: `
        SELECT COUNT(DISTINCT wallet) as total_wallets
        FROM (
          -- CLOB traders
          SELECT DISTINCT lower(wallet_address) as wallet
          FROM default.trade_direction_assignments
          WHERE wallet_address != ''

          UNION ALL

          -- ERC-1155 senders
          SELECT DISTINCT lower(from_address) as wallet
          FROM default.erc1155_transfers
          WHERE from_address != ''
            AND from_address != '0000000000000000000000000000000000000000'

          UNION ALL

          -- ERC-1155 receivers
          SELECT DISTINCT lower(to_address) as wallet
          FROM default.erc1155_transfers
          WHERE to_address != ''
            AND to_address != '0000000000000000000000000000000000000000'

          UNION ALL

          -- ERC20 USDC senders (from topics[1])
          SELECT DISTINCT lower(replaceAll(replaceAll(topics[2], '0x000000000000000000000000', ''), '0x', '')) as wallet
          FROM default.erc20_transfers_staging
          WHERE length(topics) >= 2
            AND topics[2] != ''

          UNION ALL

          -- ERC20 USDC receivers (from topics[2])
          SELECT DISTINCT lower(replaceAll(replaceAll(topics[3], '0x000000000000000000000000', ''), '0x', '')) as wallet
          FROM default.erc20_transfers_staging
          WHERE length(topics) >= 3
            AND topics[3] != ''
        )
      `,
      format: 'JSONEachRow'
    });

    const data = (await result.json())[0];
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('='.repeat(100));
    console.log('RESULTS');
    console.log('='.repeat(100));

    const totalWallets = parseInt(data.total_wallets);
    const duneWallets = 1507377;
    const difference = totalWallets - duneWallets;
    const coveragePct = (totalWallets / duneWallets * 100).toFixed(1);

    console.log(`\n  Total unique wallets: ${totalWallets.toLocaleString()}`);
    console.log(`  Query time: ${elapsed} seconds`);
    console.log(`\n  vs Dune Analytics:`);
    console.log(`    Dune:       ${duneWallets.toLocaleString()} wallets`);
    console.log(`    Ours:       ${totalWallets.toLocaleString()} wallets`);
    console.log(`    Difference: ${difference >= 0 ? '+' : ''}${difference.toLocaleString()} wallets`);
    console.log(`    Coverage:   ${coveragePct}%`);

    if (totalWallets >= duneWallets * 0.98 && totalWallets <= duneWallets * 1.02) {
      console.log(`\n  ✅ MATCH! Within 2% of Dune's count`);
    } else if (totalWallets >= duneWallets * 0.95) {
      console.log(`\n  ✅ CLOSE! Within 5% of Dune's count`);
    } else if (totalWallets > duneWallets) {
      console.log(`\n  ⚠️  We have MORE wallets than Dune (possible reasons: newer data, different filtering)`);
    } else {
      console.log(`\n  ⚠️  Still missing ${(duneWallets - totalWallets).toLocaleString()} wallets (${(100 - parseFloat(coveragePct)).toFixed(1)}%)`);
    }

    console.log(`\n  Data sources included:`);
    console.log(`    ✅ CLOB trades (trade_direction_assignments)`);
    console.log(`    ✅ ERC-1155 transfers (erc1155_transfers) - ${((7.93 / 11) * 100).toFixed(0)}% complete`);
    console.log(`    ✅ ERC20 USDC transfers (erc20_transfers_staging) - 387M rows`);

    console.log('\n' + '='.repeat(100));

  } catch (e: any) {
    console.error(`\n❌ Error: ${e.message}`);
    console.log(`\nThis query is expensive (387M+ rows). If it times out, we may need to:`);
    console.log(`  1. Increase query timeout`);
    console.log(`  2. Pre-aggregate wallet lists`);
    console.log(`  3. Use sampling for estimate`);
  }

  await ch.close();
}

main().catch(console.error);
