/**
 * Check what markets the TRUE 100% WR wallets traded
 * See if any traded Fed/Tech/Econ markets
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const PERFECT_WALLETS = [
  '0x32b1f5ece2320c7bf25dd6ef9f9d3816090c9f42',
  '0xe7819fe5734b9342d76994613241e6b86c17f617',
  '0xd22173b51b1c636f852717b10ccb74d83d0a54fd',
  '0xb743e50bb9b492a75df9120e6da28f3e2cd72b01',
  '0x1ced0929f24805a2bd2690d1339bf4a81d49e074',
  '0x803f1983369261e4e54eaad22cf06a9ed081d7bd',
  '0xed34886f1730c12b02fcee080734f3393d3410b8'
];

async function main() {
  console.log('=== CHECKING WHAT MARKETS THE 7 TRUE 100% WR WALLETS TRADE ===\n');

  for (const wallet of PERFECT_WALLETS) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`WALLET: ${wallet}`);
    console.log(`Profile: https://polymarket.com/profile/${wallet}`);
    console.log('='.repeat(80));

    const result = await clickhouse.query({
      query: `
        SELECT
          cond,
          question,
          cost_basis,
          entry_price,
          pnl,
          is_fed_tech
        FROM (
          SELECT
            e.cond as cond,
            any(e.question) as question,
            sum(if(e.side = 'buy', e.usdc, 0)) as cost_basis,
            sum(if(e.side = 'buy', e.usdc, 0)) / nullIf(sum(if(e.side = 'buy', e.tokens, 0)), 0) as entry_price,
            sum(if(e.side = 'sell', e.usdc, 0)) +
              (greatest(0, sum(if(e.side = 'buy', e.tokens, -e.tokens))) * any(e.payout)) -
              sum(if(e.side = 'buy', e.usdc, 0)) as pnl,
            any(
              lower(e.question) LIKE '%fed %'
              OR lower(e.question) LIKE '%federal reserve%'
              OR lower(e.question) LIKE '%interest rate%'
              OR lower(e.question) LIKE '%fomc%'
              OR lower(e.question) LIKE '%rate cut%'
              OR lower(e.question) LIKE '%rate hike%'
              OR lower(e.question) LIKE '% bps%'
              OR lower(e.question) LIKE '%earnings%'
              OR lower(e.question) LIKE '%tesla%'
              OR lower(e.question) LIKE '%nvidia%'
              OR lower(e.question) LIKE '%apple%'
              OR lower(e.question) LIKE '%google%'
              OR lower(e.question) LIKE '%microsoft%'
              OR lower(e.question) LIKE '%amazon%'
              OR lower(e.question) LIKE '%gdp%'
              OR lower(e.question) LIKE '%inflation%'
              OR lower(e.question) LIKE '%cpi %'
              OR lower(e.question) LIKE '%jobs report%'
              OR lower(e.question) LIKE '%unemployment%'
              OR lower(e.question) LIKE '%nonfarm%'
              OR lower(e.question) LIKE '%bitcoin%'
              OR lower(e.question) LIKE '%btc %'
              OR lower(e.question) LIKE '%ethereum%'
            ) as is_fed_tech
          FROM (
            SELECT
              tm.condition_id as cond,
              tm.question as question,
              t.side as side,
              t.usdc as usdc,
              t.tokens as tokens,
              toFloat64(arrayElement(
                JSONExtract(r.payout_numerators, 'Array(UInt64)'),
                toUInt32(tm.outcome_index + 1)
              )) / toFloat64(r.payout_denominator) as payout
            FROM (
              SELECT
                event_id,
                any(token_id) as token_id,
                any(lower(side)) as side,
                any(usdc_amount) / 1e6 as usdc,
                any(token_amount) / 1e6 as tokens
              FROM pm_trader_events_v2
              WHERE trader_wallet = '${wallet}' AND is_deleted = 0
              GROUP BY event_id
            ) t
            INNER JOIN pm_token_to_condition_map_v5 tm ON t.token_id = tm.token_id_dec
            INNER JOIN (
              SELECT condition_id, payout_numerators, payout_denominator
              FROM pm_condition_resolutions FINAL
              WHERE is_deleted = 0 AND payout_denominator != '' AND payout_denominator != '0'
            ) r ON tm.condition_id = r.condition_id
          ) e
          GROUP BY e.cond
          HAVING cost_basis > 5
        )
        WHERE entry_price > 0 AND entry_price < 1
        ORDER BY pnl DESC
      `,
      format: 'JSONEachRow'
    });

    const positions = await result.json() as any[];

    const fedTech = positions.filter((p: any) => p.is_fed_tech);
    const other = positions.filter((p: any) => !p.is_fed_tech);

    console.log(`\nTotal Positions: ${positions.length}`);
    console.log(`Fed/Tech/Econ: ${fedTech.length}`);
    console.log(`Other: ${other.length}`);

    if (fedTech.length > 0) {
      console.log('\n🎯 FED/TECH/ECON TRADES:');
      for (const p of fedTech) {
        const status = p.pnl > 0 ? '✓ WIN' : '✗ LOSS';
        console.log(`  ${status} | Entry: ${(p.entry_price * 100).toFixed(0)}% | PnL: $${p.pnl.toFixed(0)}`);
        console.log(`       ${p.question?.substring(0, 65)}`);
      }
    }

    console.log('\n📋 ALL TRADES:');
    for (const p of positions.slice(0, 10)) {
      const tag = p.is_fed_tech ? '🎯' : '  ';
      const status = p.pnl > 0 ? '✓' : '✗';
      console.log(`${tag} ${status} Entry: ${(p.entry_price * 100).toFixed(0)}% | PnL: $${p.pnl.toFixed(0)} | ${p.question?.substring(0, 50)}`);
    }

    if (positions.length > 10) {
      console.log(`  ... and ${positions.length - 10} more`);
    }
  }

  // Summary
  console.log('\n\n' + '='.repeat(80));
  console.log('SUMMARY: TRUE 100% WR WALLETS WITH FED/TECH TRADES');
  console.log('='.repeat(80));
}

main().catch(console.error);
