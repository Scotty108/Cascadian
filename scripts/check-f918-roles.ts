/**
 * Check f918's trade roles
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0xf918977ef9d3f101385eda508621d5f835fa9052';

async function main() {
  console.log('Checking f918 trade roles\n');

  // Get role breakdown
  const roleQuery = `
    SELECT
      role,
      count() as cnt,
      sum(usdc_amount) / 1e6 as total_usdc
    FROM pm_trader_events_v2
    WHERE lower(trader_wallet) = lower('${WALLET}')
      AND is_deleted = 0
    GROUP BY role
  `;

  const roleResult = await clickhouse.query({ query: roleQuery, format: 'JSONEachRow' });
  const roles = (await roleResult.json()) as any[];

  console.log('Role breakdown:');
  for (const r of roles) {
    console.log(`  ${r.role}: ${r.cnt} trades, $${r.total_usdc.toFixed(2)} USDC`);
  }

  // Get maker-only vs all
  console.log('\n\nComparing MAKER-only vs ALL (after event_id dedup):');

  const makerQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}')
        AND is_deleted = 0
        AND role = 'maker'
      GROUP BY event_id
    )
    SELECT
      m.condition_id,
      m.outcome_index,
      sum(if(d.side = 'sell', d.usdc, -d.usdc)) AS cash_flow,
      sum(if(d.side = 'buy', d.tokens, -d.tokens)) AS final_tokens,
      count() AS trade_count
    FROM deduped d
    LEFT JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
    WHERE m.condition_id IS NOT NULL
    GROUP BY m.condition_id, m.outcome_index
    ORDER BY m.condition_id, m.outcome_index
  `;

  const makerResult = await clickhouse.query({ query: makerQuery, format: 'JSONEachRow' });
  const makerRows = (await makerResult.json()) as any[];

  console.log('\nMAKER-only positions:');
  console.log('Condition (last 12) | Outcome | Cash Flow | Final Tokens | Trades');
  console.log('-'.repeat(70));

  let totalMakerCashFlow = 0;
  let totalMakerTokens = 0;

  for (const row of makerRows) {
    console.log(
      `...${row.condition_id.slice(-12)} | ${row.outcome_index.toString().padStart(7)} | ${row.cash_flow.toFixed(2).padStart(9)} | ${row.final_tokens.toFixed(2).padStart(12)} | ${row.trade_count.toString().padStart(6)}`
    );
    totalMakerCashFlow += row.cash_flow;
    totalMakerTokens += row.final_tokens;
  }

  console.log('-'.repeat(70));
  console.log(`Total MAKER: ${makerRows.length} positions, cash=$${totalMakerCashFlow.toFixed(2)}, tokens=${totalMakerTokens.toFixed(2)}`);

  // Now get TAKER-only
  const takerQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}')
        AND is_deleted = 0
        AND role = 'taker'
      GROUP BY event_id
    )
    SELECT
      m.condition_id,
      m.outcome_index,
      sum(if(d.side = 'sell', d.usdc, -d.usdc)) AS cash_flow,
      sum(if(d.side = 'buy', d.tokens, -d.tokens)) AS final_tokens,
      count() AS trade_count
    FROM deduped d
    LEFT JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
    WHERE m.condition_id IS NOT NULL
    GROUP BY m.condition_id, m.outcome_index
    ORDER BY m.condition_id, m.outcome_index
  `;

  const takerResult = await clickhouse.query({ query: takerQuery, format: 'JSONEachRow' });
  const takerRows = (await takerResult.json()) as any[];

  console.log('\nTAKER-only positions:');
  console.log('Condition (last 12) | Outcome | Cash Flow | Final Tokens | Trades');
  console.log('-'.repeat(70));

  let totalTakerCashFlow = 0;
  let totalTakerTokens = 0;

  for (const row of takerRows) {
    console.log(
      `...${row.condition_id.slice(-12)} | ${row.outcome_index.toString().padStart(7)} | ${row.cash_flow.toFixed(2).padStart(9)} | ${row.final_tokens.toFixed(2).padStart(12)} | ${row.trade_count.toString().padStart(6)}`
    );
    totalTakerCashFlow += row.cash_flow;
    totalTakerTokens += row.final_tokens;
  }

  console.log('-'.repeat(70));
  console.log(`Total TAKER: ${takerRows.length} positions, cash=$${totalTakerCashFlow.toFixed(2)}, tokens=${totalTakerTokens.toFixed(2)}`);

  // Summary
  console.log('\n\nSUMMARY:');
  console.log(`Maker: ${makerRows.length} positions, cash_flow=$${totalMakerCashFlow.toFixed(2)}, tokens=${totalMakerTokens.toFixed(2)}`);
  console.log(`Taker: ${takerRows.length} positions, cash_flow=$${totalTakerCashFlow.toFixed(2)}, tokens=${totalTakerTokens.toFixed(2)}`);
  console.log(`Combined would be: cash=$${(totalMakerCashFlow + totalTakerCashFlow).toFixed(2)}, tokens=${(totalMakerTokens + totalTakerTokens).toFixed(2)}`);

  // Calculate PnL for maker-only using V17 formula
  console.log('\n\nCALCULATING PnL (MAKER-only, V17 formula):');

  // Get resolutions
  const conditionIds = [...new Set(makerRows.map((r: any) => r.condition_id))];
  const condList = conditionIds.map(c => `'${c.toLowerCase()}'`).join(',');

  const resQuery = `
    SELECT
      lower(condition_id) as condition_id,
      payout_numerators
    FROM pm_condition_resolutions
    WHERE lower(condition_id) IN (${condList || "''"})
  `;

  const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resRows = (await resResult.json()) as any[];

  const resolutions = new Map<string, number[]>();
  for (const row of resRows) {
    if (row.payout_numerators) {
      try {
        const payouts = JSON.parse(row.payout_numerators.replace(/'/g, '"'));
        resolutions.set(row.condition_id, payouts);
      } catch { }
    }
  }

  let totalPnl = 0;
  for (const row of makerRows) {
    const payouts = resolutions.get(row.condition_id);
    if (!payouts) continue;

    const denom = payouts.reduce((a: number, b: number) => a + b, 0);
    const payout = denom > 0 ? payouts[row.outcome_index] / denom : 0.5;

    const pnl = row.cash_flow + (row.final_tokens * payout);
    totalPnl += pnl;

    console.log(`  ...${row.condition_id.slice(-12)}[${row.outcome_index}]: cash=${row.cash_flow.toFixed(2)}, tokens=${row.final_tokens.toFixed(2)}, payout=${payout.toFixed(2)} -> PnL=${pnl.toFixed(2)}`);
  }

  console.log(`\nTotal MAKER-only PnL: $${totalPnl.toFixed(2)}`);
  console.log(`UI Target: $1.16`);
  console.log(`Error: ${((totalPnl - 1.16) / 1.16 * 100).toFixed(1)}%`);
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
