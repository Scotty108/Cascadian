#!/usr/bin/env tsx
/**
 * Fix vw_redemption_pnl to use vw_trades_ledger source
 * Phase 1: Complete P&L view rewrites for 31 on-chain markets
 *
 * Changes:
 * - Source: vw_trades_canonical → vw_trades_ledger
 * - Join: Use token_condition_market_map → vw_resolutions_truth path
 * - Calculation: Redemption P&L = (net_shares * payout_value) + net_cash
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  console.log('Updating vw_redemption_pnl with corrected source...\n');

  try {
    // Update vw_redemption_pnl to use vw_trades_ledger
    await ch.command({
      query: `
        CREATE OR REPLACE VIEW cascadian_clean.vw_redemption_pnl AS
        WITH positions_at_resolution AS (
          SELECT
            wallet,
            market_cid,
            outcome,
            sum(d_shares) AS net_shares,
            sum(d_cash) AS net_cash
          FROM cascadian_clean.vw_trades_ledger
          GROUP BY wallet, market_cid, outcome
        ),
        market_resolutions AS (
          SELECT
            m.market_id_cid AS market_cid,
            any(r.payout_numerators) AS payout_numerators,
            any(r.payout_denominator) AS payout_denominator,
            any(r.winning_index) AS winning_index
          FROM cascadian_clean.token_condition_market_map m
          INNER JOIN cascadian_clean.vw_resolutions_truth r
            ON r.condition_id_32b = lower(m.condition_id_32b)
          GROUP BY m.market_id_cid
        )
        SELECT
          p.wallet AS wallet,
          p.market_cid AS market_cid,
          p.outcome AS outcome,
          p.net_shares AS net_shares,
          p.net_cash AS net_cash,
          r.winning_index AS winning_index,
          if(
            p.outcome < length(r.payout_numerators),
            toFloat64(arrayElement(r.payout_numerators, p.outcome + 1)) / nullIf(toFloat64(r.payout_denominator), 0),
            0.
          ) AS payout_value,
          (p.net_shares * if(
            p.outcome < length(r.payout_numerators),
            toFloat64(arrayElement(r.payout_numerators, p.outcome + 1)) / nullIf(toFloat64(r.payout_denominator), 0),
            0.
          )) + p.net_cash AS redemption_pnl_usd
        FROM positions_at_resolution AS p
        INNER JOIN market_resolutions AS r ON r.market_cid = p.market_cid
        WHERE abs(p.net_shares) >= 0.01
      `,
    });

    console.log('✅ vw_redemption_pnl updated successfully\n');

    // Verify the view has data
    const testQuery = await ch.query({
      query: `
        SELECT
          count() as total_positions,
          count(DISTINCT wallet) as unique_wallets,
          count(DISTINCT market_cid) as unique_markets,
          sum(redemption_pnl_usd) as total_redemption_pnl
        FROM cascadian_clean.vw_redemption_pnl
        FORMAT JSONEachRow
      `,
      format: 'JSONEachRow',
    });

    const stats = await testQuery.json();
    console.log('View Statistics:');
    console.log(JSON.stringify(stats[0], null, 2));
    console.log('');

    // Check wallet 0x4ce7 specifically
    const walletQuery = await ch.query({
      query: `
        SELECT
          wallet,
          count() as redeemed_positions,
          count(DISTINCT market_cid) as markets_redeemed,
          sum(redemption_pnl_usd) as total_redemption_pnl
        FROM cascadian_clean.vw_redemption_pnl
        WHERE lower(wallet) = '0x4ce73141dbfce41e65db3723e31059a730f0abad'
        GROUP BY wallet
        FORMAT JSONEachRow
      `,
      format: 'JSONEachRow',
    });

    const walletData = await walletQuery.json();
    if (walletData.length > 0) {
      console.log('Wallet 0x4ce7 Redemption Data:');
      console.log(JSON.stringify(walletData[0], null, 2));
    } else {
      console.log('⚠️  No redemption data for wallet 0x4ce7');
      console.log('   This is expected if none of the 31 markets have been redeemed yet.');
    }

  } catch (error) {
    console.error('❌ Error updating view:', error);
    throw error;
  } finally {
    await ch.close();
  }
}

main();
