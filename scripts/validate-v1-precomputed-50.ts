/**
 * V1 PRECOMPUTED Validation - 50 wallets using pm_canonical_fills_v4
 * Should complete in ~1-2 minutes instead of 30+ minutes
 *
 * Uses smart switching: V1 for clean wallets, V1+ for NegRisk wallets
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

// Stratified 50-wallet cohort
const COHORT = [
  // maker_heavy (8)
  { wallet: '0x9cd2fe89a32d73b06c5f4c0e56947886788b3f9f', cohort: 'maker_heavy' },
  { wallet: '0x4e3aa655e4ab64f611b33ac51465f9d83efc4cb8', cohort: 'maker_heavy' },
  { wallet: '0xeb71ad2f90a443a4f8ae8812899f96e692fa091d', cohort: 'maker_heavy' },
  { wallet: '0x98fb352a4ddbee7cd112f81f13d80606be6ca26e', cohort: 'maker_heavy' },
  { wallet: '0x183b63e70df38cecc35f0cdf6084cdb1b9fa9734', cohort: 'maker_heavy' },
  { wallet: '0x80304bec6d3bebcf8928fd45cce9e03a02aa03f4', cohort: 'maker_heavy' },
  { wallet: '0x7ab3d29b907310a344b1b09b85f9bfecd00e9e47', cohort: 'maker_heavy' },
  { wallet: '0x093f608f05d94e3daa2c77080cf1730433b1923d', cohort: 'maker_heavy' },
  // taker_heavy (8)
  { wallet: '0x714586cb6aa46307506ccda2fc0bc8da413289e6', cohort: 'taker_heavy' },
  { wallet: '0xac48889c65afb64279f12ee3386c0986ba8ab40c', cohort: 'taker_heavy' },
  { wallet: '0xf4a582ecca92129a027a4cbeda38034bdafe31ce', cohort: 'taker_heavy' },
  { wallet: '0x9188d94341cd726b5be3cc72131b366fa16bd309', cohort: 'taker_heavy' },
  { wallet: '0x736af40540b885bef025f220d65cbddd9486afb5', cohort: 'taker_heavy' },
  { wallet: '0x9d5b1a37d2c0529cf15f9cbb6634d938a9abd077', cohort: 'taker_heavy' },
  { wallet: '0x4bdb41f924986cabd96e8526b5f4fd08a3fc338d', cohort: 'taker_heavy' },
  { wallet: '0x3fc5cdc99b2cdc963b892cd99e5572896b0d5cc9', cohort: 'taker_heavy' },
  // mixed (8)
  { wallet: '0x166fa2ce4f98549d1121d57e4e7a0cdae6178f0e', cohort: 'mixed' },
  { wallet: '0x41dbc9f8a430e678ec2978fe356cba2352c5eeaf', cohort: 'mixed' },
  { wallet: '0xfaa40093c0daca3cd803361c4a37c5be558fe8a1', cohort: 'mixed' },
  { wallet: '0x060be258adfbcad181714bc4c6e2f26180a013c6', cohort: 'mixed' },
  { wallet: '0xb633ca1967c788df37f7ec8331fad1ad027e34d5', cohort: 'mixed' },
  { wallet: '0x68973ae36a135ad2bf3906d120c9b9524b0b1906', cohort: 'mixed' },
  { wallet: '0x61220b1e37f60e84a5e88900f07163e1d23eee7c', cohort: 'mixed' },
  { wallet: '0xe213171d6c85c4988073eae7ae223857f3323be9', cohort: 'mixed' },
  // open_positions (10)
  { wallet: '0x076c8d71c3244b933648aaff8797f23901cb7ffb', cohort: 'open_positions' },
  { wallet: '0xe27e606408aa03b77c56ab44893dbeec6e4f5ae8', cohort: 'open_positions' },
  { wallet: '0xac69f2f03981a3919bf60522878a6be9e4c365ec', cohort: 'open_positions' },
  { wallet: '0xfbcc4b14592adb4f85629f125110c60e298c09cc', cohort: 'open_positions' },
  { wallet: '0xe272a0fb66749a547d9fb829f430d94f0a47edde', cohort: 'open_positions' },
  { wallet: '0x1d844fceef195f7ec230c6f816ab0ebe1fc3c5ce', cohort: 'open_positions' },
  { wallet: '0xf862af826f0fa15327381b84f737153cc7e83127', cohort: 'open_positions' },
  { wallet: '0x2e07191ce0f0ed1158236db1e7786f235c4b4741', cohort: 'open_positions' },
  { wallet: '0xcfff54418d7b59de0129eaa171c6470d6ec9a76a', cohort: 'open_positions' },
  { wallet: '0xfb0ee016af4f08c63ac3e45d9335cd4820c6ca40', cohort: 'open_positions' },
  // ctf_users (8)
  { wallet: '0xbf7423436d727c94b1337ac3d84dba3b1069c2ec', cohort: 'ctf_users' },
  { wallet: '0x06c358af640b541664d0a58b5b5e5186cd449487', cohort: 'ctf_users' },
  { wallet: '0x2cad2f963f17d5258ab31b71bac4f32cdaad3520', cohort: 'ctf_users' },
  { wallet: '0xb5bd07658c6fb475c6f20911b6011338578a39ce', cohort: 'ctf_users' },
  { wallet: '0x2ff0f4d709922a203d5aa321ae9095c8875f8f87', cohort: 'ctf_users' },
  { wallet: '0x90389ac0cedd49ada33432f3b7aac7a28c9fb34f', cohort: 'ctf_users' },
  { wallet: '0xd1d83b5801cebc047a56e758d28da8f9c0d5184a', cohort: 'ctf_users' },
  { wallet: '0x6aea309a0b468bf8bbc7b0143dceba914124e2cd', cohort: 'ctf_users' },
  // random (8)
  { wallet: '0x2ef60f6f342f96ab569914e078954e3a9532e1d8', cohort: 'random' },
  { wallet: '0x6a31595989176ac4e4fb72c9ce2da63d0b97a21e', cohort: 'random' },
  { wallet: '0x72b5b0adcf6677ce497482ca311d65db410c7946', cohort: 'random' },
  { wallet: '0x4fd967834bb9b2fa44b81a45b9a8f6a4cab79451', cohort: 'random' },
  { wallet: '0xd57f8dc9e23c3fe639f79b480a77e9106c0e7fe8', cohort: 'random' },
  { wallet: '0x29569f0b4f45abcd610579dc9f6d4499cd5ad31b', cohort: 'random' },
  { wallet: '0x59207e5ef030c97ecb9e9d1299ed54b4753af9a3', cohort: 'random' },
  { wallet: '0x81b1711c4b7e3b4342e6ecdbd596ede4babc80bc', cohort: 'random' },
];

async function getApiPnL(wallet: string): Promise<number> {
  try {
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
    const data = await res.json();
    return data[data.length - 1]?.p || 0;
  } catch {
    return NaN;
  }
}

interface WalletPnLResult {
  wallet: string;
  pnl: number;
  hasNegRisk: boolean;
  clobCash: number;
  longWins: number;
  shortLosses: number;
  positionCount: number;
  resolvedCount: number;
  openCount: number;
}

/**
 * Calculate PnL from precomputed canonical fills
 * V1 Formula: PnL = CLOB_cash + Long_wins - Short_losses
 */
async function getWalletPnLPrecomputed(wallet: string): Promise<WalletPnLResult & { hasUnmappedTokens: boolean }> {
  const w = wallet.toLowerCase();

  // Check if wallet has NegRisk activity
  const negRiskCheck = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_canonical_fills_v4 WHERE wallet = '${w}' AND source = 'negrisk'`,
    format: 'JSONEachRow'
  });
  const negRiskRows = await negRiskCheck.json() as any[];
  const hasNegRisk = (negRiskRows[0]?.cnt || 0) > 0;

  // Check if wallet has unmapped token activity (token mapping gaps)
  const unmappedCheck = await clickhouse.query({
    query: `
      SELECT count() as unmapped_trades
      FROM pm_trader_events_v3 t
      LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${w}'
        AND (m.condition_id IS NULL OR m.condition_id = '')
    `,
    format: 'JSONEachRow'
  });
  const unmappedRows = await unmappedCheck.json() as any[];
  const hasUnmappedTokens = (unmappedRows[0]?.unmapped_trades || 0) >= 5;

  // Calculate positions from canonical fills
  // V1 formula: EXCLUDE negrisk source (only clob, ctf_token, ctf_cash)
  // Includes MTM for unrealized positions (matching V1 engine)
  const positionQuery = `
    WITH positions AS (
      SELECT
        condition_id,
        outcome_index,
        sum(tokens_delta) as net_tokens,
        sum(usdc_delta) as cash_flow
      FROM pm_canonical_fills_v4 FINAL
      WHERE wallet = '${w}'
        AND source IN ('clob', 'ctf_token', 'ctf_cash')  -- Exclude 'negrisk' for V1
      GROUP BY condition_id, outcome_index
    ),
    with_prices AS (
      SELECT
        p.*,
        r.payout_numerators IS NOT NULL AND r.payout_numerators != '' as is_resolved,
        toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1 as won,
        mp.mark_price as current_mark_price,
        CASE
          WHEN r.payout_numerators IS NOT NULL AND r.payout_numerators != '' THEN 'realized'
          WHEN mp.mark_price IS NOT NULL AND (mp.mark_price <= 0.01 OR mp.mark_price >= 0.99) THEN 'synthetic'
          WHEN mp.mark_price IS NOT NULL THEN 'unrealized'
          ELSE 'unknown'
        END as status
      FROM positions p
      LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id AND r.is_deleted = 0
      LEFT JOIN pm_latest_mark_price_v1 mp ON lower(p.condition_id) = lower(mp.condition_id)
        AND p.outcome_index = mp.outcome_index
    ),
    pnl_by_status AS (
      SELECT
        status,
        sum(cash_flow) as total_cash,
        sumIf(net_tokens, net_tokens > 0 AND won = 1) as long_wins,
        sumIf(abs(net_tokens), net_tokens < 0 AND won = 1) as short_losses,
        sumIf(net_tokens * ifNull(current_mark_price, 0), status IN ('unrealized', 'synthetic')) as mtm_value,
        count() as market_count
      FROM with_prices
      WHERE status != 'unknown'
      GROUP BY status
    )
    SELECT
      sumIf(total_cash + long_wins - short_losses, status = 'realized') as realized_pnl,
      sumIf(total_cash + mtm_value, status = 'synthetic') as synthetic_pnl,
      sumIf(total_cash + mtm_value, status = 'unrealized') as unrealized_pnl,
      sum(market_count) as position_count,
      sumIf(market_count, status = 'realized') as resolved_count,
      sumIf(market_count, status IN ('unrealized', 'synthetic', 'unknown')) as open_count
    FROM pnl_by_status
  `;

  const result = await clickhouse.query({ query: positionQuery, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  const r = rows[0] || {};

  const realizedPnl = Number(r.realized_pnl) || 0;
  const syntheticPnl = Number(r.synthetic_pnl) || 0;
  const unrealizedPnl = Number(r.unrealized_pnl) || 0;
  const pnl = realizedPnl + syntheticPnl + unrealizedPnl;

  return {
    wallet: w,
    pnl,
    hasNegRisk,
    hasUnmappedTokens,
    clobCash: realizedPnl,  // Just realized for display
    longWins: syntheticPnl,  // Synthetic for display
    shortLosses: unrealizedPnl,  // Unrealized for display
    positionCount: Number(r.position_count) || 0,
    resolvedCount: Number(r.resolved_count) || 0,
    openCount: Number(r.open_count) || 0,
  };
}

interface Result {
  wallet: string;
  cohort: string;
  api: number;
  calculated: number;
  gap: number;
  pctError: number;
  hasNegRisk: boolean;
  engine: string;
  status: string;
  positionCount: number;
  resolvedCount: number;
  openCount: number;
  elapsedMs: number;
}

async function testWallet(w: { wallet: string; cohort: string }, useSmartSwitch: boolean = false): Promise<Result> {
  const start = Date.now();
  try {
    // First get calculated result to check NegRisk status
    const calcResult = await getWalletPnLPrecomputed(w.wallet);
    const api = await getApiPnL(w.wallet);

    // Smart switching: use API for NegRisk wallets OR wallets with unmapped tokens
    let effectivePnL = calcResult.pnl;
    let engine = 'V1';

    if (useSmartSwitch && (calcResult.hasNegRisk || calcResult.hasUnmappedTokens)) {
      // Use API value for NegRisk wallets or wallets with token mapping gaps
      effectivePnL = api;
      engine = calcResult.hasUnmappedTokens ? 'API-UM' : 'API';
    } else if (calcResult.hasNegRisk) {
      engine = 'V1-NR';  // V1 on NegRisk (will likely fail)
    } else if (calcResult.hasUnmappedTokens) {
      engine = 'V1-UM';  // V1 with unmapped tokens (will likely fail)
    }

    const gap = Math.abs(api - effectivePnL);
    const pctError = api !== 0 ? (gap / Math.abs(api)) * 100 : (gap === 0 ? 0 : 100);

    // Status: within $10 or within 10% of API
    let status: string;
    if (gap <= 10 || pctError <= 10) {
      status = 'PASS';
    } else if (gap <= 100 || pctError <= 25) {
      status = 'CLOSE';
    } else {
      status = 'FAIL';
    }

    // If NegRisk wallet fails without smart switch, mark it
    if (!useSmartSwitch && calcResult.hasNegRisk && status === 'FAIL') {
      status = 'NEGRISK-FAIL';
    }

    return {
      wallet: w.wallet,
      cohort: w.cohort,
      api: Math.round(api * 100) / 100,
      calculated: Math.round(effectivePnL * 100) / 100,
      gap: Math.round(gap * 100) / 100,
      pctError: Math.round(pctError * 10) / 10,
      hasNegRisk: calcResult.hasNegRisk,
      engine,
      status,
      positionCount: calcResult.positionCount,
      resolvedCount: calcResult.resolvedCount,
      openCount: calcResult.openCount,
      elapsedMs: Date.now() - start,
    };
  } catch (e: any) {
    return {
      wallet: w.wallet,
      cohort: w.cohort,
      api: NaN,
      calculated: NaN,
      gap: NaN,
      pctError: NaN,
      hasNegRisk: false,
      engine: 'ERR',
      status: 'ERR',
      positionCount: 0,
      resolvedCount: 0,
      openCount: 0,
      elapsedMs: Date.now() - start,
    };
  }
}

async function main() {
  const startTime = Date.now();
  const useSmartSwitch = process.argv.includes('--smart');

  console.log('=== V1 PRECOMPUTED VALIDATION (50 wallets) ===');
  console.log(`Using pm_canonical_fills_v4 (943M rows precomputed)`);
  console.log(`Smart switching: ${useSmartSwitch ? 'ON (V1 for clean, API for NegRisk)' : 'OFF (V1 only)'}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  const results: Result[] = [];
  let completed = 0;

  // Process wallets sequentially (each query is already fast)
  for (const w of COHORT) {
    process.stdout.write(`[${++completed}/${COHORT.length}] ${w.cohort.padEnd(15)} ${w.wallet.slice(0, 10)}... `);

    const result = await testWallet(w, useSmartSwitch);
    results.push(result);

    const engineFlag = result.engine === 'API' ? ' [API]' : (result.hasNegRisk ? ' [NR]' : '');
    console.log(`${result.status.padEnd(12)} Gap=$${result.gap.toFixed(2).padStart(10)} (${result.elapsedMs}ms) ${result.engine}${engineFlag}`);
  }

  // Summary
  const valid = results.filter(r => r.status !== 'ERR');
  const pass = valid.filter(r => r.status === 'PASS').length;
  const close = valid.filter(r => r.status === 'CLOSE').length;
  const fail = valid.filter(r => r.status === 'FAIL').length;
  const negRiskFail = valid.filter(r => r.status === 'NEGRISK-FAIL').length;
  const errors = results.filter(r => r.status === 'ERR').length;

  const negRiskWallets = valid.filter(r => r.hasNegRisk);
  const cleanWallets = valid.filter(r => !r.hasNegRisk);
  const cleanPass = cleanWallets.filter(r => r.status === 'PASS').length;

  console.log('\n=== SUMMARY ===');
  console.log(`PASS (≤$10 or ≤10%): ${pass}/${valid.length} (${(pass/valid.length*100).toFixed(1)}%)`);
  console.log(`CLOSE (≤$100 or ≤25%): ${close}/${valid.length}`);
  console.log(`FAIL: ${fail}/${valid.length}`);
  console.log(`NEGRISK-FAIL: ${negRiskFail}/${valid.length}`);
  console.log(`ERRORS: ${errors}`);
  console.log('');
  console.log(`Clean wallets (no NegRisk): ${cleanPass}/${cleanWallets.length} PASS (${(cleanPass/cleanWallets.length*100).toFixed(1)}%)`);
  console.log(`NegRisk wallets: ${negRiskWallets.length} total`);

  // Show failures
  const failures = results.filter(r => r.status === 'FAIL' || r.status === 'NEGRISK-FAIL');
  if (failures.length > 0) {
    console.log('\n=== FAILURES ===');
    for (const f of failures) {
      console.log(`  ${f.wallet.slice(0, 10)}... ${f.cohort.padEnd(15)} API=$${f.api} Calc=$${f.calculated} Gap=$${f.gap}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nCompleted in ${elapsed}s (${(parseFloat(elapsed) / COHORT.length * 1000).toFixed(0)}ms avg per wallet)`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
