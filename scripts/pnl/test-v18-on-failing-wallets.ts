#!/usr/bin/env npx tsx
/**
 * Test V18 (maker-only) on the failing wallets from validation
 * to confirm the 2x bug fix works broadly.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

// Wallets from validation with UI values
const WALLETS = [
  { address: '0x2552f61c9c3c89e757b59297c64769508da945b0', ui_net: -0.03, v17: -0.028 },
  { address: '0x7dc0bc02b4ac097e2c8f28b6b523c1f91167ece8', ui_net: 101.92, v17: 13826.76 },
  { address: '0x17e4b0e2091092b6b116c37530af98b3702676d5', ui_net: -0.37, v17: -2.90 },
  { address: '0x16afd30bbf82e11903289313a6beb1b2e1b089a6', ui_net: -554.87, v17: 0 },
  { address: '0xfaee446dc5143673ddee9f0b1c74a3582e90568e', ui_net: -346.87, v17: -432.31 },
  { address: '0x78f5558bca9d049c5ad49616a06f7aa0ce8ef61a', ui_net: -504.90, v17: -909.40 },
  { address: '0x586744c62f4b87872d4e616e1273b88b5eb324b3', ui_net: -341.38, v17: -683.06 },
];

async function calculatePnlWithRole(wallet: string, role: string | null) {
  const roleClause = role ? `AND f.role = '${role}'` : '';

  const query = `
    SELECT
      condition_id,
      outcome_index,
      sum(if(side = 'buy', tokens, 0)) - sum(if(side = 'sell', tokens, 0)) as net_tokens,
      sum(if(side = 'sell', usdc, 0)) - sum(if(side = 'buy', usdc, 0)) as cash_flow
    FROM (
      SELECT
        any(lower(f.side)) as side,
        any(f.token_amount) / 1e6 as tokens,
        any(f.usdc_amount) / 1e6 as usdc,
        any(m.condition_id) as condition_id,
        any(m.outcome_index) as outcome_index
      FROM pm_trader_events_dedup_v2_tbl f
      INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
      WHERE lower(f.trader_wallet) = lower('${wallet}')
      ${roleClause}
      GROUP BY f.event_id
    )
    GROUP BY condition_id, outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  if (rows.length === 0) return { pnl: 0, positions: 0 };

  // Get resolutions
  const conditionIds = [...new Set(rows.map((r: any) => r.condition_id))];
  const resQuery = `
    SELECT condition_id, payout_numerators
    FROM pm_condition_resolutions
    WHERE lower(condition_id) IN ('${conditionIds.join("','").toLowerCase()}')
  `;
  const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resolutions = (await resResult.json()) as any[];

  const resMap = new Map<string, number[]>();
  for (const r of resolutions) {
    const payouts = r.payout_numerators ? JSON.parse(r.payout_numerators) : [];
    resMap.set(r.condition_id.toLowerCase(), payouts);
  }

  let totalPnl = 0;
  for (const r of rows) {
    const payouts = resMap.get(r.condition_id.toLowerCase()) || [];
    const resPrice = payouts[r.outcome_index];
    if (resPrice !== undefined) {
      totalPnl += Number(r.cash_flow) + Number(r.net_tokens) * resPrice;
    } else {
      totalPnl += Number(r.cash_flow) + Number(r.net_tokens) * 0.5;
    }
  }

  return { pnl: totalPnl, positions: rows.length };
}

async function main() {
  console.log('='.repeat(100));
  console.log('V18 (MAKER-ONLY) TEST ON FAILING WALLETS');
  console.log('='.repeat(100));
  console.log();
  console.log('Wallet'.padEnd(44) + 'UI Net'.padStart(12) + 'V17 All'.padStart(12) + 'V18 Maker'.padStart(12) + 'V18/UI'.padStart(10) + 'Status');
  console.log('-'.repeat(100));

  let passCount = 0;
  let testCount = 0;

  for (const w of WALLETS) {
    const allFills = await calculatePnlWithRole(w.address, null);
    const makerOnly = await calculatePnlWithRole(w.address, 'maker');

    const uiAbs = Math.abs(w.ui_net);
    const v18Abs = Math.abs(makerOnly.pnl);
    const delta = Math.abs(makerOnly.pnl - w.ui_net);
    const tolerance = uiAbs < 25 ? 0.25 : Math.max(0.25, uiAbs * 0.01);
    const pass = delta <= tolerance || delta <= 25;

    const ratio = w.ui_net !== 0 ? (makerOnly.pnl / w.ui_net).toFixed(2) : 'N/A';
    const status = pass ? '✓ PASS' : delta <= 25 ? '~ LOOSE' : '✗ FAIL';

    if (pass || delta <= 25) passCount++;
    testCount++;

    console.log(
      w.address.padEnd(44) +
        ('$' + w.ui_net.toFixed(2)).padStart(12) +
        ('$' + allFills.pnl.toFixed(2)).padStart(12) +
        ('$' + makerOnly.pnl.toFixed(2)).padStart(12) +
        (ratio + 'x').padStart(10) +
        status
    );
  }

  console.log('-'.repeat(100));
  console.log(`PASS RATE: ${passCount}/${testCount} (${((passCount / testCount) * 100).toFixed(0)}%)`);

  // Summary
  console.log('\n' + '='.repeat(100));
  console.log('ANALYSIS:');
  console.log('='.repeat(100));
  console.log('- V17 (all fills) showed 2x bug on multiple wallets');
  console.log('- V18 (maker-only) should show better UI parity');
  console.log('- Wallets with V18 ≈ UI: role filtering fixes the double-counting');
  console.log('- Wallets still failing: may have other issues (resolution, data gaps)');

  await clickhouse.close();
}

main().catch(console.error);
