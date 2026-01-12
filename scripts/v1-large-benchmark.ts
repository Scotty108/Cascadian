/**
 * V1 Large CLOB-Only Benchmark
 *
 * Tests V1 on a larger pool of CLOB-only wallets
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { getWalletPnLV1 } from '../lib/pnl/pnlEngineV1';
import { clickhouse } from '../lib/clickhouse/client';

// Top wallets by volume - will filter to CLOB-only
const CANDIDATE_WALLETS = [
  '0xc5d563a36ae78145c45a50134d48a1215220f80a',
  '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e',
  '0xd218e474776403a330142299f7796e8ba32eb5c9',
  '0x204f72f35326db932158cba6adff0b9a1da95e14',
  '0x5bffcf561bcae83af680ad600cb99f1184d6ffbe',
  '0x63d43bbb87f85af03b8f2f9e2fad7b54334fa2f1',
  '0xe90bec87d9ef430f27f9dcfe72c34b76967d5da2',
  '0x9d84ce0306f8551e02efef1680475fc0f1dc1344',
  '0x24c8cf69a0e0a17eee21f69d29752bfa32e823e1',
  '0x16b29c50f2439faf627209b2ac0c7bbddaa8a881',
  '0x31519628fb5e5aa559d4ba27aa1248810b9f0977',
  '0xee00ba338c59557141789b127927a55f5cc5cea1',
  '0x44c1dfe43260c94ed4f1d00de2e1f80fb113ebc1',
  '0xed88d69d689f3e2f6d1f77b2e35d089c581df3c4',
  '0xb744f56635b537e859152d14b022af5afe485210',
  '0xf29bb8e0712075041e87e8605b69833ef738dd4c',
  '0xf8ba34bf0e95d952d05b578bfbc0833f9242a286',
  '0xc6587b11a2209e46dfe3928b31c5514a8e33b784',
  '0xe8dd7741ccb12350957ec71e9ee332e0d1e6ec86',
  '0x53757615de1c42b83f893b79d4241a009dc2aeea',
];

async function checkCTFActivity(wallet: string): Promise<{splits: number, merges: number, conversions: number}> {
  const [ctf, nr] = await Promise.all([
    clickhouse.query({
      query: `
        SELECT
          countIf(event_type = 'PositionSplit') as splits,
          countIf(event_type = 'PositionsMerge') as merges
        FROM pm_ctf_events
        WHERE lower(user_address) = '${wallet.toLowerCase()}' AND is_deleted = 0
      `,
      format: 'JSONEachRow'
    }),
    clickhouse.query({
      query: `
        SELECT count() as conversions
        FROM pm_neg_risk_conversions_v1
        WHERE lower(user_address) = '${wallet.toLowerCase()}' AND is_deleted = 0
      `,
      format: 'JSONEachRow'
    })
  ]);

  const ctfRow = ((await ctf.json()) as any[])[0] || {};
  const nrRow = ((await nr.json()) as any[])[0] || {};

  return {
    splits: Number(ctfRow.splits) || 0,
    merges: Number(ctfRow.merges) || 0,
    conversions: Number(nrRow.conversions) || 0
  };
}

async function fetchPolymarketPnL(wallet: string): Promise<number | null> {
  try {
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      return data[data.length - 1].p;
    }
    return null;
  } catch {
    return null;
  }
}

function formatValue(val: number | null): string {
  if (val === null) return 'ERROR';
  const abs = Math.abs(val);
  if (abs >= 1e6) return `$${(val / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

async function main() {
  console.log('═'.repeat(100));
  console.log('📊 V1 Large CLOB-Only Benchmark');
  console.log('═'.repeat(100));

  // Step 1: Filter to CLOB-only
  console.log('\n1. Filtering to CLOB-only wallets...');
  const clobOnly: string[] = [];

  for (const wallet of CANDIDATE_WALLETS) {
    const activity = await checkCTFActivity(wallet);
    if (activity.splits === 0 && activity.merges === 0 && activity.conversions === 0) {
      clobOnly.push(wallet);
      process.stdout.write('✓');
    } else {
      process.stdout.write('✗');
    }
  }
  console.log(`\n\nCLOB-only: ${clobOnly.length}/${CANDIDATE_WALLETS.length}`);

  // Step 2: Test V1 on CLOB-only
  console.log('\n2. Testing V1 on CLOB-only wallets...\n');

  let accurate = 0;
  let total = 0;
  const results: Array<{wallet: string, pm: number, v1: number, err: number}> = [];

  console.log('Wallet'.padEnd(44) + ' | ' + 'Polymarket'.padStart(12) + ' | ' + 'V1'.padStart(12) + ' | ' + 'Error'.padStart(8));
  console.log('-'.repeat(85));

  for (const wallet of clobOnly) {
    const pm = await fetchPolymarketPnL(wallet);
    if (pm === null) {
      console.log(wallet.padEnd(44) + ' | ' + 'N/A'.padStart(12) + ' |');
      continue;
    }

    let v1: number | null = null;
    try {
      const result = await getWalletPnLV1(wallet);
      v1 = result.total;
    } catch (e) {
      console.log(wallet.padEnd(44) + ' | ' + formatValue(pm).padStart(12) + ' | ' + 'ERROR'.padStart(12));
      continue;
    }

    const absErr = Math.abs(v1 - pm);
    const pctErr = pm !== 0 ? (absErr / Math.abs(pm)) * 100 : (v1 === 0 ? 0 : 100);
    const threshold = Math.max(100, Math.abs(pm) * 0.10);
    const isAccurate = absErr < threshold;

    total++;
    if (isAccurate) accurate++;

    results.push({ wallet, pm, v1, err: pctErr });

    console.log(
      wallet.padEnd(44) + ' | ' +
      formatValue(pm).padStart(12) + ' | ' +
      formatValue(v1).padStart(12) + ' | ' +
      `${pctErr.toFixed(1)}%`.padStart(8) +
      (isAccurate ? ' ✓' : '')
    );

    await new Promise(r => setTimeout(r, 100));
  }

  console.log('\n' + '═'.repeat(100));
  console.log('SUMMARY');
  console.log('═'.repeat(100));
  console.log(`CLOB-Only V1 Accuracy: ${accurate}/${total} (${(accurate/total*100).toFixed(0)}%)`);

  // Show worst errors
  const sorted = results.sort((a, b) => b.err - a.err);
  console.log('\nWorst errors:');
  for (const r of sorted.slice(0, 5)) {
    console.log(`  ${r.wallet.slice(0, 10)}... PM: ${formatValue(r.pm)}, V1: ${formatValue(r.v1)}, Err: ${r.err.toFixed(1)}%`);
  }
}

main().catch(console.error);
