/**
 * V54 Validation: 30 Resolved-Only Wallets
 *
 * These wallets have ZERO open positions (all conditions resolved).
 * Should achieve 100% accuracy if self-fill dedup fix is correct.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

// 30 wallets with only resolved positions, 20-300 trades
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
  '0xa277a0e326adc9cfa039a66dbab0b88f59ad28ad',
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

async function calculatePnLV54(wallet: string): Promise<{
  clobCash: number;
  ctfCash: number;
  longWins: number;
  shortLosses: number;
  totalPnl: number;
  tradeCount: number;
  selfFillTxs: number;
}> {
  const query = `
    WITH
      -- Step 1: Identify self-fill transactions (wallet is both maker AND taker)
      self_fills AS (
        SELECT transaction_hash
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = '${wallet}'
        GROUP BY transaction_hash
        HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
      ),

      -- Step 2: Get CLOB trades, excluding MAKER side of self-fills
      clob_trades AS (
        SELECT
          m.condition_id,
          m.outcome_index,
          t.side,
          t.token_amount / 1e6 as tokens,
          t.usdc_amount / 1e6 as usdc
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${wallet}'
          AND m.condition_id != ''
          -- CRITICAL: Exclude maker side of self-fills to avoid double-counting
          AND NOT (t.transaction_hash IN (SELECT transaction_hash FROM self_fills) AND t.role = 'maker')
      ),

      -- Step 3: Aggregate CLOB positions
      clob_pos AS (
        SELECT
          condition_id,
          outcome_index,
          sumIf(tokens, side = 'buy') as clob_bought,
          sumIf(tokens, side = 'sell') as clob_sold,
          sumIf(usdc, side = 'sell') - sumIf(usdc, side = 'buy') as clob_cash
        FROM clob_trades
        GROUP BY condition_id, outcome_index
      ),

      -- Step 4: CTF positions - tokens per outcome, cash ONLY for outcome_index = 0
      ctf_pos AS (
        SELECT
          condition_id,
          outcome_index,
          sum(shares_delta) as ctf_tokens,
          sumIf(cash_delta, outcome_index = 0) as ctf_cash
        FROM pm_ctf_split_merge_expanded
        WHERE lower(wallet) = '${wallet}'
        GROUP BY condition_id, outcome_index
      ),

      -- Step 5: Combine CLOB + CTF
      combined AS (
        SELECT
          COALESCE(c.condition_id, f.condition_id) as condition_id,
          COALESCE(c.outcome_index, f.outcome_index) as outcome_index,
          COALESCE(c.clob_bought, 0) - COALESCE(c.clob_sold, 0) + COALESCE(f.ctf_tokens, 0) as net_tokens,
          COALESCE(c.clob_cash, 0) as clob_cash_flow,
          COALESCE(f.ctf_cash, 0) as ctf_cash_flow
        FROM clob_pos c
        FULL OUTER JOIN ctf_pos f ON c.condition_id = f.condition_id AND c.outcome_index = f.outcome_index
      ),

      -- Step 6: Join resolutions
      with_res AS (
        SELECT
          cb.*,
          r.payout_numerators,
          toInt64OrNull(JSONExtractString(r.payout_numerators, cb.outcome_index + 1)) = 1 as won
        FROM combined cb
        LEFT JOIN pm_condition_resolutions r ON cb.condition_id = r.condition_id AND r.is_deleted = 0
      ),

      -- Step 7: Aggregate final results
      agg AS (
        SELECT
          sum(clob_cash_flow) as total_clob_cash,
          sum(ctf_cash_flow) as total_ctf_cash,
          sumIf(net_tokens, net_tokens > 0 AND won = 1) as long_wins,
          sumIf(abs(net_tokens), net_tokens < 0 AND won = 1) as short_losses
        FROM with_res
      )

    SELECT
      round(total_clob_cash, 2) as clob_cash,
      round(total_ctf_cash, 2) as ctf_cash,
      round(long_wins, 2) as long_wins,
      round(short_losses, 2) as short_losses,
      round(total_clob_cash + total_ctf_cash + long_wins - short_losses, 2) as total_pnl,
      (SELECT count() FROM pm_trader_events_v3 WHERE lower(trader_wallet) = '${wallet}') as trade_count,
      (SELECT count() FROM self_fills) as self_fill_txs
    FROM agg
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = (await result.json() as any[])[0] || {};

  return {
    clobCash: Number(data.clob_cash) || 0,
    ctfCash: Number(data.ctf_cash) || 0,
    longWins: Number(data.long_wins) || 0,
    shortLosses: Number(data.short_losses) || 0,
    totalPnl: Number(data.total_pnl) || 0,
    tradeCount: Number(data.trade_count) || 0,
    selfFillTxs: Number(data.self_fill_txs) || 0,
  };
}

async function main() {
  console.log('='.repeat(80));
  console.log('V54 VALIDATION: 30 RESOLVED-ONLY WALLETS');
  console.log('='.repeat(80));
  console.log('');
  console.log('These wallets have ZERO open positions.');
  console.log('Expected: 100% accuracy if self-fill dedup fix is correct.');
  console.log('');

  const results: any[] = [];

  for (let i = 0; i < RESOLVED_WALLETS.length; i++) {
    const wallet = RESOLVED_WALLETS[i];
    process.stdout.write(`[${String(i + 1).padStart(2)}/${RESOLVED_WALLETS.length}] ${wallet.slice(0, 14)}... `);

    try {
      const pnl = await calculatePnLV54(wallet);
      const apiPnl = await getApiPnL(wallet);
      const error = pnl.totalPnl - apiPnl;
      const absError = Math.abs(error);

      let status: string;
      if (absError <= 10) {
        status = 'PASS';
      } else if (absError <= 100) {
        status = 'CLOSE';
      } else {
        status = 'FAIL';
      }

      console.log(`Calc: ${pnl.totalPnl.toFixed(2).padStart(10)} | API: ${apiPnl.toFixed(2).padStart(10)} | Err: ${error.toFixed(2).padStart(10)} | ${status}`);

      results.push({
        wallet,
        ...pnl,
        apiPnl,
        error,
        absError,
        status,
      });
    } catch (err) {
      console.log(`ERROR: ${err}`);
    }

    await new Promise(r => setTimeout(r, 200));
  }

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

  // Self-fill stats
  const totalSelfFills = results.reduce((s, r) => s + r.selfFillTxs, 0);
  const walletsWithSelfFills = results.filter(r => r.selfFillTxs > 0).length;
  console.log(`\nSelf-fill statistics:`);
  console.log(`  Total self-fill transactions: ${totalSelfFills}`);
  console.log(`  Wallets with self-fills: ${walletsWithSelfFills}/${results.length}`);

  // Show failures if any
  const failures = results.filter(r => r.status === 'FAIL');
  if (failures.length > 0) {
    console.log(`\n${'!'.repeat(40)}`);
    console.log('FAILURES TO INVESTIGATE:');
    for (const f of failures) {
      console.log(`  ${f.wallet.slice(0, 14)}... | Err: $${f.error.toFixed(2)} | Self-fills: ${f.selfFillTxs}`);
    }
    console.log('!'.repeat(40));
  }

  // Save results
  const fs = await import('fs');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(`scripts/pilot-results-v54-resolved30-${timestamp}.json`, JSON.stringify(results, null, 2));
  console.log(`\nResults saved to scripts/pilot-results-v54-resolved30-*.json`);
}

main().catch(console.error);
