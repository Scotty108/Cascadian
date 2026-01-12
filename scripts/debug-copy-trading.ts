/**
 * Debug script to understand copy_trading PnL discrepancy
 * V1: $314.26, UI: $57.71, V2: $-331
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0x925ad88d18dBc7bfeFF3B71dB7b96Ed4BB572c2e';
const PROXY = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';

async function main() {
  console.log('=== Debug copy_trading PnL ===\n');

  // Step 1: Get basic CLOB stats
  const clobStats = await clickhouse.query({
    query: `
      SELECT
        side,
        count() as trades,
        round(sum(usdc_amount) / 1e6, 2) as usdc,
        round(sum(token_amount) / 1e6, 2) as tokens
      FROM pm_trader_events_v3
      WHERE lower(trader_wallet) = lower('${WALLET}')
      GROUP BY side
    `,
    format: 'JSONEachRow',
  });
  const clob = (await clobStats.json()) as any[];
  console.log('CLOB Summary:');
  for (const row of clob) {
    console.log(`  ${row.side}: $${row.usdc} USDC, ${row.tokens} tokens`);
  }

  // Step 2: Get bundled tx stats (buy + sell same condition in one tx)
  const bundledStats = await clickhouse.query({
    query: `
      WITH
      raw_trades AS (
        SELECT
          substring(event_id, 1, 66) as tx_hash,
          m.condition_id as cid,
          t.side,
          sum(t.usdc_amount) / 1e6 as usdc,
          sum(t.token_amount) / 1e6 as tokens
        FROM pm_trader_events_v3 t
        LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = lower('${WALLET}')
          AND m.condition_id IS NOT NULL
        GROUP BY tx_hash, m.condition_id, t.side
      ),
      bundled AS (
        SELECT
          tx_hash,
          cid,
          sumIf(usdc, side='buy') as buy_usdc,
          sumIf(tokens, side='buy') as buy_tokens,
          sumIf(usdc, side='sell') as sell_usdc,
          sumIf(tokens, side='sell') as sell_tokens
        FROM raw_trades
        GROUP BY tx_hash, cid
        HAVING buy_tokens > 0 AND sell_tokens > 0
      )
      SELECT
        count() as bundled_txs,
        round(sum(buy_usdc), 2) as fake_buy_cost,
        round(sum(buy_tokens), 2) as buy_tokens,
        round(sum(sell_usdc), 2) as sell_proceeds,
        round(sum(sell_tokens), 2) as sell_tokens
      FROM bundled
    `,
    format: 'JSONEachRow',
  });
  const bundled = (await bundledStats.json()) as any[];
  console.log('\nBundled Transaction Analysis:');
  if (bundled[0]) {
    const b = bundled[0];
    const v2BuyCost = Number(b.buy_tokens) * 0.50;
    const v2SellCost = Number(b.sell_tokens) * 0.50;
    console.log(`  Bundled txs: ${b.bundled_txs}`);
    console.log(`  Buy tokens: ${b.buy_tokens} (V1 cost: $${b.fake_buy_cost}, V2 cost: $${v2BuyCost.toFixed(2)})`);
    console.log(`  Sell tokens: ${b.sell_tokens} (proceeds: $${b.sell_proceeds}, V2 cost: $${v2SellCost.toFixed(2)})`);
    console.log(`\n  V1 vs V2 impact on buys: $${(v2BuyCost - Number(b.fake_buy_cost)).toFixed(2)} more cost`);
    console.log(`  V2 bundled sell PnL: $${(Number(b.sell_proceeds) - v2SellCost).toFixed(2)}`);
  }

  // Step 3: Calculate V1-style PnL per outcome
  const v1Pnl = await clickhouse.query({
    query: `
      WITH
      trades AS (
        SELECT
          m.condition_id as cid,
          m.outcome_index as oidx,
          t.side,
          sum(t.usdc_amount) / 1e6 as usdc,
          sum(t.token_amount) / 1e6 as tokens
        FROM pm_trader_events_v3 t
        LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = lower('${WALLET}')
          AND m.condition_id IS NOT NULL
        GROUP BY m.condition_id, m.outcome_index, t.side
      ),
      outcomes AS (
        SELECT
          cid,
          oidx,
          sumIf(tokens, side='buy') as bought,
          sumIf(tokens, side='sell') as sold,
          sumIf(usdc, side='buy') as buy_cost,
          sumIf(usdc, side='sell') as sell_proceeds,
          r.norm_prices,
          length(r.norm_prices) > 0 as resolved,
          mp.mark_price
        FROM trades t
        LEFT JOIN pm_condition_resolutions_norm r ON lower(t.cid) = lower(r.condition_id)
        LEFT JOIN pm_latest_mark_price_v1 mp ON lower(t.cid) = lower(mp.condition_id) AND t.oidx = mp.outcome_index
        GROUP BY cid, oidx, r.norm_prices, mp.mark_price
      )
      SELECT
        resolved,
        count() as outcomes,
        round(sum(buy_cost), 2) as total_buy_cost,
        round(sum(sell_proceeds), 2) as total_sell_proceeds,
        round(sum(if(sold > bought AND bought > 0, sell_proceeds * bought / sold,
                    if(sold > bought AND bought = 0, 0, sell_proceeds))), 2) as v1_effective_sell,
        round(sum(greatest(bought - sold, 0)), 2) as net_held,
        round(sum(greatest(bought - sold, 0) * if(resolved, arrayElement(norm_prices, toUInt8(oidx + 1)), coalesce(mark_price, 0))), 2) as settlement
      FROM outcomes
      GROUP BY resolved
    `,
    format: 'JSONEachRow',
  });
  const v1Rows = (await v1Pnl.json()) as any[];
  console.log('\nV1 PnL Breakdown:');
  let totalV1 = 0;
  for (const row of v1Rows) {
    const pnl = Number(row.v1_effective_sell) + Number(row.settlement) - Number(row.buy_cost);
    totalV1 += pnl;
    console.log(`  ${row.resolved ? 'Resolved' : 'Unrealized'}: ${row.outcomes} outcomes`);
    console.log(`    Buy cost: $${row.total_buy_cost}`);
    console.log(`    V1 effective sell: $${row.v1_effective_sell}`);
    console.log(`    Settlement: $${row.settlement}`);
    console.log(`    PnL: $${pnl.toFixed(2)}`);
  }
  console.log(`  Total V1 PnL: $${totalV1.toFixed(2)}`);

  // Step 4: Understand the "oversell" situation
  const oversellAnalysis = await clickhouse.query({
    query: `
      WITH
      trades AS (
        SELECT
          m.condition_id as cid,
          m.outcome_index as oidx,
          t.side,
          sum(t.usdc_amount) / 1e6 as usdc,
          sum(t.token_amount) / 1e6 as tokens
        FROM pm_trader_events_v3 t
        LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = lower('${WALLET}')
          AND m.condition_id IS NOT NULL
        GROUP BY m.condition_id, m.outcome_index, t.side
      ),
      outcomes AS (
        SELECT
          cid,
          oidx,
          sumIf(tokens, side='buy') as bought,
          sumIf(tokens, side='sell') as sold,
          sumIf(usdc, side='sell') as sell_proceeds
        FROM trades t
        GROUP BY cid, oidx
      )
      SELECT
        multiIf(
          bought = 0 AND sold > 0, 'sell_only',
          bought > 0 AND sold = 0, 'buy_only',
          sold > bought, 'oversell',
          'normal'
        ) as pattern,
        count() as outcomes,
        round(sum(sold - bought), 2) as excess_sold,
        round(sum(sell_proceeds), 2) as proceeds,
        round(sum(if(bought > 0, sell_proceeds * bought / sold, 0)), 2) as v1_credited_proceeds,
        round(sum(sell_proceeds) - sum(if(bought > 0, sell_proceeds * bought / sold, 0)), 2) as v1_ignored_proceeds
      FROM outcomes
      WHERE bought != sold OR sold > 0
      GROUP BY pattern
      ORDER BY outcomes DESC
    `,
    format: 'JSONEachRow',
  });
  const oversell = (await oversellAnalysis.json()) as any[];
  console.log('\nOversell Analysis (V1 ignored proceeds):');
  let totalIgnored = 0;
  for (const row of oversell) {
    console.log(`  ${row.pattern}: ${row.outcomes} outcomes`);
    console.log(`    Proceeds: $${row.proceeds}`);
    console.log(`    V1 credited: $${row.v1_credited_proceeds}`);
    console.log(`    V1 IGNORED: $${row.v1_ignored_proceeds}`);
    totalIgnored += Number(row.v1_ignored_proceeds);
  }
  console.log(`  Total V1 ignored proceeds: $${totalIgnored.toFixed(2)}`);

  console.log('\n=== Summary ===');
  console.log('V1 PnL:', totalV1.toFixed(2));
  console.log('UI PnL:', 57.71);
  console.log('Difference:', (totalV1 - 57.71).toFixed(2));
  console.log('\nV1 ignores oversell proceeds but uses fake low buy costs.');
  console.log('True PnL requires adjusting for split costs ($0.50/token).');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
