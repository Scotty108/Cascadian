/**
 * Profile failing wallets to understand what's missing
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const FAILING_WALLETS = [
  { wallet: '0x0060a1843fe53a54e9fdc403005da0b1ead44cc4', name: 'spot_3' },
  { wallet: '0xf380061e3ef5fa4d46341b269f75d57d6dc6c8b0', name: 'spot_6' },
  { wallet: '0x0015c5a76490d303e837d79dd5cf6a3825e4d5b0', name: 'overnight_test' },
];

interface Profile {
  clob: { trades: number; tx_hashes: number };
  ctf: Array<{ event_type: string; events: number; txs: number }>;
  nr: { conversions: number };
  overlap: { overlap: number };
}

async function profileWallet(wallet: string): Promise<Profile> {
  const w = wallet.toLowerCase();

  // 1. CLOB activity (no is_deleted for v3)
  const clobQ = `
    SELECT
      count() as trades,
      count(DISTINCT substring(event_id, 1, 66)) as tx_hashes
    FROM pm_trader_events_v3
    WHERE lower(trader_wallet) = '${w}'
  `;
  const clobRes = await clickhouse.query({ query: clobQ, format: 'JSONEachRow' });
  const clob = ((await clobRes.json()) as any[])[0];

  // 2. Direct CTF activity
  const ctfQ = `
    SELECT
      event_type,
      count() as events,
      count(DISTINCT tx_hash) as txs
    FROM pm_ctf_events
    WHERE lower(user_address) = '${w}'
      AND is_deleted = 0
    GROUP BY event_type
  `;
  const ctfRes = await clickhouse.query({ query: ctfQ, format: 'JSONEachRow' });
  const ctf = (await ctfRes.json()) as any[];

  // 3. NegRisk conversions
  const nrQ = `
    SELECT count() as conversions
    FROM pm_neg_risk_conversions_v1
    WHERE lower(user_address) = '${w}'
      AND is_deleted = 0
  `;
  const nrRes = await clickhouse.query({ query: nrQ, format: 'JSONEachRow' });
  const nr = ((await nrRes.json()) as any[])[0];

  // 4. Overlap check
  const overlapQ = `
    WITH
    clob_txs AS (
      SELECT DISTINCT substring(event_id, 1, 66) as tx_hash
      FROM pm_trader_events_v3
      WHERE lower(trader_wallet) = '${w}'
    ),
    ctf_txs AS (
      SELECT DISTINCT tx_hash
      FROM pm_ctf_events
      WHERE lower(user_address) = '${w}'
        AND is_deleted = 0
    )
    SELECT count() as overlap
    FROM ctf_txs c
    WHERE c.tx_hash IN (SELECT tx_hash FROM clob_txs)
  `;
  const overlapRes = await clickhouse.query({ query: overlapQ, format: 'JSONEachRow' });
  const overlap = ((await overlapRes.json()) as any[])[0];

  return { clob, ctf, nr, overlap };
}

async function main() {
  console.log('=== Failing Wallet Profiles ===\n');

  for (const { wallet, name } of FAILING_WALLETS) {
    const profile = await profileWallet(wallet);

    console.log(`${name} (${wallet.slice(0, 10)}...):`);
    console.log(`  CLOB: ${profile.clob.trades} trades, ${profile.clob.tx_hashes} txs`);

    const splits = profile.ctf.find((c) => c.event_type === 'PositionSplit');
    const merges = profile.ctf.find((c) => c.event_type === 'PositionsMerge');
    const redemptions = profile.ctf.find((c) => c.event_type === 'PayoutRedemption');

    console.log(`  Direct CTF Splits: ${splits?.events || 0} events, ${splits?.txs || 0} txs`);
    console.log(`  Direct CTF Merges: ${merges?.events || 0} events, ${merges?.txs || 0} txs`);
    console.log(`  Direct CTF Redemptions: ${redemptions?.events || 0} events, ${redemptions?.txs || 0} txs`);
    console.log(`  NegRisk Conversions: ${profile.nr.conversions}`);
    console.log(`  TX Overlap (CLOB∩CTF): ${profile.overlap.overlap}`);

    // Interpretation
    const totalDirectCTF = (splits?.events || 0) + (merges?.events || 0) + (redemptions?.events || 0);
    const offClobCTF = profile.overlap.overlap === 0 ? totalDirectCTF : 'needs analysis';
    console.log(`  → Off-CLOB CTF events: ${offClobCTF}`);
    console.log();
  }
}

main().catch(console.error);
