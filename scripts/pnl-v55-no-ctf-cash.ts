/**
 * PnL Engine V55 - CORRECTED FORMULA (No CTF Cash)
 *
 * KEY INSIGHT: CTF split cash should NOT be included in PnL!
 * - Splits are economically neutral: pay $X USDC, get $X worth of tokens
 * - CTF tokens DO affect positions (included in net_tokens)
 * - CTF cash_delta is NOT cash flow - it's just token minting cost
 *
 * CORRECTED FORMULA:
 *   PnL = CLOB_cash + Long_wins - Short_losses
 *
 * Where:
 *   - CLOB_cash = sell_usdc - buy_usdc (from CLOB trading only)
 *   - Long_wins = tokens LONG on WINNING outcomes (worth $1 each)
 *   - Short_losses = tokens SHORT on WINNING outcomes (liability $1 each)
 *   - CTF tokens included in net_tokens calculation
 *   - Self-fills deduplicated (exclude maker side)
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

// 30 resolved-only wallets (same as V54 test)
const RESOLVED_WALLETS = [
  '0x7531814b44f1ba3d733d89c609a1cd95131853b9',
  '0x03b5561abd6ba733c3d93420ff7f4ffb28560bdc',
  '0x58d46b3067a7106bcb2b7a4bf2683490329469e1',
  '0x54147d0c04550bcfcbdf5cbe745d26cde1b52159',
  '0xec4f00f0936625debdc3b2c78469f7f2cddb5889',
  '0xe48d5eb56e62ea0ca465f850dd676dc1fa2ea875',
  '0x8a09b3461db00a0ebc3c8ab8fec6b7e993dd2c50',
  '0xb221801c9ba555994c8217916a0667653964a78c',
  '0xe5ddd343733a26f42b635ec805661bfce60c7ff2',
  '0x35ed4e9bcf8c5515df70a758ef6b55975e4135a1',
  '0x4a598a08f2721e9511471a81a7ffdff1dd003918',
  '0xeaf342ead1bbcc04858578ee48d94b2a77589356',
  '0x360d6ac75763c40797546a0b349423ba96df95ca',
  '0x965fa57f1d69dbbbf8ccfed976998317f4e08b54',
  '0x8117f6b452ef5d5cab36fee84e74624613ae83d6',
  '0xfa4b5c82170233c2fea9e838a636da7c3971e8a2',
  '0x697d53e380de4ae8c128bc051508be92db1cf522',
  '0xa277a0e326adc9cfa039a66dbab0b88f59ad28ad', // Previously failed, now should pass
  '0x9edaa823b1afde32ba24ad8685ebc47b2bdc955d',
  '0x6e5b74154dfeb3569fa832dda960db7910dfeb13',
  '0x27feeac4d1810109d6ee013ebee79b3c0cbfca08',
  '0x094855ace6ef48449d80817e489fae81a9a11ebb',
  '0xb76e20341eef70a03b696dc40619a3b414c04d5d',
  '0x79722f2123987b9e401fc8d4c64d22f0764ab3fa',
  '0x6dee6fe296bdb7f909202591a3e2fc792f8f9580',
  '0xd02de137c1bde3c5374e8123e7a1f764340f42de',
  '0xe06a03c8037ae33783603ade5d95a8165152bedd',
  '0x4474a552abb7fd82e5151957695de2e66657aad4',
  '0xac9a6affc32856a22a5e6bf9b7991165ffd771fd',
  '0x2ea795de9cd0bacb7196f12a196bc5a95eddd2b1',
];

async function getApiPnL(wallet: string): Promise<number> {
  try {
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
    if (res.ok) {
      const data = await res.json() as Array<{ t: number; p: number }>;
      if (data && data.length > 0) {
        return data[data.length - 1].p || 0;
      }
    }
  } catch {}
  return 0;
}

async function calculatePnLV55(wallet: string): Promise<{
  clobCash: number;
  longWins: number;
  shortLosses: number;
  totalPnl: number;
  tradeCount: number;
  ctfOps: number;
  selfFillTxs: number;
}> {
  const query = `
    WITH
      -- Step 1: Identify self-fill transactions
      self_fills AS (
        SELECT transaction_hash
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = '${wallet}'
        GROUP BY transaction_hash
        HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
      ),

      -- Step 2: CLOB positions (self-fill deduplicated)
      clob_pos AS (
        SELECT
          m.condition_id,
          m.outcome_index,
          sumIf(t.token_amount / 1e6, t.side = 'buy') - sumIf(t.token_amount / 1e6, t.side = 'sell') as clob_tokens,
          sumIf(t.usdc_amount / 1e6, t.side = 'sell') - sumIf(t.usdc_amount / 1e6, t.side = 'buy') as clob_cash
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${wallet}'
          AND m.condition_id != ''
          AND NOT (t.transaction_hash IN (SELECT transaction_hash FROM self_fills) AND t.role = 'maker')
        GROUP BY m.condition_id, m.outcome_index
      ),

      -- Step 3: CTF tokens only (NO CASH - splits are economically neutral)
      ctf_tokens AS (
        SELECT condition_id, outcome_index, sum(shares_delta) as ctf_tokens
        FROM pm_ctf_split_merge_expanded
        WHERE lower(wallet) = '${wallet}'
        GROUP BY condition_id, outcome_index
      ),

      -- Step 4: Combine CLOB + CTF
      combined AS (
        SELECT
          COALESCE(c.condition_id, f.condition_id) as condition_id,
          COALESCE(c.outcome_index, f.outcome_index) as outcome_index,
          COALESCE(c.clob_tokens, 0) + COALESCE(f.ctf_tokens, 0) as net_tokens,
          COALESCE(c.clob_cash, 0) as cash_flow  -- CLOB cash only!
        FROM clob_pos c
        FULL OUTER JOIN ctf_tokens f ON c.condition_id = f.condition_id AND c.outcome_index = f.outcome_index
      ),

      -- Step 5: Join resolutions
      with_res AS (
        SELECT
          cb.*,
          toInt64OrNull(JSONExtractString(r.payout_numerators, cb.outcome_index + 1)) = 1 as won
        FROM combined cb
        LEFT JOIN pm_condition_resolutions r ON cb.condition_id = r.condition_id AND r.is_deleted = 0
      ),

      -- Step 6: Aggregate
      agg AS (
        SELECT
          sum(cash_flow) as clob_cash,
          sumIf(net_tokens, net_tokens > 0 AND won = 1) as long_wins,
          sumIf(abs(net_tokens), net_tokens < 0 AND won = 1) as short_losses
        FROM with_res
      )

    SELECT
      round(clob_cash, 2) as clob_cash,
      round(long_wins, 2) as long_wins,
      round(short_losses, 2) as short_losses,
      round(clob_cash + long_wins - short_losses, 2) as total_pnl,
      (SELECT count() FROM pm_trader_events_v3 WHERE lower(trader_wallet) = '${wallet}') as trade_count,
      (SELECT count() FROM pm_ctf_split_merge_expanded WHERE lower(wallet) = '${wallet}') as ctf_ops,
      (SELECT count() FROM self_fills) as self_fill_txs
    FROM agg
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = (await result.json() as any[])[0] || {};

  return {
    clobCash: Number(data.clob_cash) || 0,
    longWins: Number(data.long_wins) || 0,
    shortLosses: Number(data.short_losses) || 0,
    totalPnl: Number(data.total_pnl) || 0,
    tradeCount: Number(data.trade_count) || 0,
    ctfOps: Number(data.ctf_ops) || 0,
    selfFillTxs: Number(data.self_fill_txs) || 0,
  };
}

// Sequential processing with concurrent API calls
async function processWallets(wallets: string[]): Promise<any[]> {
  const results: any[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    process.stdout.write(`[${String(i + 1).padStart(2)}/${wallets.length}] ${wallet.slice(0, 14)}... `);

    try {
      const [pnl, apiPnl] = await Promise.all([
        calculatePnLV55(wallet),
        getApiPnL(wallet),
      ]);

      const error = pnl.totalPnl - apiPnl;
      const absError = Math.abs(error);
      const status = absError <= 10 ? 'PASS' : absError <= 100 ? 'CLOSE' : 'FAIL';

      console.log(`Calc: ${pnl.totalPnl.toFixed(2).padStart(10)} | API: ${apiPnl.toFixed(2).padStart(10)} | Err: ${error.toFixed(2).padStart(10)} | ${status}`);

      results.push({ wallet, ...pnl, apiPnl, error, absError, status });
    } catch (err) {
      console.log(`ERROR: ${err}`);
    }
  }

  return results;
}

async function main() {
  console.log('='.repeat(80));
  console.log('PnL Engine V55 - CORRECTED FORMULA (No CTF Cash)');
  console.log('='.repeat(80));
  console.log('');
  console.log('FORMULA: PnL = CLOB_cash + Long_wins - Short_losses');
  console.log('');
  console.log('KEY INSIGHT: CTF split cash is NOT included because:');
  console.log('  - Splits are economically neutral (pay $X, get $X tokens)');
  console.log('  - CTF tokens ARE included in position calculations');
  console.log('  - Self-fills deduplicated (exclude maker side)');
  console.log('');

  const startTime = Date.now();

  // Process wallets (sequential DB, concurrent API)
  const results = await processWallets(RESOLVED_WALLETS);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nProcessed ${results.length} wallets in ${elapsed}s`);

  // Summary
  console.log('');
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const passed = results.filter(r => r.status === 'PASS').length;
  const close = results.filter(r => r.status === 'CLOSE').length;
  const failed = results.filter(r => r.status === 'FAIL').length;

  console.log(`\nResults:`);
  console.log(`  PASS (within $10): ${passed}/${results.length} (${(100 * passed / results.length).toFixed(1)}%)`);
  console.log(`  CLOSE (within $100): ${close}/${results.length}`);
  console.log(`  FAIL: ${failed}/${results.length}`);

  // Error distribution
  const errors = results.map(r => r.absError).sort((a, b) => a - b);
  console.log(`\nError distribution:`);
  console.log(`  Min: $${errors[0]?.toFixed(2)}`);
  console.log(`  P25: $${errors[Math.floor(errors.length * 0.25)]?.toFixed(2)}`);
  console.log(`  Median: $${errors[Math.floor(errors.length * 0.5)]?.toFixed(2)}`);
  console.log(`  P75: $${errors[Math.floor(errors.length * 0.75)]?.toFixed(2)}`);
  console.log(`  Max: $${errors[errors.length - 1]?.toFixed(2)}`);

  // Show all results
  console.log(`\nDetailed results:`);
  console.log('-'.repeat(100));
  console.log('Wallet           | Calc       | API        | Error      | SelfFill | CTF  | Status');
  console.log('-'.repeat(100));
  for (const r of results) {
    console.log(
      `${r.wallet.slice(0, 14)}... | ` +
      `${r.totalPnl.toFixed(2).padStart(10)} | ` +
      `${r.apiPnl.toFixed(2).padStart(10)} | ` +
      `${r.error.toFixed(2).padStart(10)} | ` +
      `${String(r.selfFillTxs).padStart(8)} | ` +
      `${String(r.ctfOps).padStart(4)} | ` +
      `${r.status}`
    );
  }

  // Show failures if any
  const failures = results.filter(r => r.status !== 'PASS');
  if (failures.length > 0) {
    console.log(`\n${'!'.repeat(40)}`);
    console.log('NON-PASS RESULTS:');
    for (const f of failures) {
      console.log(`  ${f.wallet} | Err: $${f.error.toFixed(2)} | CTF: ${f.ctfOps}`);
    }
    console.log('!'.repeat(40));
  }

  // Save results
  const fs = await import('fs');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(`scripts/pilot-results-v55-${timestamp}.json`, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to scripts/pilot-results-v55-*.json`);
}

main().catch(console.error);
