#!/usr/bin/env npx tsx
/**
 * Validate the taker-only fix on a sample of 15 wallets
 * Compares our calculation with Polymarket Activity API
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

async function getPolymarketPnL(wallet: string): Promise<{ pnl: number; volume: number } | null> {
  try {
    // Try the profile endpoint first
    let resp = await fetch(`https://data-api.polymarket.com/profile/${wallet}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data.pnl !== undefined) {
        return {
          pnl: parseFloat(data.pnl || '0'),
          volume: parseFloat(data.volume || '0'),
        };
      }
    }

    // Fallback: calculate from activity (trades + redemptions)
    resp = await fetch(`https://data-api.polymarket.com/activity?user=${wallet}&limit=1000`);
    if (!resp.ok) return null;
    const activities = await resp.json() as any[];

    // Sum up trades and redemptions to estimate PnL
    let totalSpent = 0;
    let totalReceived = 0;

    for (const a of activities) {
      if (a.type === 'TRADE') {
        if (a.side === 'BUY') {
          totalSpent += parseFloat(a.usdcSize || 0);
        } else if (a.side === 'SELL') {
          totalReceived += parseFloat(a.usdcSize || 0);
        }
      } else if (a.type === 'REDEEM') {
        totalReceived += parseFloat(a.usdcSize || 0);
      }
    }

    return {
      pnl: totalReceived - totalSpent,
      volume: totalSpent + totalReceived,
    };
  } catch (e) {
    console.error(`Error fetching PM data for ${wallet}:`, e);
    return null;
  }
}

async function calculatePnL(wallet: string, takerOnly: boolean): Promise<number> {
  const takerFilter = takerOnly ? "AND event_id LIKE '%-t'" : '';

  const result = await clickhouse.query({
    query: `
      WITH
        filtered_events AS (
          SELECT event_id, side, usdc_amount, token_amount, token_id
          FROM pm_trader_events_v2
          WHERE is_deleted = 0
            AND trader_wallet = '${wallet}'
            ${takerFilter}
        ),
        deduped_trades AS (
          SELECT event_id, any(side) AS side, any(usdc_amount) / 1000000.0 AS usdc, any(token_amount) / 1000000.0 AS tokens, any(token_id) AS token_id
          FROM filtered_events
          GROUP BY event_id
        ),
        trades_mapped AS (
          SELECT m.condition_id, m.outcome_index, d.side, d.usdc, d.tokens
          FROM deduped_trades d
          INNER JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
        ),
        positions AS (
          SELECT condition_id, outcome_index, sum(if(side = 'buy', -usdc, usdc)) AS cash_flow, sum(if(side = 'buy', tokens, -tokens)) AS shares
          FROM trades_mapped
          GROUP BY condition_id, outcome_index
        ),
        with_resolution AS (
          SELECT p.*,
            CASE WHEN r.payout_numerators IS NULL THEN 0 WHEN JSONExtractInt(r.payout_numerators, p.outcome_index + 1) >= 1000 THEN 1.0 ELSE toFloat64(JSONExtractInt(r.payout_numerators, p.outcome_index + 1)) END AS resolution_price
          FROM positions p
          LEFT JOIN pm_condition_resolutions r ON lower(p.condition_id) = lower(r.condition_id)
        )
      SELECT sum(cash_flow + (shares * resolution_price)) as total_pnl FROM with_resolution
    `,
    format: 'JSONEachRow'
  });

  const rows = await result.json() as any[];
  return rows[0]?.total_pnl || 0;
}

async function main() {
  console.log('='.repeat(100));
  console.log('VALIDATING TAKER-ONLY FIX ON 15 WALLETS');
  console.log('='.repeat(100));

  // Get 15 wallets with significant PnL from our cohort table
  const walletsQ = await clickhouse.query({
    query: `
      SELECT wallet, realized_pnl_usd, omega
      FROM pm_cohort_pnl_active_v1
      WHERE abs(realized_pnl_usd) > 500 AND omega > 1 AND omega < 100
      ORDER BY rand()
      LIMIT 15
    `,
    format: 'JSONEachRow'
  });
  const wallets = await walletsQ.json() as any[];

  console.log(`\nTesting ${wallets.length} wallets...\n`);
  console.log('Wallet'.padEnd(44) + '| Old (all) | New (taker) | Polymarket | Ratio');
  console.log('-'.repeat(100));

  const results: any[] = [];

  for (const w of wallets) {
    const wallet = w.wallet;

    // Get Polymarket's number
    const pm = await getPolymarketPnL(wallet);

    // Calculate our numbers
    const oldPnl = await calculatePnL(wallet, false);  // All events
    const newPnl = await calculatePnL(wallet, true);   // Taker only

    const pmPnl = pm?.pnl || 0;
    const ratio = pmPnl !== 0 ? (newPnl / pmPnl) : 0;

    results.push({ wallet, oldPnl, newPnl, pmPnl, ratio });

    const oldStr = `$${oldPnl.toFixed(0)}`.padStart(10);
    const newStr = `$${newPnl.toFixed(0)}`.padStart(12);
    const pmStr = pm ? `$${pmPnl.toFixed(0)}`.padStart(11) : 'N/A'.padStart(11);
    const ratioStr = pm ? `${ratio.toFixed(2)}x`.padStart(6) : 'N/A'.padStart(6);

    console.log(`${wallet} | ${oldStr} | ${newStr} | ${pmStr} | ${ratioStr}`);

    // Small delay to not hammer the API
    await new Promise(r => setTimeout(r, 200));
  }

  // Summary stats
  const withPm = results.filter(r => r.pmPnl !== 0);
  const avgOldRatio = withPm.reduce((s, r) => s + (r.oldPnl / r.pmPnl), 0) / withPm.length;
  const avgNewRatio = withPm.reduce((s, r) => s + r.ratio, 0) / withPm.length;

  const closeMatches = withPm.filter(r => r.ratio >= 0.8 && r.ratio <= 1.2).length;
  const perfectMatches = withPm.filter(r => r.ratio >= 0.95 && r.ratio <= 1.05).length;

  console.log('\n' + '='.repeat(100));
  console.log('SUMMARY');
  console.log('='.repeat(100));
  console.log(`Wallets with Polymarket data: ${withPm.length}`);
  console.log(`Average OLD ratio (all events):  ${avgOldRatio.toFixed(2)}x`);
  console.log(`Average NEW ratio (taker only):  ${avgNewRatio.toFixed(2)}x`);
  console.log(`Close matches (0.8-1.2x):        ${closeMatches}/${withPm.length}`);
  console.log(`Perfect matches (0.95-1.05x):    ${perfectMatches}/${withPm.length}`);

  console.log('\nNote: Polymarket shows TOTAL PnL (realized + unrealized)');
  console.log('Our calculation shows REALIZED PnL only (resolved markets)');
  console.log('Differences are expected for wallets with open positions.');

  await clickhouse.close();
}

main().catch(console.error);
