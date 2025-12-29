/**
 * Investigate Redemption Discrepancy V1
 *
 * Step 5: Compare pm_redemption_payouts_agg vs vw_ctf_ledger
 * to understand why they differ for our target wallet.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144';

async function main() {
  console.log('='.repeat(80));
  console.log('INVESTIGATING REDEMPTION DISCREPANCY');
  console.log('='.repeat(80));
  console.log('');

  // 1. pm_redemption_payouts_agg per-market breakdown
  console.log('--- pm_redemption_payouts_agg per-market breakdown ---');
  const q1 = `
    SELECT
      condition_id,
      redemption_payout,
      redemption_count,
      last_redemption
    FROM pm_redemption_payouts_agg
    WHERE lower(wallet) = lower('${WALLET}')
    ORDER BY redemption_payout DESC
  `;
  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const rows1 = (await r1.json()) as any[];
  console.log('Markets with redemptions:', rows1.length);
  for (const r of rows1) {
    console.log(
      '  ' +
        r.condition_id.slice(0, 16) +
        '... | $' +
        Number(r.redemption_payout).toFixed(2) +
        ' | count: ' +
        r.redemption_count
    );
  }

  // 2. vw_ctf_ledger per-market breakdown
  console.log('');
  console.log('--- vw_ctf_ledger per-market breakdown ---');
  const q2 = `
    SELECT
      condition_id,
      ctf_payouts,
      ctf_deposits,
      tokens_minted,
      tokens_burned
    FROM vw_ctf_ledger
    WHERE lower(wallet) = lower('${WALLET}')
    ORDER BY ctf_payouts DESC
  `;
  const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
  const rows2 = (await r2.json()) as any[];
  console.log('Conditions with activity:', rows2.length);
  for (const r of rows2) {
    console.log(
      '  ' +
        r.condition_id.slice(0, 16) +
        '... | payouts: $' +
        Number(r.ctf_payouts).toFixed(2) +
        ' | deposits: $' +
        Number(r.ctf_deposits).toFixed(2)
    );
  }

  // 3. Check if condition_ids match
  console.log('');
  console.log('--- condition_id overlap ---');
  const redemptionConditions = new Set(rows1.map((r) => r.condition_id.toLowerCase()));
  const ctfConditions = new Set(rows2.map((r) => r.condition_id.toLowerCase()));

  const inBoth = [...redemptionConditions].filter((c) => ctfConditions.has(c));
  const onlyRedemption = [...redemptionConditions].filter((c) => ctfConditions.has(c) === false);
  const onlyCtf = [...ctfConditions].filter((c) => redemptionConditions.has(c) === false);

  console.log('In pm_redemption_payouts_agg:', redemptionConditions.size);
  console.log('In vw_ctf_ledger:', ctfConditions.size);
  console.log('In both:', inBoth.length);
  console.log('Only in redemption:', onlyRedemption.length);
  console.log('Only in ctf_ledger:', onlyCtf.length);

  // Show condition_ids only in redemption
  if (onlyRedemption.length > 0) {
    console.log('');
    console.log('Condition_ids in pm_redemption_payouts_agg but NOT in vw_ctf_ledger:');
    for (const c of onlyRedemption) {
      const match = rows1.find((r) => r.condition_id.toLowerCase() === c);
      console.log('  ' + c.slice(0, 16) + '... | $' + Number(match?.redemption_payout || 0).toFixed(2));
    }
  }

  // 4. Check what tables pm_redemption_payouts_agg is built from
  console.log('');
  console.log('='.repeat(80));
  console.log('CHECKING DATA SOURCES');
  console.log('='.repeat(80));

  // Check pm_erc1155_transfers for redeem events
  console.log('');
  console.log('--- pm_erc1155_transfers (redeem events) ---');
  const q3 = `
    SELECT
      count(*) as events,
      sum(value) / 1e6 as total_value
    FROM pm_erc1155_transfers
    WHERE lower(address_from) = lower('${WALLET}')
      AND address_to = '0x0000000000000000000000000000000000000000'
  `;
  const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
  const rows3 = (await r3.json()) as any[];
  console.log('Redeem events (burns to zero address):', rows3[0]?.events);
  console.log('Total tokens burned:', rows3[0]?.total_value?.toFixed(2));

  // Check what builds vw_ctf_ledger
  console.log('');
  console.log('--- Checking vw_ctf_ledger source view ---');
  const q4 = `SHOW CREATE VIEW vw_ctf_ledger`;
  try {
    const r4 = await clickhouse.query({ query: q4, format: 'JSONEachRow' });
    const rows4 = (await r4.json()) as any[];
    console.log('View definition (first 500 chars):');
    const def = rows4[0]?.statement || rows4[0]?.create_view || JSON.stringify(rows4[0]);
    console.log(def.slice(0, 500) + '...');
  } catch (e: any) {
    console.log('Could not get view definition:', e.message);
    // Try as table
    const q4b = `SHOW CREATE TABLE vw_ctf_ledger`;
    const r4b = await clickhouse.query({ query: q4b, format: 'JSONEachRow' });
    const rows4b = (await r4b.json()) as any[];
    console.log(JSON.stringify(rows4b[0]).slice(0, 500));
  }

  // 5. Check pm_redemption_payouts_agg source
  console.log('');
  console.log('--- Checking pm_redemption_payouts_agg source ---');
  const q5 = `SHOW CREATE TABLE pm_redemption_payouts_agg`;
  try {
    const r5 = await clickhouse.query({ query: q5, format: 'JSONEachRow' });
    const rows5 = (await r5.json()) as any[];
    console.log(JSON.stringify(rows5[0]).slice(0, 500));
  } catch (e: any) {
    console.log('Error:', e.message);
  }
}

main().catch(console.error);
