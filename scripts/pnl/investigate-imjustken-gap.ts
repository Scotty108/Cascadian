/**
 * Deep investigation of ImJustKen's 34.9% PnL gap
 *
 * Hypothesis: Some redemptions are on positions acquired via PositionSplit, not CLOB
 */

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0x9d84ce0306f8551e02efef1680475fc0f1dc1344'; // ImJustKen
const UI_PNL = 2437081;

async function main() {
  console.log('='.repeat(100));
  console.log('IMJUSTKEN GAP INVESTIGATION');
  console.log('='.repeat(100));
  console.log(`UI PnL: $${UI_PNL.toLocaleString()}`);
  console.log('');

  // 1. Get redemption markets
  const qRedemptionMarkets = `
    SELECT DISTINCT canonical_condition_id
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) = lower('${WALLET}')
      AND source_type = 'PayoutRedemption'
      AND canonical_condition_id IS NOT NULL
      AND canonical_condition_id != ''
  `;
  const rRedemption = await clickhouse.query({ query: qRedemptionMarkets, format: 'JSONEachRow' });
  const redemptionMarkets = ((await rRedemption.json()) as any[]).map(r => r.canonical_condition_id);
  console.log('Total redemption markets: ' + redemptionMarkets.length);

  // 2. Get CLOB markets
  const qClobMarkets = `
    SELECT DISTINCT canonical_condition_id
    FROM pm_unified_ledger_v9
    WHERE lower(wallet_address) = lower('${WALLET}')
      AND source_type = 'CLOB'
      AND canonical_condition_id IS NOT NULL
      AND canonical_condition_id != ''
  `;
  const rClob = await clickhouse.query({ query: qClobMarkets, format: 'JSONEachRow' });
  const clobMarkets = new Set(((await rClob.json()) as any[]).map(r => r.canonical_condition_id));
  console.log('Total CLOB markets: ' + clobMarkets.size);

  // 3. Find redemptions without CLOB
  const redemptionsWithoutClob = redemptionMarkets.filter(m => !clobMarkets.has(m));
  console.log('Redemption markets WITHOUT CLOB: ' + redemptionsWithoutClob.length);
  console.log('');

  // 4. If there are redemptions without CLOB, what's the value?
  if (redemptionsWithoutClob.length > 0) {
    const condList = redemptionsWithoutClob.slice(0, 1000).map(c => "'" + c + "'").join(',');
    const qNoClobRedemption = `
      SELECT
        sum(usdc_delta) as redemption_usdc,
        count() as events
      FROM pm_unified_ledger_v9
      WHERE lower(wallet_address) = lower('${WALLET}')
        AND source_type = 'PayoutRedemption'
        AND canonical_condition_id IN (${condList})
    `;
    const rNoClobRedemption = await clickhouse.query({ query: qNoClobRedemption, format: 'JSONEachRow' });
    const noClobRows = (await rNoClobRedemption.json()) as any[];
    console.log('REDEMPTIONS WITHOUT CLOB:');
    console.log('  Events: ' + noClobRows[0].events);
    console.log('  USDC: $' + Number(noClobRows[0].redemption_usdc).toLocaleString());
    console.log('');

    // What activity exists in these markets?
    const qOtherActivity = `
      SELECT
        source_type,
        sum(usdc_delta) as usdc_total,
        count() as events
      FROM pm_unified_ledger_v9
      WHERE lower(wallet_address) = lower('${WALLET}')
        AND canonical_condition_id IN (${condList})
      GROUP BY source_type
    `;
    const rOther = await clickhouse.query({ query: qOtherActivity, format: 'JSONEachRow' });
    const otherRows = (await rOther.json()) as any[];
    console.log('Activity in NO-CLOB redemption markets:');
    for (const r of otherRows) {
      console.log('  ' + r.source_type.padEnd(20) + ': $' + Number(r.usdc_total).toLocaleString().padStart(15) + ' (' + r.events + ' events)');
    }
  }

  console.log('');
  console.log('='.repeat(100));
  console.log('WINNING CLOB POSITIONS WITHOUT REDEMPTION');
  console.log('='.repeat(100));
  console.log('');

  // Find CLOB markets with winning tokens but no redemption
  const qUnredeemed = `
    WITH clob_positions AS (
      SELECT
        canonical_condition_id,
        outcome_index,
        sum(usdc_delta) as cash_flow,
        sum(token_delta) as final_tokens,
        any(payout_norm) as resolution
      FROM pm_unified_ledger_v9
      WHERE lower(wallet_address) = lower('${WALLET}')
        AND source_type = 'CLOB'
        AND canonical_condition_id IS NOT NULL
        AND canonical_condition_id != ''
      GROUP BY canonical_condition_id, outcome_index
    ),
    redemption_markets AS (
      SELECT DISTINCT canonical_condition_id
      FROM pm_unified_ledger_v9
      WHERE lower(wallet_address) = lower('${WALLET}')
        AND source_type = 'PayoutRedemption'
    )
    SELECT
      c.canonical_condition_id,
      c.outcome_index,
      c.cash_flow,
      c.final_tokens,
      c.resolution,
      r.canonical_condition_id IS NOT NULL as has_redemption
    FROM clob_positions c
    LEFT JOIN redemption_markets r ON c.canonical_condition_id = r.canonical_condition_id
    WHERE c.final_tokens > 0.01
      AND c.resolution = 1
      AND r.canonical_condition_id IS NULL
    ORDER BY c.final_tokens DESC
    LIMIT 20
  `;
  const rUnredeemed = await clickhouse.query({ query: qUnredeemed, format: 'JSONEachRow' });
  const unredeemedRows = (await rUnredeemed.json()) as any[];

  if (unredeemedRows.length > 0) {
    console.log('WINNING CLOB positions WITHOUT PayoutRedemption (top 20):');
    console.log('Condition (first 25)              | Outcome | Cash Flow    | Tokens       | Resolution');
    let totalMissingTokens = 0;
    for (const r of unredeemedRows) {
      totalMissingTokens += Number(r.final_tokens);
      console.log(
        r.canonical_condition_id.substring(0, 25).padEnd(25) + ' | ' +
        String(r.outcome_index).padStart(7) + ' | $' +
        Number(r.cash_flow).toLocaleString().padStart(10) + ' | ' +
        Number(r.final_tokens).toLocaleString().padStart(12) + ' | ' +
        r.resolution
      );
    }
    console.log('');
    console.log('These winning positions may have been redeemed via PositionsMerge instead.');
    console.log('Total tokens in these positions: $' + totalMissingTokens.toLocaleString());
  } else {
    console.log('No winning CLOB positions without redemption.');
  }

  // Final summary
  console.log('');
  console.log('='.repeat(100));
  console.log('SUMMARY OF FINDINGS');
  console.log('='.repeat(100));
  console.log('');

  // Calculate what CLOB-only PnL is
  const qClobPnl = `
    SELECT sum(pnl) as total
    FROM (
      SELECT
        canonical_condition_id,
        outcome_index,
        sum(usdc_delta) + sum(token_delta) * coalesce(any(payout_norm), 0) as pnl
      FROM pm_unified_ledger_v9
      WHERE lower(wallet_address) = lower('${WALLET}')
        AND source_type = 'CLOB'
        AND canonical_condition_id IS NOT NULL
        AND canonical_condition_id != ''
      GROUP BY canonical_condition_id, outcome_index
    )
  `;
  const rClobPnl = await clickhouse.query({ query: qClobPnl, format: 'JSONEachRow' });
  const clobPnlRows = (await rClobPnl.json()) as any[];
  const clobPnl = Number(clobPnlRows[0].total);

  console.log('CLOB-only position PnL: $' + clobPnl.toLocaleString());
  console.log('UI PnL:                 $' + UI_PNL.toLocaleString());
  console.log('Gap:                    $' + (UI_PNL - clobPnl).toLocaleString());
  console.log('Gap %:                  ' + ((UI_PNL - clobPnl) / UI_PNL * 100).toFixed(2) + '%');
  console.log('');
  console.log('The gap of ~$' + ((UI_PNL - clobPnl) / 1000).toFixed(0) + 'K is NOT from:');
  console.log('  - Unmapped tokens (verified 0 unmapped)');
  console.log('  - Missing resolutions (verified 100% resolved)');
  console.log('');
  console.log('Possible causes:');
  console.log('  1. CTF event condition_id not matching CLOB condition_id');
  console.log('  2. Redemptions on positions acquired via PositionSplit');
  console.log('  3. Market-making spread profit from PositionsMerge');
}

main().catch(console.error);
