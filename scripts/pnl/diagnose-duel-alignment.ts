/**
 * Diagnose DUEL Alignment Bug
 *
 * Check if markets with explicit redemptions are being treated as resolved
 * in the V17 decomposition.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';
import { createV17Engine } from '../../lib/pnl/uiActivityEngineV17';

const WALLET = '0xd44e29936409019f93993de8bd603ef6cb1bb15e'; // Market maker with $3.4M redemptions

function formatUSD(value: number): string {
  const sign = value >= 0 ? '' : '-';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

async function getExplicitRedemptionsByMarket(wallet: string) {
  const query = `
    SELECT
      condition_id,
      sum(toFloat64OrNull(amount_or_payout) / 1000000.0) as redemption_amount,
      count() as redemption_count
    FROM pm_ctf_events
    WHERE lower(user_address) = lower('${wallet}')
      AND event_type = 'PayoutRedemption'
      AND is_deleted = 0
    GROUP BY condition_id
    ORDER BY redemption_amount DESC
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  return (await result.json()) as any[];
}

async function main() {
  console.log('='.repeat(100));
  console.log('DUEL ALIGNMENT DIAGNOSTIC');
  console.log('='.repeat(100));
  console.log('');
  console.log('Wallet:', WALLET);
  console.log('');

  // Get V17 positions
  const v17Engine = createV17Engine();
  const v17 = await v17Engine.compute(WALLET);

  console.log('--- V17 Position Summary ---');
  console.log(`Total positions: ${v17.positions_count}`);
  console.log(`Resolved positions: ${v17.positions.filter((p) => p.is_resolved).length}`);
  console.log(`Unresolved positions: ${v17.positions.filter((p) => !p.is_resolved).length}`);
  console.log('');

  // Get explicit redemptions by market
  const redemptions = await getExplicitRedemptionsByMarket(WALLET);
  const totalRedemptions = redemptions.reduce((s, r) => s + Number(r.redemption_amount), 0);

  console.log('--- Explicit Redemptions ---');
  console.log(`Total redemption amount: ${formatUSD(totalRedemptions)}`);
  console.log(`Markets with redemptions: ${redemptions.length}`);
  console.log('');

  // Build set of redeemed condition_ids
  const redeemedConditions = new Set(redemptions.map((r) => r.condition_id.toLowerCase()));

  // Check alignment: are redeemed markets in V17's resolved set?
  let alignedCount = 0;
  let misalignedCount = 0;
  let alignedRedemptionValue = 0;
  let misalignedRedemptionValue = 0;

  const misalignedMarkets: any[] = [];

  for (const r of redemptions) {
    const condId = r.condition_id.toLowerCase();

    // Find this market in V17 positions
    const v17Pos = v17.positions.find((p) => p.condition_id.toLowerCase() === condId);

    if (v17Pos && v17Pos.is_resolved) {
      alignedCount++;
      alignedRedemptionValue += Number(r.redemption_amount);
    } else {
      misalignedCount++;
      misalignedRedemptionValue += Number(r.redemption_amount);
      misalignedMarkets.push({
        condition_id: r.condition_id,
        redemption_amount: Number(r.redemption_amount),
        in_v17: !!v17Pos,
        v17_is_resolved: v17Pos?.is_resolved ?? null,
        v17_resolution_price: v17Pos?.resolution_price ?? null,
        v17_trade_cash_flow: v17Pos?.trade_cash_flow ?? null,
      });
    }
  }

  console.log('--- ALIGNMENT CHECK ---');
  console.log(`Aligned (redeemed + V17 resolved): ${alignedCount} markets, ${formatUSD(alignedRedemptionValue)}`);
  console.log(`MISALIGNED (redeemed but V17 NOT resolved): ${misalignedCount} markets, ${formatUSD(misalignedRedemptionValue)}`);
  console.log('');

  if (misalignedMarkets.length > 0) {
    console.log('--- TOP MISALIGNED MARKETS ---');
    console.log('');
    console.log('| Condition (16)   | Redemption   | In V17? | V17 Resolved? | V17 Res Price | V17 Cashflow |');
    console.log('|------------------|--------------|---------|---------------|---------------|--------------|');

    for (const m of misalignedMarkets.slice(0, 15)) {
      const condShort = m.condition_id.slice(0, 16) + '..';
      const inV17 = m.in_v17 ? 'YES' : 'NO';
      const resolved = m.v17_is_resolved === null ? 'N/A' : m.v17_is_resolved ? 'YES' : 'NO';
      const resPrice = m.v17_resolution_price === null ? 'null' : m.v17_resolution_price.toFixed(2);
      const cashflow = m.v17_trade_cash_flow === null ? 'N/A' : formatUSD(m.v17_trade_cash_flow);

      console.log(
        `| ${condShort.padEnd(16)} | ${formatUSD(m.redemption_amount).padStart(12)} | ${inV17.padStart(7)} | ${resolved.padStart(13)} | ${resPrice.padStart(13)} | ${cashflow.padStart(12)} |`
      );
    }
    console.log('');
  }

  // Calculate what the numbers SHOULD be if aligned
  console.log('--- IMPACT ANALYSIS ---');
  console.log('');

  // Current decomposition
  let currentResolvedCashflow = 0;
  let currentUnresolvedCashflow = 0;
  let currentSyntheticRedemptions = 0;

  for (const pos of v17.positions) {
    if (pos.is_resolved && pos.resolution_price !== null) {
      currentResolvedCashflow += pos.trade_cash_flow;
      currentSyntheticRedemptions += pos.final_shares * pos.resolution_price;
    } else {
      currentUnresolvedCashflow += pos.trade_cash_flow;
    }
  }

  console.log('Current (V17 resolution metadata):');
  console.log(`  resolved_trade_cashflow:   ${formatUSD(currentResolvedCashflow)}`);
  console.log(`  unresolved_trade_cashflow: ${formatUSD(currentUnresolvedCashflow)}`);
  console.log(`  synthetic_redemptions:     ${formatUSD(currentSyntheticRedemptions)}`);
  console.log(`  explicit_redemptions:      ${formatUSD(totalRedemptions)}`);
  console.log('');
  console.log(`  realized_economic: ${formatUSD(currentResolvedCashflow + currentSyntheticRedemptions)}`);
  console.log(`  realized_cash:     ${formatUSD(currentResolvedCashflow + totalRedemptions)}`);
  console.log('');

  // If we force redeemed markets to be resolved
  let forcedResolvedCashflow = 0;
  let forcedUnresolvedCashflow = 0;

  for (const pos of v17.positions) {
    const isRedeemed = redeemedConditions.has(pos.condition_id.toLowerCase());
    const shouldBeResolved = pos.is_resolved || isRedeemed;

    if (shouldBeResolved) {
      forcedResolvedCashflow += pos.trade_cash_flow;
    } else {
      forcedUnresolvedCashflow += pos.trade_cash_flow;
    }
  }

  console.log('If we FORCE redeemed markets into resolved bucket:');
  console.log(`  resolved_trade_cashflow:   ${formatUSD(forcedResolvedCashflow)}`);
  console.log(`  unresolved_trade_cashflow: ${formatUSD(forcedUnresolvedCashflow)}`);
  console.log(`  explicit_redemptions:      ${formatUSD(totalRedemptions)}`);
  console.log('');
  console.log(`  realized_cash (fixed):     ${formatUSD(forcedResolvedCashflow + totalRedemptions)}`);
  console.log('');

  // The bug magnitude
  const bugMagnitude = Math.abs(currentResolvedCashflow - forcedResolvedCashflow);
  console.log(`BUG MAGNITUDE: ${formatUSD(bugMagnitude)} cashflow misclassified`);
  console.log('');

  console.log('='.repeat(100));
}

main().catch(console.error);
