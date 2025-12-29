/**
 * Query explicit redemption data for a wallet
 * Used to understand how much on-chain redemption value exists vs synthetic
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144';

async function main() {
  console.log('='.repeat(80));
  console.log('EXPLICIT REDEMPTION DATA QUERY');
  console.log('='.repeat(80));
  console.log('Wallet:', WALLET);
  console.log('');

  // Query 1: pm_redemption_payouts_agg
  console.log('--- pm_redemption_payouts_agg ---');
  try {
    const q1 = await clickhouse.query({
      query: `
        SELECT
          sum(redemption_payout) as total_redemptions,
          count() as markets_count
        FROM pm_redemption_payouts_agg
        WHERE lower(wallet) = lower('${WALLET}')
      `,
      format: 'JSONEachRow',
    });
    const r1 = (await q1.json()) as any[];
    console.log('Total explicit redemptions:', `$${Number(r1[0]?.total_redemptions || 0).toFixed(2)}`);
    console.log('Markets with redemptions:', r1[0]?.markets_count || 0);
  } catch (err: any) {
    console.log('Error:', err.message);
  }
  console.log('');

  // Query 2: vw_ctf_ledger PayoutRedemption events
  console.log('--- vw_ctf_ledger PayoutRedemption events ---');
  try {
    const q2 = await clickhouse.query({
      query: `
        SELECT
          sum(payout_usdc) as total_payout_usdc,
          count() as event_count
        FROM vw_ctf_ledger
        WHERE lower(redeemer) = lower('${WALLET}')
          AND event_type = 'PayoutRedemption'
      `,
      format: 'JSONEachRow',
    });
    const r2 = (await q2.json()) as any[];
    console.log('Total payout USDC:', `$${Number(r2[0]?.total_payout_usdc || 0).toFixed(2)}`);
    console.log('Event count:', r2[0]?.event_count || 0);
  } catch (err: any) {
    console.log('Error:', err.message);
  }
  console.log('');

  // Query 3: pm_ctf_events PayoutRedemption
  console.log('--- pm_ctf_events PayoutRedemption ---');
  try {
    const q3 = await clickhouse.query({
      query: `
        SELECT
          sum(payout / 1000000.0) as total_payout_usdc,
          count() as event_count
        FROM pm_ctf_events
        WHERE lower(redeemer) = lower('${WALLET}')
          AND event_type = 'PayoutRedemption'
      `,
      format: 'JSONEachRow',
    });
    const r3 = (await q3.json()) as any[];
    console.log('Total payout USDC:', `$${Number(r3[0]?.total_payout_usdc || 0).toFixed(2)}`);
    console.log('Event count:', r3[0]?.event_count || 0);
  } catch (err: any) {
    console.log('Error:', err.message);
  }
  console.log('');

  // Query 4: Check what CTF event types exist for this wallet
  console.log('--- CTF Event Types for Wallet ---');
  try {
    const q4 = await clickhouse.query({
      query: `
        SELECT
          event_type,
          count() as cnt,
          sum(payout / 1000000.0) as total_payout
        FROM pm_ctf_events
        WHERE lower(redeemer) = lower('${WALLET}')
        GROUP BY event_type
        ORDER BY cnt DESC
      `,
      format: 'JSONEachRow',
    });
    const r4 = (await q4.json()) as any[];
    for (const row of r4) {
      console.log(`  ${row.event_type}: ${row.cnt} events, payout=$${Number(row.total_payout || 0).toFixed(2)}`);
    }
  } catch (err: any) {
    console.log('Error:', err.message);
  }
  console.log('');

  // Query 5: Sample explicit redemption records
  console.log('--- Sample Explicit Redemption Records (top 5 by value) ---');
  try {
    const q5 = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          payout / 1000000.0 as payout_usdc,
          amount / 1000000.0 as amount,
          block_timestamp
        FROM pm_ctf_events
        WHERE lower(redeemer) = lower('${WALLET}')
          AND event_type = 'PayoutRedemption'
        ORDER BY payout DESC
        LIMIT 5
      `,
      format: 'JSONEachRow',
    });
    const r5 = (await q5.json()) as any[];
    for (const row of r5) {
      const condShort = row.condition_id?.slice(0, 16) + '...';
      console.log(`  ${condShort} | payout=$${Number(row.payout_usdc).toFixed(2)} | amount=${Number(row.amount).toFixed(2)}`);
    }
  } catch (err: any) {
    console.log('Error:', err.message);
  }

  console.log('');
  console.log('='.repeat(80));
}

main().catch(console.error);
