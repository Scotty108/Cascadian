/**
 * 30-Wallet Stratified Pilot Test for PnL Engine V45
 *
 * Tests the unified PnL formula on 30 diverse wallets:
 * - 10 maker-heavy (>70% maker)
 * - 10 taker-heavy (<30% maker)
 * - 10 mixed (30-70% maker)
 *
 * This is a gate check before running full history backfill.
 * Target: 90%+ within $10 of API
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

// 30 diverse wallets selected from recent 30 days
const PILOT_WALLETS = {
  maker_heavy: [
    '0x468772b53965262f55a880e31f5bb0895385ef4e',
    '0x45d136f57f9ee90b5d8cafc42369e8825dbe2854',
    '0xe97e488d99dfa580b2b6e6550bec13c9a5c0a368',
    '0xdfea29367f42621b5b6da2faa9243458fa90760a',
    '0x6573ac61af5670d090343c515f67a585456bab02',
    '0x9437594b4b59caed830dcce2cb0843a2ad1114d2',
    '0x81e9f0db5df4e88cac1e475d938835ada449b3d5',
    '0x5e71e6643200d2e0fef5584c61834c8b473a2aea',
    '0x2f24f9041fffd2ceb853a92d48aa8c0fd7db2754',
    '0x7c4e46e140f3fd458b454e772a6d684bd1c75b7c',
  ],
  taker_heavy: [
    '0xeba7cd7e39c2a882f18f194050179a25302e85b9',
    '0x2c1895ed74628fb2213c388a22f3614ef6ac0abb',
    '0xbef57f98b8f451c8f1637d84dc50cae79afac761',
    '0x1e2952379c87882994d5f8a1add9866a34cf5bae',
    '0xf6f9c3b1a2b7d2a80f1afac7f973bde35f0b0007',
    '0x1505d852a5bd6d07dc17d57109888d265529cb1c',
    '0x3ee1e1bf8bbf5f753af8b99a1ebccf51a0b2804e',
    '0x1666b9db2b0568e62875d6cfa38fb20220169882',
    '0x0554c046fa6fa1022d753344d13cfa3025221880',
    '0xfc1c7159c51dc9c8f781f3d762fbf0dec1079b59',
  ],
  mixed: [
    '0xb1c5ab5ef1eb558bbd657b4b630b59140732d9e1',
    '0x83f8a188d364eb99e9bdd141ce5060faf07a7cb2',
    '0x3e12d8b40bb6343800db4347443eb82bb892dd1d',
    '0x27516e61ed1861fb1cf8bea1b9b451ce921cdada',
    '0xd0baf2404e9e548e90f7b32cd49ab6c10397ee0e',
    '0x264f6da594a36e34ba960e05f85d843220280fe0',
    '0x3682d7b7ba5a62b1db37d5a7bbd2f8386f805065',
    '0x4cb22b430a8f72b865f86243a27dc71039774954',
    '0x176c4b78b387f744ce0baee0a498f2ec616a089e',
    '0x8dc70e065b6002ab36690694ed0ed688f4c9a21e',
  ],
};

const ALL_WALLETS = [
  ...PILOT_WALLETS.maker_heavy,
  ...PILOT_WALLETS.taker_heavy,
  ...PILOT_WALLETS.mixed,
];

async function calculateWalletPnL(wallet: string): Promise<{
  cashFlow: number;
  longWins: number;
  shortLosses: number;
  totalPnl: number;
  tradeCount: number;
  selfFillCount: number;
}> {
  // Use pre-computed role flags table for self-fill detection (faster)
  // Note: Only covers Dec 2025+ trades. For full history, role flags need backfill.
  const query = `
    WITH
      -- Get self-fill tx hashes from pre-computed table
      self_fill_txs AS (
        SELECT tx_hash
        FROM pm_wallet_tx_role_flags_v1
        WHERE lower(wallet) = '${wallet}' AND is_self_fill = 1
      ),

      -- Canonical trades: exclude maker side of self-fills
      canonical AS (
        SELECT
          t.token_id,
          t.side,
          t.usdc_amount / 1e6 as usdc,
          t.token_amount / 1e6 as tokens,
          t.transaction_hash,
          t.role
        FROM pm_trader_events_v3 t
        WHERE lower(t.trader_wallet) = '${wallet}'
          AND (t.transaction_hash NOT IN (SELECT tx_hash FROM self_fill_txs) OR t.role = 'taker')
      ),

      -- Map tokens to conditions
      trades_mapped AS (
        SELECT
          m.condition_id,
          m.outcome_index,
          c.side,
          c.usdc,
          c.tokens
        FROM canonical c
        JOIN pm_token_to_condition_map_v5 m ON c.token_id = m.token_id_dec
        WHERE m.condition_id != ''
      ),

      -- Aggregate positions
      positions AS (
        SELECT
          condition_id,
          outcome_index,
          sumIf(tokens, side = 'buy') - sumIf(tokens, side = 'sell') as net_tokens,
          sumIf(usdc, side = 'sell') - sumIf(usdc, side = 'buy') as cash_flow
        FROM trades_mapped
        GROUP BY condition_id, outcome_index
      ),

      -- Join resolutions
      with_res AS (
        SELECT
          p.*,
          toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1 as won
        FROM positions p
        LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id AND r.is_deleted = 0
      )

    SELECT
      sum(cash_flow) as cash_flow,
      sumIf(net_tokens, net_tokens > 0 AND won = 1) as long_wins,
      sumIf(-net_tokens, net_tokens < 0 AND won = 1) as short_losses,
      (SELECT count() FROM canonical) as trade_count,
      (SELECT count() FROM self_fill_txs) as self_fill_count
    FROM with_res
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = (await result.json() as any[])[0] || {};

  const cashFlow = Number(data.cash_flow) || 0;
  const longWins = Number(data.long_wins) || 0;
  const shortLosses = Number(data.short_losses) || 0;

  return {
    cashFlow,
    longWins,
    shortLosses,
    totalPnl: cashFlow + longWins - shortLosses,
    tradeCount: Number(data.trade_count) || 0,
    selfFillCount: Number(data.self_fill_count) || 0,
  };
}

async function getApiPnL(wallet: string): Promise<number> {
  try {
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}`);
    if (res.ok) {
      const data = await res.json() as Array<{ t: number; p: number }>;
      if (data && data.length > 0) {
        return data[data.length - 1].p || 0;
      }
    }
  } catch {
    // API failed
  }
  return 0;
}

async function checkPhantomPositions(wallet: string): Promise<number> {
  const query = `
    WITH canonical AS (
      SELECT
        t.token_id,
        t.side,
        t.token_amount / 1e6 as tokens
      FROM pm_trader_events_v3 t
      WHERE lower(t.trader_wallet) = '${wallet}'
    ),
    mapped AS (
      SELECT m.condition_id, m.outcome_index, c.side, c.tokens
      FROM canonical c
      JOIN pm_token_to_condition_map_v5 m ON c.token_id = m.token_id_dec
      WHERE m.condition_id != ''
    ),
    positions AS (
      SELECT condition_id, outcome_index,
        sumIf(tokens, side = 'buy') as bought,
        sumIf(tokens, side = 'sell') as sold
      FROM mapped
      GROUP BY condition_id, outcome_index
    )
    SELECT countIf(sold > bought * 1.01) as phantom_count
    FROM positions
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = (await result.json() as any[])[0] || {};
  return Number(data.phantom_count) || 0;
}

async function checkNegRisk(wallet: string): Promise<number> {
  const query = `
    SELECT count() as neg_risk_count
    FROM pm_neg_risk_conversions_v1
    WHERE lower(user_address) = '${wallet}'
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = (await result.json() as any[])[0] || {};
  return Number(data.neg_risk_count) || 0;
}

interface WalletResult {
  wallet: string;
  profile: string;
  trades: number;
  selfFills: number;
  calculatedPnl: number;
  apiPnl: number;
  error: number;
  withinTen: boolean;
  phantomPositions: number;
  negRiskCount: number;
  status: 'pass' | 'fail' | 'gated';
}

async function runPilot() {
  console.log('='.repeat(70));
  console.log('PnL V45 Pilot Test: 30 Stratified Wallets');
  console.log('='.repeat(70));
  console.log('');

  const results: WalletResult[] = [];
  let processed = 0;

  for (const [profile, wallets] of Object.entries(PILOT_WALLETS)) {
    console.log(`\n--- ${profile.toUpperCase()} (${wallets.length} wallets) ---\n`);

    for (const wallet of wallets) {
      processed++;
      process.stdout.write(`[${processed}/30] ${wallet.slice(0, 10)}... `);

      // Check gates first
      const [phantomPositions, negRiskCount] = await Promise.all([
        checkPhantomPositions(wallet),
        checkNegRisk(wallet),
      ]);

      // Calculate PnL
      const pnl = await calculateWalletPnL(wallet);

      // Get API PnL
      const apiPnl = await getApiPnL(wallet);

      const error = pnl.totalPnl - apiPnl;
      const withinTen = Math.abs(error) <= 10;

      // Determine status
      let status: 'pass' | 'fail' | 'gated';
      if (negRiskCount > 0 || phantomPositions > 0) {
        status = 'gated';
      } else if (withinTen) {
        status = 'pass';
      } else {
        status = 'fail';
      }

      results.push({
        wallet,
        profile,
        trades: pnl.tradeCount,
        selfFills: pnl.selfFillCount,
        calculatedPnl: pnl.totalPnl,
        apiPnl,
        error,
        withinTen,
        phantomPositions,
        negRiskCount,
        status,
      });

      console.log(
        `${status.toUpperCase().padEnd(6)} | ` +
        `Calc: ${pnl.totalPnl.toFixed(2).padStart(10)} | ` +
        `API: ${apiPnl.toFixed(2).padStart(10)} | ` +
        `Err: ${error.toFixed(2).padStart(10)} | ` +
        `SF: ${pnl.selfFillCount} | ` +
        `Ph: ${phantomPositions} | ` +
        `NR: ${negRiskCount}`
      );

      // Rate limit
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const gated = results.filter((r) => r.status === 'gated').length;
  const ungated = results.filter((r) => r.status !== 'gated');
  const ungatedPassed = ungated.filter((r) => r.withinTen).length;

  console.log(`\nTotal: ${results.length}`);
  console.log(`  Passed (within $10): ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Gated (phantom/negRisk): ${gated}`);
  console.log(`\nUngated wallets: ${ungated.length}`);
  console.log(`  Within $10: ${ungatedPassed}/${ungated.length} (${((ungatedPassed / ungated.length) * 100).toFixed(1)}%)`);

  // Profile breakdown
  console.log('\nBy Profile:');
  for (const profile of ['maker_heavy', 'taker_heavy', 'mixed']) {
    const profileResults = results.filter((r) => r.profile === profile);
    const profilePassed = profileResults.filter((r) => r.status === 'pass').length;
    const profileGated = profileResults.filter((r) => r.status === 'gated').length;
    console.log(`  ${profile}: ${profilePassed}/10 pass, ${profileGated}/10 gated`);
  }

  // Failures detail
  const failures = results.filter((r) => r.status === 'fail');
  if (failures.length > 0) {
    console.log('\nFailures (need investigation):');
    for (const f of failures) {
      console.log(`  ${f.wallet} [${f.profile}]: error=${f.error.toFixed(2)}, trades=${f.trades}`);
    }
  }

  // Gate check
  console.log('\n' + '='.repeat(70));
  if (ungated.length >= 20 && ungatedPassed / ungated.length >= 0.9) {
    console.log('✅ PILOT PASSED - Ready for full history backfill');
  } else {
    console.log('❌ PILOT FAILED - Investigate failures before proceeding');
    console.log(`   Need: 90%+ of ungated wallets within $10`);
    console.log(`   Got: ${((ungatedPassed / ungated.length) * 100).toFixed(1)}%`);
  }
  console.log('='.repeat(70));
}

runPilot().catch(console.error);
