/**
 * Validate pm_canonical_fills_v4 against Polymarket API
 *
 * Uses the view vw_wallet_summary_v4 for fast querying.
 * Compares our calculated PnL against the official API.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';
import * as fs from 'fs';

// Stratified 50-wallet cohort (same as before)
const COHORT = [
  '0x9cd2fe89a32d73b06c5f4c0e56947886788b3f9f',
  '0x4e3aa655e4ab64f611b33ac51465f9d83efc4cb8',
  '0xeb71ad2f90a443a4f8ae8812899f96e692fa091d',
  '0x98fb352a4ddbee7cd112f81f13d80606be6ca26e',
  '0x183b63e70df38cecc35f0cdf6084cdb1b9fa9734',
  '0x80304bec6d3bebcf8928fd45cce9e03a02aa03f4',
  '0x7ab3d29b907310a344b1b09b85f9bfecd00e9e47',
  '0x093f608f05d94e3daa2c77080cf1730433b1923d',
  '0x714586cb6aa46307506ccda2fc0bc8da413289e6',
  '0xac48889c65afb64279f12ee3386c0986ba8ab40c',
  '0xf4a582ecca92129a027a4cbeda38034bdafe31ce',
  '0x9188d94341cd726b5be3cc72131b366fa16bd309',
  '0x736af40540b885bef025f220d65cbddd9486afb5',
  '0x9d5b1a37d2c0529cf15f9cbb6634d938a9abd077',
  '0x4bdb41f924986cabd96e8526b5f4fd08a3fc338d',
  '0x3fc5cdc99b2cdc963b892cd99e5572896b0d5cc9',
  '0x166fa2ce4f98549d1121d57e4e7a0cdae6178f0e',
  '0x41dbc9f8a430e678ec2978fe356cba2352c5eeaf',
  '0xfaa40093c0daca3cd803361c4a37c5be558fe8a1',
  '0x060be258adfbcad181714bc4c6e2f26180a013c6',
  '0xb633ca1967c788df37f7ec8331fad1ad027e34d5',
  '0x68973ae36a135ad2bf3906d120c9b9524b0b1906',
  '0x61220b1e37f60e84a5e88900f07163e1d23eee7c',
  '0xe213171d6c85c4988073eae7ae223857f3323be9',
  '0x076c8d71c3244b933648aaff8797f23901cb7ffb',
  '0xe27e606408aa03b77c56ab44893dbeec6e4f5ae8',
  '0xac69f2f03981a3919bf60522878a6be9e4c365ec',
  '0xfbcc4b14592adb4f85629f125110c60e298c09cc',
  '0xe272a0fb66749a547d9fb829f430d94f0a47edde',
  '0x1d844fceef195f7ec230c6f816ab0ebe1fc3c5ce',
  '0xf862af826f0fa15327381b84f737153cc7e83127',
  '0x2e07191ce0f0ed1158236db1e7786f235c4b4741',
  '0xcfff54418d7b59de0129eaa171c6470d6ec9a76a',
  '0xfb0ee016af4f08c63ac3e45d9335cd4820c6ca40',
  '0xbf7423436d727c94b1337ac3d84dba3b1069c2ec',
  '0x06c358af640b541664d0a58b5b5e5186cd449487',
  '0x2cad2f963f17d5258ab31b71bac4f32cdaad3520',
  '0xb5bd07658c6fb475c6f20911b6011338578a39ce',
  '0x2ff0f4d709922a203d5aa321ae9095c8875f8f87',
  '0x90389ac0cedd49ada33432f3b7aac7a28c9fb34f',
  '0xd1d83b5801cebc047a56e758d28da8f9c0d5184a',
  '0x6aea309a0b468bf8bbc7b0143dceba914124e2cd',
  '0x2ef60f6f342f96ab569914e078954e3a9532e1d8',
  '0x6a31595989176ac4e4fb72c9ce2da63d0b97a21e',
  '0x72b5b0adcf6677ce497482ca311d65db410c7946',
  '0x4fd967834bb9b2fa44b81a45b9a8f6a4cab79451',
  '0xd57f8dc9e23c3fe639f79b480a77e9106c0e7fe8',
  '0x29569f0b4f45abcd610579dc9f6d4499cd5ad31b',
  '0x59207e5ef030c97ecb9e9d1299ed54b4753af9a3',
  '0x81b1711c4b7e3b4342e6ecdbd596ede4babc80bc',
];

async function getCanonicalFillsStatus(): Promise<{total: number, bySource: Record<string, number>}> {
  const result = await clickhouse.query({
    query: `SELECT source, count() as cnt FROM pm_canonical_fills_v4 FINAL GROUP BY source`,
    format: 'JSONEachRow'
  });
  const rows = await result.json() as any[];
  const bySource: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    bySource[row.source] = row.cnt;
    total += row.cnt;
  }
  return { total, bySource };
}

async function getCalculatedPnL(wallets: string[]): Promise<Map<string, number>> {
  const walletList = wallets.map(w => `'${w}'`).join(',');

  // Use the view for fast calculation
  const query = `
    WITH
      position_pnl AS (
        SELECT
          p.wallet,
          p.condition_id,
          p.outcome_index,
          p.net_tokens,
          p.cash_flow,
          r.payout_numerators IS NOT NULL AND r.payout_numerators != '' as is_resolved,
          toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1 as won
        FROM vw_wallet_positions_v4 p
        LEFT JOIN pm_condition_resolutions r
          ON p.condition_id = r.condition_id AND r.is_deleted = 0
        WHERE p.wallet IN (${walletList})
      )
    SELECT
      wallet,
      round(sum(cash_flow) + sumIf(net_tokens, net_tokens > 0 AND won = 1) - sumIf(abs(net_tokens), net_tokens < 0 AND won = 1), 2) as realized_pnl
    FROM position_pnl
    GROUP BY wallet
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  const pnlMap = new Map<string, number>();
  for (const row of rows) {
    pnlMap.set(row.wallet, row.realized_pnl);
  }
  return pnlMap;
}

async function getApiPnL(wallet: string): Promise<number> {
  try {
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
    const data = await res.json();
    return data[data.length - 1]?.p || 0;
  } catch {
    return NaN;
  }
}

async function main() {
  const startTime = Date.now();
  const outputFile = `scripts/v4-validation-${new Date().toISOString().replace(/:/g, '-').slice(0, 19)}.json`;

  console.log('=== V4 CANONICAL FILLS VALIDATION ===');
  console.log(`Started: ${new Date().toISOString()}`);
  console.log(`Output: ${outputFile}\n`);

  // Check canonical fills status
  console.log('Checking canonical fills status...');
  const status = await getCanonicalFillsStatus();
  console.log(`  Total fills: ${(status.total / 1e6).toFixed(2)}M`);
  for (const [source, count] of Object.entries(status.bySource)) {
    console.log(`    ${source}: ${(count / 1e6).toFixed(2)}M`);
  }

  if (status.total < 1000) {
    console.log('\n⚠️  WARNING: Very few canonical fills. Backfill may still be running.');
    console.log('    Run this validation after backfill completes.\n');
  }

  // Get calculated PnL using VIEW (should be fast)
  console.log('\nCalculating PnL from canonical fills...');
  const calcStart = Date.now();
  const pnlMap = await getCalculatedPnL(COHORT);
  const calcTime = ((Date.now() - calcStart) / 1000).toFixed(2);
  console.log(`  Query time: ${calcTime}s for ${COHORT.length} wallets`);
  console.log(`  Wallets with data: ${pnlMap.size}/${COHORT.length}`);

  // Compare with API
  console.log('\nComparing with Polymarket API...\n');
  const results: any[] = [];

  for (let i = 0; i < COHORT.length; i++) {
    const wallet = COHORT[i];
    const api = await getApiPnL(wallet);
    const calculated = pnlMap.get(wallet) || 0;
    const gap = Math.abs(api - calculated);
    const status = gap <= 10 ? 'PASS' : (gap <= 100 ? 'CLOSE' : 'FAIL');

    results.push({
      wallet,
      api: Math.round(api * 100) / 100,
      calculated,
      gap: Math.round(gap * 100) / 100,
      status
    });

    process.stdout.write(`[${i + 1}/${COHORT.length}] ${wallet.slice(0, 10)}... ${status.padEnd(5)} Gap=$${gap.toFixed(2)}\n`);

    // Small delay to avoid rate limits
    if (i % 10 === 9) await new Promise(r => setTimeout(r, 500));
  }

  // Summary
  const pass = results.filter(r => r.status === 'PASS').length;
  const close = results.filter(r => r.status === 'CLOSE').length;
  const fail = results.filter(r => r.status === 'FAIL').length;
  const noData = results.filter(r => r.calculated === 0 && r.api !== 0).length;

  console.log('\n=== SUMMARY ===');
  console.log(`PASS (≤$10): ${pass}/${results.length} (${(pass/results.length*100).toFixed(1)}%)`);
  console.log(`CLOSE (≤$100): ${close}/${results.length}`);
  console.log(`FAIL (>$100): ${fail}/${results.length}`);
  if (noData > 0) {
    console.log(`\n⚠️  ${noData} wallets have $0 calculated but non-zero API - likely missing data`);
  }

  console.log(`\nTotal time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
  console.log(`  - PnL calculation: ${calcTime}s`);
  console.log(`  - API calls: ${((Date.now() - startTime) / 1000 - parseFloat(calcTime)).toFixed(1)}s`);

  // Save results
  fs.writeFileSync(outputFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    canonicalFillsStatus: status,
    queryTimeSeconds: parseFloat(calcTime),
    summary: { pass, close, fail, noData, total: results.length },
    results
  }, null, 2));
  console.log(`\nResults saved to: ${outputFile}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
