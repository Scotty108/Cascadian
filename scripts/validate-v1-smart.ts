/**
 * V1 SMART Validation - Fast batch query with confidence routing
 *
 * Strategy:
 * 1. Run fast batch query for all wallets (5s for 50)
 * 2. Detect wallets with ERC1155 transfers (phantom source)
 * 3. Flag LOW confidence wallets → use API instead
 * 4. Report accuracy for HIGH confidence wallets only
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';
import * as fs from 'fs';

// Stratified 50-wallet cohort
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

interface WalletDiagnostics {
  wallet: string;
  erc1155_in: number;
  erc1155_out: number;
  phantom_tokens: number;
  phantom_pct: number;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

// Get confidence diagnostics for all wallets in batch
async function batchDiagnostics(wallets: string[]): Promise<Map<string, WalletDiagnostics>> {
  const walletList = wallets.map(w => "'" + w + "'").join(',');

  const query = `
    WITH
      wallet_list AS (
        SELECT arrayJoin([${walletList}]) as wallet
      ),
      -- ERC1155 transfers IN (tokens received from other wallets)
      erc_in AS (
        SELECT
          lower(to_address) as wallet,
          sum(reinterpretAsUInt64(reverse(unhex(substring(value, 3))))) / 1e6 as tokens_in
        FROM pm_erc1155_transfers
        WHERE lower(to_address) IN (SELECT wallet FROM wallet_list)
          AND lower(from_address) NOT IN ('0x0000000000000000000000000000000000000000', '')
          AND is_deleted = 0
        GROUP BY lower(to_address)
      ),
      -- ERC1155 transfers OUT
      erc_out AS (
        SELECT
          lower(from_address) as wallet,
          sum(reinterpretAsUInt64(reverse(unhex(substring(value, 3))))) / 1e6 as tokens_out
        FROM pm_erc1155_transfers
        WHERE lower(from_address) IN (SELECT wallet FROM wallet_list)
          AND lower(to_address) NOT IN ('0x0000000000000000000000000000000000000000', '')
          AND is_deleted = 0
        GROUP BY lower(from_address)
      ),
      -- CLOB positions (phantom = sold more than bought)
      clob_phantom AS (
        SELECT
          t.trader_wallet as wallet,
          sumIf(t.token_amount / 1e6, t.side = 'sell') as total_sold,
          sumIf(t.token_amount / 1e6, t.side = 'buy') as total_bought
        FROM pm_trader_events_v3 t
        WHERE t.trader_wallet IN (SELECT wallet FROM wallet_list)
        GROUP BY t.trader_wallet
      )
    SELECT
      w.wallet,
      COALESCE(i.tokens_in, 0) as erc1155_in,
      COALESCE(o.tokens_out, 0) as erc1155_out,
      COALESCE(c.total_sold, 0) - COALESCE(c.total_bought, 0) as phantom_tokens,
      CASE WHEN COALESCE(c.total_sold, 0) > 0
           THEN round((COALESCE(c.total_sold, 0) - COALESCE(c.total_bought, 0)) / c.total_sold * 100, 1)
           ELSE 0 END as phantom_pct
    FROM wallet_list w
    LEFT JOIN erc_in i ON w.wallet = i.wallet
    LEFT JOIN erc_out o ON w.wallet = o.wallet
    LEFT JOIN clob_phantom c ON w.wallet = c.wallet
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];

  const diagMap = new Map<string, WalletDiagnostics>();
  for (const row of rows) {
    let confidence: 'high' | 'medium' | 'low' = 'high';
    let reason = '';

    // LOW if significant ERC1155 transfers
    if (row.erc1155_in > 1000 || row.erc1155_out > 1000) {
      confidence = 'low';
      reason = `ERC1155 transfers: in=${Math.round(row.erc1155_in)}, out=${Math.round(row.erc1155_out)}`;
    }
    // LOW if high phantom rate
    else if (row.phantom_pct > 20) {
      confidence = 'low';
      reason = `High phantom: ${row.phantom_pct}% of sold tokens`;
    }
    // MEDIUM if moderate phantom
    else if (row.phantom_pct > 5) {
      confidence = 'medium';
      reason = `Moderate phantom: ${row.phantom_pct}%`;
    }

    diagMap.set(row.wallet, {
      wallet: row.wallet,
      erc1155_in: row.erc1155_in,
      erc1155_out: row.erc1155_out,
      phantom_tokens: row.phantom_tokens,
      phantom_pct: row.phantom_pct,
      confidence,
      reason
    });
  }
  return diagMap;
}

// Batch PnL calculation (same as V1)
async function batchPnL(wallets: string[]): Promise<Map<string, number>> {
  const walletList = wallets.map(w => "'" + w + "'").join(',');

  const query = `
    WITH
      wallet_list AS (
        SELECT arrayJoin([${walletList}]) as wallet
      ),
      self_fills AS (
        SELECT trader_wallet as wallet, transaction_hash
        FROM pm_trader_events_v3
        WHERE trader_wallet IN (SELECT wallet FROM wallet_list)
        GROUP BY trader_wallet, transaction_hash
        HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
      ),
      clob_pos AS (
        SELECT
          t.trader_wallet as wallet,
          m.condition_id,
          m.outcome_index,
          sumIf(t.token_amount / 1e6, t.side = 'buy') - sumIf(t.token_amount / 1e6, t.side = 'sell') as clob_tokens,
          sumIf(t.usdc_amount / 1e6, t.side = 'sell') - sumIf(t.usdc_amount / 1e6, t.side = 'buy') as clob_cash
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE t.trader_wallet IN (SELECT wallet FROM wallet_list)
          AND m.condition_id != ''
          AND NOT (
            (t.trader_wallet, t.transaction_hash) IN (SELECT wallet, transaction_hash FROM self_fills)
            AND t.role = 'maker'
          )
        GROUP BY t.trader_wallet, m.condition_id, m.outcome_index
      ),
      ctf_tokens AS (
        SELECT wallet, condition_id, outcome_index, sum(shares_delta) as ctf_tokens
        FROM pm_ctf_split_merge_expanded
        WHERE wallet IN (SELECT wallet FROM wallet_list)
        GROUP BY wallet, condition_id, outcome_index
      ),
      negrisk_tokens AS (
        SELECT
          v.wallet,
          m.condition_id,
          m.outcome_index,
          sum(v.shares) as nr_tokens
        FROM vw_negrisk_conversions v
        JOIN pm_negrisk_token_map_v1 m ON v.token_id_hex = m.token_id_hex
        WHERE v.wallet IN (SELECT wallet FROM wallet_list)
          AND m.condition_id != ''
        GROUP BY v.wallet, m.condition_id, m.outcome_index
      ),
      combined AS (
        SELECT
          COALESCE(c.wallet, f.wallet, n.wallet) as wallet,
          COALESCE(c.condition_id, f.condition_id, n.condition_id) as condition_id,
          COALESCE(c.outcome_index, f.outcome_index, n.outcome_index) as outcome_index,
          COALESCE(c.clob_tokens, 0) + COALESCE(f.ctf_tokens, 0) + COALESCE(n.nr_tokens, 0) as net_tokens,
          COALESCE(c.clob_cash, 0) as cash_flow
        FROM clob_pos c
        FULL OUTER JOIN ctf_tokens f ON c.wallet = f.wallet AND c.condition_id = f.condition_id AND c.outcome_index = f.outcome_index
        FULL OUTER JOIN negrisk_tokens n ON
          COALESCE(c.wallet, f.wallet) = n.wallet
          AND COALESCE(c.condition_id, f.condition_id) = n.condition_id
          AND COALESCE(c.outcome_index, f.outcome_index) = n.outcome_index
      ),
      with_status AS (
        SELECT
          cb.wallet,
          cb.net_tokens,
          cb.cash_flow,
          r.payout_numerators IS NOT NULL AND r.payout_numerators != '' as is_resolved,
          toInt64OrNull(JSONExtractString(r.payout_numerators, cb.outcome_index + 1)) = 1 as won
        FROM combined cb
        LEFT JOIN pm_condition_resolutions r ON cb.condition_id = r.condition_id AND r.is_deleted = 0
      ),
      wallet_pnl AS (
        SELECT
          wallet,
          sum(cash_flow) as total_cash,
          sumIf(net_tokens, net_tokens > 0 AND won = 1) as long_wins,
          sumIf(abs(net_tokens), net_tokens < 0 AND won = 1) as short_losses
        FROM with_status
        WHERE is_resolved = 1
        GROUP BY wallet
      )
    SELECT
      wallet,
      round(total_cash + long_wins - short_losses, 2) as realized_pnl
    FROM wallet_pnl
    ORDER BY wallet
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
  const outputFile = `scripts/v1-smart-${new Date().toISOString().replace(/:/g, '-').slice(0, 19)}.json`;

  console.log('=== V1 SMART VALIDATION (Confidence-Based Routing) ===');
  console.log(`Started: ${new Date().toISOString()}`);
  console.log(`Output: ${outputFile}\n`);

  // Step 1: Get diagnostics for all wallets
  console.log('Getting confidence diagnostics...');
  const diagStart = Date.now();
  const diagMap = await batchDiagnostics(COHORT);
  console.log(`Diagnostics: ${((Date.now() - diagStart) / 1000).toFixed(1)}s\n`);

  // Step 2: Batch calculate PnL
  console.log('Calculating batch PnL...');
  const batchStart = Date.now();
  const pnlMap = await batchPnL(COHORT);
  const batchTime = ((Date.now() - batchStart) / 1000).toFixed(1);
  console.log(`Batch PnL: ${batchTime}s\n`);

  // Step 3: Compare against API
  console.log('Comparing with API...\n');
  const results: any[] = [];

  const highConfWallets: any[] = [];
  const lowConfWallets: any[] = [];

  for (let i = 0; i < COHORT.length; i++) {
    const wallet = COHORT[i];
    const api = await getApiPnL(wallet);
    const calculated = pnlMap.get(wallet) || 0;
    const diag = diagMap.get(wallet) || {
      wallet,
      erc1155_in: 0,
      erc1155_out: 0,
      phantom_tokens: 0,
      phantom_pct: 0,
      confidence: 'high' as const,
      reason: ''
    };
    const gap = Math.abs(api - calculated);
    const status = gap <= 10 ? 'PASS' : (gap <= 100 ? 'CLOSE' : 'FAIL');

    const result = {
      wallet,
      api: Math.round(api * 100) / 100,
      calculated,
      gap: Math.round(gap * 100) / 100,
      status,
      confidence: diag.confidence,
      reason: diag.reason,
      erc1155_in: Math.round(diag.erc1155_in),
      phantom_pct: diag.phantom_pct
    };
    results.push(result);

    const confIcon = diag.confidence === 'high' ? '✓' : (diag.confidence === 'medium' ? '~' : '✗');
    process.stdout.write(`[${i + 1}/${COHORT.length}] ${wallet.slice(0, 10)}... ${status.padEnd(5)} Gap=$${gap.toFixed(0).padStart(6)} [${confIcon}${diag.confidence.padEnd(6)}]${diag.reason ? ' ' + diag.reason : ''}\n`);

    if (diag.confidence === 'high') {
      highConfWallets.push(result);
    } else {
      lowConfWallets.push(result);
    }

    if (i % 10 === 9) await new Promise(r => setTimeout(r, 500));
  }

  // Summary
  const allPass = results.filter(r => r.status === 'PASS').length;
  const allClose = results.filter(r => r.status === 'CLOSE').length;
  const allFail = results.filter(r => r.status === 'FAIL').length;

  const highPass = highConfWallets.filter(r => r.status === 'PASS').length;
  const highClose = highConfWallets.filter(r => r.status === 'CLOSE').length;
  const highFail = highConfWallets.filter(r => r.status === 'FAIL').length;

  console.log('\n=== OVERALL SUMMARY ===');
  console.log(`PASS (≤$10): ${allPass}/${results.length} (${(allPass/results.length*100).toFixed(1)}%)`);
  console.log(`CLOSE (≤$100): ${allClose}/${results.length}`);
  console.log(`FAIL (>$100): ${allFail}/${results.length}`);

  console.log('\n=== HIGH CONFIDENCE ONLY ===');
  console.log(`Total: ${highConfWallets.length}/${results.length} wallets`);
  console.log(`PASS (≤$10): ${highPass}/${highConfWallets.length} (${(highPass/highConfWallets.length*100).toFixed(1)}%)`);
  console.log(`CLOSE (≤$100): ${highClose}/${highConfWallets.length}`);
  console.log(`FAIL (>$100): ${highFail}/${highConfWallets.length}`);

  console.log('\n=== LOW CONFIDENCE (Would route to API) ===');
  console.log(`Total: ${lowConfWallets.length}/${results.length} wallets`);
  for (const r of lowConfWallets) {
    console.log(`  ${r.wallet.slice(0, 10)}... ${r.reason}`);
  }

  console.log(`\nTotal time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);

  // Save results
  fs.writeFileSync(outputFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    batchTime,
    summary: {
      total: results.length,
      highConfidence: highConfWallets.length,
      lowConfidence: lowConfWallets.length,
      highConfAccuracy: `${highPass}/${highConfWallets.length} PASS`,
    },
    results
  }, null, 2));
  console.log(`Results saved to: ${outputFile}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
