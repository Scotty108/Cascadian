/**
 * Check Proxy Associations V1
 *
 * Investigate if pm_redemption_payouts_agg includes proxy wallet data.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../../lib/clickhouse/client';

const WALLET = '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144';

async function main() {
  console.log('='.repeat(80));
  console.log('CHECKING PROXY WALLET ASSOCIATIONS');
  console.log('='.repeat(80));
  console.log('');

  // Check vw_ctf_ledger_proxy for this wallet
  console.log('--- vw_ctf_ledger_proxy for wallet ---');
  const q2 = `
    SELECT wallet, wallet_type, count(*) as conditions, sum(ctf_payouts) as total_payouts
    FROM vw_ctf_ledger_proxy
    WHERE lower(wallet) = lower('${WALLET}')
    GROUP BY wallet, wallet_type
  `;
  const r2 = await clickhouse.query({ query: q2, format: 'JSONEachRow' });
  const proxyData = (await r2.json()) as any[];
  for (const p of proxyData) {
    console.log(
      '  wallet: ' +
        p.wallet +
        ' | type: ' +
        p.wallet_type +
        ' | conditions: ' +
        p.conditions +
        ' | payouts: $' +
        Number(p.total_payouts).toFixed(2)
    );
  }

  // Check Activity API for proxy wallet
  console.log('');
  console.log('--- Fetching proxy wallet from Activity API ---');
  const activityUrl = `https://data-api.polymarket.com/activity?user=${WALLET}&limit=1`;
  const actResp = await fetch(activityUrl, { headers: { accept: 'application/json' } });
  const activities = (await actResp.json()) as any[];
  if (activities.length > 0 && activities[0].proxyWallet) {
    const proxyWallet = activities[0].proxyWallet.toLowerCase();
    console.log('  Proxy wallet from API:', proxyWallet);

    // Check pm_redemption_payouts_agg for proxy wallet
    console.log('');
    console.log('--- pm_redemption_payouts_agg for proxy wallet ---');
    const q3 = `
      SELECT
        wallet,
        count(*) as markets,
        sum(redemption_payout) as total_payout
      FROM pm_redemption_payouts_agg
      WHERE lower(wallet) = lower('${proxyWallet}')
      GROUP BY wallet
    `;
    const r3 = await clickhouse.query({ query: q3, format: 'JSONEachRow' });
    const proxyRedemptions = (await r3.json()) as any[];
    for (const a of proxyRedemptions) {
      console.log(
        '  wallet: ' +
          a.wallet +
          ' | markets: ' +
          a.markets +
          ' | total: $' +
          Number(a.total_payout).toFixed(2)
      );
    }

    // Check vw_ctf_ledger for proxy wallet
    console.log('');
    console.log('--- vw_ctf_ledger for proxy wallet ---');
    const q4 = `
      SELECT
        count(*) as conditions,
        sum(ctf_payouts) as total_payouts
      FROM vw_ctf_ledger
      WHERE lower(wallet) = lower('${proxyWallet}')
    `;
    const r4 = await clickhouse.query({ query: q4, format: 'JSONEachRow' });
    const proxyCtf = (await r4.json()) as any[];
    console.log(
      '  conditions: ' +
        proxyCtf[0]?.conditions +
        ' | payouts: $' +
        Number(proxyCtf[0]?.total_payouts || 0).toFixed(2)
    );

    // Check pm_ctf_flows_inferred for proxy wallet
    console.log('');
    console.log('--- pm_ctf_flows_inferred for proxy wallet ---');
    const q5 = `
      SELECT
        count(*) as flows,
        countDistinct(condition_id) as conditions
      FROM pm_ctf_flows_inferred
      WHERE lower(wallet) = lower('${proxyWallet}')
        AND is_deleted = 0
    `;
    const r5 = await clickhouse.query({ query: q5, format: 'JSONEachRow' });
    const proxyFlows = (await r5.json()) as any[];
    console.log(
      '  flows: ' + proxyFlows[0]?.flows + ' | conditions: ' + proxyFlows[0]?.conditions
    );
  } else {
    console.log('  No proxy wallet found in Activity API response');
  }

  // Check pm_redemption_payouts_agg for main wallet
  console.log('');
  console.log('--- pm_redemption_payouts_agg for main wallet ---');
  const q6 = `
    SELECT
      wallet,
      count(*) as markets,
      sum(redemption_payout) as total_payout,
      sum(redemption_count) as total_redemptions
    FROM pm_redemption_payouts_agg
    WHERE lower(wallet) = lower('${WALLET}')
    GROUP BY wallet
  `;
  const r6 = await clickhouse.query({ query: q6, format: 'JSONEachRow' });
  const mainRedemptions = (await r6.json()) as any[];
  for (const a of mainRedemptions) {
    console.log(
      '  wallet: ' +
        a.wallet +
        ' | markets: ' +
        a.markets +
        ' | total: $' +
        Number(a.total_payout).toFixed(2) +
        ' | redemption_count: ' +
        a.total_redemptions
    );
  }

  console.log('');
  console.log('='.repeat(80));
  console.log('CONCLUSION');
  console.log('='.repeat(80));
}

main().catch(console.error);
