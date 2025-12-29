/**
 * Check wallet tier classification
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const WALLETS = [
  '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', // W2
  '0x82a1b239e7e0ff25a2ac12a20b59fd6b5f90e03a', // darkrider11
];

async function main() {
  console.log('\n=== Wallet Tier Classification ===\n');

  for (const wallet of WALLETS) {
    console.log(`Wallet: ${wallet.slice(0, 10)}...`);

    try {
      const result = await clickhouse.query({
        query: `
          SELECT
            tier,
            clob_event_count,
            amm_event_count,
            split_count,
            merge_count,
            transfer_count,
            maker_count,
            taker_count,
            unresolved_pct,
            amm_dominance_pct,
            ctf_dominance_pct,
            transfer_dominance_pct,
            mm_likelihood_flag
          FROM trader_strict_classifier_v1_tbl
          WHERE lower(wallet_address) = lower('${wallet}')
        `,
        format: 'JSONEachRow'
      });
      const rows = await result.json() as any[];

      if (rows.length > 0) {
        const r = rows[0];
        console.log(`  Tier: ${r.tier}`);
        console.log(`  CLOB events: ${r.clob_event_count}`);
        console.log(`  AMM events: ${r.amm_event_count} (${r.amm_dominance_pct?.toFixed(1)}% dominance)`);
        console.log(`  Splits: ${r.split_count}, Merges: ${r.merge_count}`);
        console.log(`  Transfers: ${r.transfer_count} (${r.transfer_dominance_pct?.toFixed(1)}% dominance)`);
        console.log(`  Maker: ${r.maker_count}, Taker: ${r.taker_count}`);
        console.log(`  Unresolved: ${r.unresolved_pct?.toFixed(1)}%`);
        console.log(`  MM likelihood flag: ${r.mm_likelihood_flag}`);
      } else {
        console.log('  NOT FOUND in classifier table');
      }
    } catch (e) {
      console.log(`  ERROR: ${e}`);
    }

    console.log('');
  }

  // Get Tier A wallet count
  console.log('=== Tier Distribution ===');
  try {
    const tierResult = await clickhouse.query({
      query: `
        SELECT tier, count() as cnt
        FROM trader_strict_classifier_v1_tbl
        GROUP BY tier
        ORDER BY tier
      `,
      format: 'JSONEachRow'
    });
    const tiers = await tierResult.json() as any[];
    for (const t of tiers) {
      console.log(`Tier ${t.tier}: ${t.cnt.toLocaleString()} wallets`);
    }
  } catch (e) {
    console.log(`ERROR: ${e}`);
  }
}

main().catch(console.error);
