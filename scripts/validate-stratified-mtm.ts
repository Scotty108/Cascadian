import { config } from 'dotenv';
config({ path: '/Users/scotty/Projects/Cascadian-app/.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

// Stratified sample: 10 heavy_maker, 10 heavy_taker, 10 mixed
const testWallets = [
  // Heavy Makers (>70% maker trades)
  { wallet: '0xd3e478c06d693d7d0839b9e8c27b1fca5b9abaf8', type: 'heavy_maker' },
  { wallet: '0xb84a0da40c1d2c1d28413166905a1311eb7d055d', type: 'heavy_maker' },
  { wallet: '0xd1612fb075a949fe1ddc96068f18c56b90ed4cc1', type: 'heavy_maker' },
  { wallet: '0x2ef8541afe25b128732fe1fd3f3433f76bdabdc7', type: 'heavy_maker' },
  { wallet: '0xe23b9a151cfc0ab34b5c62dc2796b2969bd90a40', type: 'heavy_maker' },
  { wallet: '0xd9dfc356cc5c829fb7719f8bcbe48e25cfcb8260', type: 'heavy_maker' },
  { wallet: '0xe6c97c0cbb35470e934d4a87e761673653d5c7fe', type: 'heavy_maker' },
  { wallet: '0x862b673c133ee34576d0d9d06b033f708463e9b9', type: 'heavy_maker' },
  { wallet: '0x55964cc782ef0ce5354c17d370e720b7d27f4081', type: 'heavy_maker' },
  { wallet: '0xa6dc29a8d87418182ce08c25f0d1b813ad04c69e', type: 'heavy_maker' },
  // Heavy Takers (>70% taker trades)
  { wallet: '0x994c1bbb60fd34da735c58f897908cac672d429d', type: 'heavy_taker' },
  { wallet: '0x1d37608bbd15bca43d52e982273ca99e356744f0', type: 'heavy_taker' },
  { wallet: '0x84f96b36d2c08d42601078bdccc8807e2bba451a', type: 'heavy_taker' },
  { wallet: '0x377d1f6d29c93a3c760fb522e7c77538d750996c', type: 'heavy_taker' },
  { wallet: '0xda11aeb59993f8982e6ceccee265d111f5fae881', type: 'heavy_taker' },
  { wallet: '0x3056bba2d05aec1d487fe54782207466475a8e69', type: 'heavy_taker' },
  { wallet: '0x54636f68ebdac6dab9b3898436920583f7668bba', type: 'heavy_taker' },
  { wallet: '0xa5d0572cc1f96008fcd5dc66e0e5cf1e1e244a48', type: 'heavy_taker' },
  { wallet: '0x16ff00a0243b3c59227fc573b3ebd0cd39ebc345', type: 'heavy_taker' },
  { wallet: '0xd6116541aee4bfb3283b09d5c9ec4804d98424fd', type: 'heavy_taker' },
  // Mixed (30-70% maker)
  { wallet: '0xadc9473c1d3a36940941565523dd2e42237f5856', type: 'mixed' },
  { wallet: '0x2453279513a4688ccd28eb54595b3de6c59b9fb2', type: 'mixed' },
  { wallet: '0xd286876350bf833452276bec80d4388c6341d55d', type: 'mixed' },
  { wallet: '0x6fc9c51c0145b8745788c959b9ee87fdcf2863b2', type: 'mixed' },
  { wallet: '0xd8966c1b3bde27c95397ea26ae122cdcaf80c6bf', type: 'mixed' },
  { wallet: '0x17c56c3c59af7f5f568ee06acc451b55e7af7c9f', type: 'mixed' },
  { wallet: '0x6fd37a22eec506893e1a9d12da1955219de4d057', type: 'mixed' },
  { wallet: '0x62bae9292f0de0fdfec40eb4b462355547ae31db', type: 'mixed' },
  { wallet: '0xdd6af5be71d813dd6f5ef4392a3a428271d1310d', type: 'mixed' },
  { wallet: '0xc745ffda66f9a382195b3a1930ad33d904eab952', type: 'mixed' },
];

async function getApiPnl(wallet: string): Promise<number | null> {
  try {
    // Use the user-pnl API which returns time-series with p = PnL
    const res = await fetch(`https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet.toLowerCase()}`);
    if (res.ok) {
      const data = await res.json() as Array<{ t: number; p: number }>;
      // Get the latest PnL value (last element in array)
      if (data.length > 0) {
        return data[data.length - 1].p;
      }
    }
  } catch (e) {
    console.error(`API error for ${wallet}:`, e);
  }
  return null;
}

async function getLocalPnlWithMTM(wallet: string): Promise<{ pnl: number; realized: number; unrealized: number }> {
  const query = `
    WITH
      wt AS (
        SELECT transaction_hash, token_id, side, role,
               usdc_amount/1e6 AS usdc, token_amount/1e6 AS tokens, fee_amount/1e6 AS fee
        FROM pm_trader_events_v3
        WHERE lower(trader_wallet) = '${wallet.toLowerCase()}'
      ),
      sf AS (
        SELECT transaction_hash FROM wt
        GROUP BY transaction_hash
        HAVING countIf(role='maker')>0 AND countIf(role='taker')>0
      ),
      cc AS (
        SELECT m.condition_id, m.outcome_index, side,
               (usdc + if(side='buy', fee, -fee)) AS usdc_net, tokens
        FROM wt t JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE m.condition_id != ''
          AND (transaction_hash NOT IN (SELECT transaction_hash FROM sf) OR role='taker')
      ),
      pos AS (
        SELECT condition_id, outcome_index,
          sumIf(tokens, side='buy') - sumIf(tokens, side='sell') AS net_tokens,
          sumIf(usdc_net, side='sell') - sumIf(usdc_net, side='buy') AS cf
        FROM cc GROUP BY condition_id, outcome_index
      ),
      wr AS (
        SELECT p.*,
          r.payout_numerators,
          toInt64OrNull(JSONExtractString(r.payout_numerators, p.outcome_index + 1)) = 1 AS won,
          r.payout_numerators != '' AS is_resolved,
          toFloat64OrZero(arrayElement(
            JSONExtractArrayRaw(replaceAll(met.outcome_prices, '"', '')),
            p.outcome_index + 1
          )) AS mark_price
        FROM pos p
        LEFT JOIN pm_condition_resolutions r ON p.condition_id = r.condition_id AND r.is_deleted = 0
        LEFT JOIN pm_market_metadata met ON p.condition_id = met.condition_id
      ),
      agg AS (
        SELECT
          sum(cf) AS cash_flow,
          sumIf(net_tokens, net_tokens > 0 AND won) AS long_wins,
          sumIf(-net_tokens, net_tokens < 0 AND won) AS short_losses,
          sumIf(net_tokens * mark_price, NOT is_resolved AND net_tokens > 0) AS unrealized_long,
          sumIf(-net_tokens * mark_price, NOT is_resolved AND net_tokens < 0) AS unrealized_short
        FROM wr
      )
    SELECT
      cash_flow + long_wins - short_losses AS realized,
      unrealized_long - unrealized_short AS unrealized,
      cash_flow + long_wins - short_losses + unrealized_long - unrealized_short AS total_pnl
    FROM agg
  `;
  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = await result.json() as any[];
  return {
    pnl: Number(rows[0]?.total_pnl) || 0,
    realized: Number(rows[0]?.realized) || 0,
    unrealized: Number(rows[0]?.unrealized) || 0,
  };
}

function isWithinThreshold(local: number, api: number): boolean {
  const absDiff = Math.abs(local - api);
  const pctDiff = api !== 0 ? Math.abs((local - api) / api) * 100 : (local === 0 ? 0 : 100);
  return absDiff <= 10 || pctDiff <= 10;
}

async function main() {
  console.log('=== Stratified Validation with Mark-to-Market ===\n');
  console.log('Threshold: within 10% OR $10\n');

  const results: Array<{
    wallet: string;
    type: string;
    api: number | null;
    local: number;
    realized: number;
    unrealized: number;
    diff: number;
    pctDiff: number;
    status: string;
  }> = [];

  for (let i = 0; i < testWallets.length; i++) {
    const { wallet, type } = testWallets[i];
    const api = await getApiPnl(wallet);
    const { pnl: local, realized, unrealized } = await getLocalPnlWithMTM(wallet);

    if (api === null) {
      results.push({ wallet, type, api: null, local, realized, unrealized, diff: 0, pctDiff: 0, status: 'API_ERROR' });
    } else {
      const diff = Math.abs(local - api);
      const pctDiff = api !== 0 ? Math.abs((local - api) / api) * 100 : 0;
      const status = isWithinThreshold(local, api) ? 'PASS' : 'FAIL';
      results.push({ wallet, type, api, local, realized, unrealized, diff, pctDiff, status });
    }
    process.stdout.write(`\rProcessed ${i + 1}/${testWallets.length}...`);
  }

  console.log('\n\nWallet                                     | Type         | API PnL      | Local PnL    | Diff       | %Diff   | Status');
  console.log('-------------------------------------------|--------------|--------------|--------------|------------|---------|-------');

  for (const r of results) {
    const apiStr = r.api !== null ? r.api.toFixed(2).padStart(12) : '  API ERROR ';
    const localStr = r.local.toFixed(2).padStart(12);
    const diffStr = r.diff.toFixed(2).padStart(10);
    const pctStr = r.pctDiff.toFixed(1).padStart(6) + '%';
    console.log(`${r.wallet} | ${r.type.padEnd(12)} | ${apiStr} | ${localStr} | ${diffStr} | ${pctStr} | ${r.status}`);
  }

  // Summary by type
  console.log('\n=== Summary by Wallet Type ===');
  for (const type of ['heavy_maker', 'heavy_taker', 'mixed']) {
    const typeResults = results.filter(r => r.type === type && r.api !== null);
    const passed = typeResults.filter(r => r.status === 'PASS').length;
    console.log(`${type.padEnd(12)}: ${passed}/${typeResults.length} passed (${Math.round(passed/typeResults.length*100)}%)`);
  }

  const total = results.filter(r => r.api !== null);
  const totalPassed = total.filter(r => r.status === 'PASS').length;
  console.log(`\nOVERALL: ${totalPassed}/${total.length} passed (${Math.round(totalPassed/total.length*100)}%)`);

  // Show failures
  const failures = results.filter(r => r.status === 'FAIL');
  if (failures.length > 0) {
    console.log('\n=== Failures ===');
    for (const f of failures) {
      console.log(`${f.wallet} (${f.type}): API $${f.api?.toFixed(2)}, Local $${f.local.toFixed(2)}, Diff $${f.diff.toFixed(2)} (${f.pctDiff.toFixed(1)}%)`);
      console.log(`  Realized: $${f.realized.toFixed(2)}, Unrealized: $${f.unrealized.toFixed(2)}`);
    }
  }
}

main().catch(console.error);
