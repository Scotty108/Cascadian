/**
 * Check Missing Conditions V1
 *
 * Investigate why 9 condition_ids are in pm_redemption_payouts_agg
 * but NOT in vw_ctf_ledger for our target wallet.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144';

// The 9 missing condition_ids (prefixes)
const missingConditionPrefixes = [
  '764326e4c75fcf9d',
  'a886b40d69b4733d',
  '6d250918ac8353e8',
  '60918e364dd0c217',
  'a1324f2f9d9bb179',
  '7f1422bae9b959f1',
  'c072009d8b559da5',
  '63c6bddf7681c31a',
  'dcf2271b7c57b7de',
];

async function main() {
  console.log('='.repeat(80));
  console.log('CHECKING MISSING CONDITION_IDS IN pm_ctf_flows_inferred');
  console.log('='.repeat(80));
  console.log('');

  // Check if ANY flows exist for this wallet in pm_ctf_flows_inferred
  const q1 = `
    SELECT count(*) as flows, countDistinct(condition_id) as conditions
    FROM pm_ctf_flows_inferred
    WHERE lower(wallet) = lower('${WALLET}')
      AND is_deleted = 0
  `;
  const r1 = await clickhouse.query({ query: q1, format: 'JSONEachRow' });
  const rows1 = (await r1.json()) as any[];
  console.log('Total flows for wallet in pm_ctf_flows_inferred:', rows1[0]?.flows);
  console.log('Total unique condition_ids:', rows1[0]?.conditions);

  // List all condition_ids for this wallet in pm_ctf_flows_inferred
  console.log('');
  console.log('--- Condition_ids in pm_ctf_flows_inferred ---');
  const q2 = `
    SELECT
      condition_id,
      count(*) as flows,
      sum(usdc_delta) as total_usdc,
      sumIf(usdc_delta, flow_type IN ('REDEEM', 'MERGE', 'BURN')) as payout_usdc
    FROM pm_ctf_flows_inferred
    WHERE lower(wallet) = lower('${WALLET}')
      AND is_deleted = 0
    GROUP BY condition_id
    ORDER BY payout_usdc DESC
  `;
  const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
  const rows2 = (await r2.json()) as any[];
  console.log('Conditions found:', rows2.length);
  for (const r of rows2) {
    console.log(
      '  ' +
        r.condition_id.slice(0, 16) +
        '... | flows: ' +
        r.flows +
        ' | payout: $' +
        Number(r.payout_usdc).toFixed(2)
    );
  }

  // Get full condition_ids from pm_redemption_payouts_agg for comparison
  console.log('');
  console.log('--- Full condition_ids from pm_redemption_payouts_agg ---');
  const q3 = `
    SELECT condition_id, redemption_payout
    FROM pm_redemption_payouts_agg
    WHERE lower(wallet) = lower('${WALLET}')
    ORDER BY redemption_payout DESC
  `;
  const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
  const redemptionConditions = (await r3.json()) as any[];

  const ctfConditions = new Set(rows2.map((r) => r.condition_id.toLowerCase()));

  console.log('');
  console.log('--- Missing condition_ids (in redemption but not in ctf_flows) ---');
  let missingTotal = 0;
  const missingFullIds: string[] = [];
  for (const r of redemptionConditions) {
    if (!ctfConditions.has(r.condition_id.toLowerCase())) {
      console.log(
        '  ' + r.condition_id.slice(0, 32) + '... | $' + Number(r.redemption_payout).toFixed(2)
      );
      missingTotal += Number(r.redemption_payout);
      missingFullIds.push(r.condition_id);
    }
  }
  console.log('');
  console.log('Total missing redemption value: $' + missingTotal.toFixed(2));

  // Check if these conditions exist globally in pm_ctf_flows_inferred
  console.log('');
  console.log('--- Do missing conditions exist globally? ---');
  for (const condId of missingFullIds.slice(0, 3)) {
    const q4 = `
      SELECT count(*) as global_flows, countDistinct(wallet) as wallets
      FROM pm_ctf_flows_inferred
      WHERE condition_id = '${condId}'
    `;
    const r4 = await clickhouse.query({ query: q4, format: 'JSONEachRow' });
    const rows4 = (await r4.json()) as any[];
    console.log(
      '  ' +
        condId.slice(0, 16) +
        '... | global flows: ' +
        rows4[0]?.global_flows +
        ' | wallets: ' +
        rows4[0]?.wallets
    );
  }

  // Check if wallet trades these markets in CLOB
  console.log('');
  console.log('--- Do missing conditions appear in CLOB trades? ---');
  for (const condId of missingFullIds.slice(0, 3)) {
    const q5 = `
      SELECT count(*) as clob_trades, sum(usdc_amount) / 1e6 as total_usdc
      FROM pm_trader_events_dedup_v2_tbl
      WHERE lower(trader_wallet) = lower('${WALLET}')
        AND condition_id = '${condId}'
    `;
    const r5 = await clickhouse.query({ query: q5, format: 'JSONEachRow' });
    const rows5 = (await r5.json()) as any[];
    console.log(
      '  ' +
        condId.slice(0, 16) +
        '... | CLOB trades: ' +
        rows5[0]?.clob_trades +
        ' | $' +
        Number(rows5[0]?.total_usdc || 0).toFixed(2)
    );
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('ROOT CAUSE ANALYSIS');
  console.log('='.repeat(80));
}

main().catch(console.error);
