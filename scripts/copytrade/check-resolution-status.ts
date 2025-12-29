import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '@/lib/clickhouse/client';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== SURPLUS TOKENS RESOLUTION STATUS ===\n');

  const allSurplus = await clickhouse.query({
    query: `
      SELECT
        h.token_id,
        h.tokens_held,
        r.resolved_price as resolution_price,
        h.tokens_held * coalesce(r.resolved_price, 0) as resolved_value
      FROM (
        SELECT
          token_id,
          (sumIf(token_amount, side = 'buy') - sumIf(token_amount, side = 'sell')) / 1e6 as tokens_held
        FROM (
          SELECT event_id, any(side) as side, any(token_id) as token_id, any(token_amount) as token_amount
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = '${WALLET}' AND is_deleted = 0
          GROUP BY event_id
        )
        GROUP BY token_id
        HAVING tokens_held > 0.01
      ) h
      LEFT JOIN pm_token_to_condition_map_current m ON h.token_id = m.token_id_dec
      LEFT JOIN vw_pm_resolution_prices r ON m.condition_id = r.condition_id AND m.outcome_index = r.outcome_index
      ORDER BY resolved_value DESC
    `,
    format: 'JSONEachRow'
  }).then(r => r.json()) as any[];

  let totalResolved = 0;
  let totalUnresolved = 0;
  let resolvedValue = 0;
  let unresolvedTokens: any[] = [];

  for (const t of allSurplus) {
    const tokens = Number(t.tokens_held);
    const resPrice = t.resolution_price;
    const value = Number(t.resolved_value) || 0;

    if (resPrice != null) {
      totalResolved += tokens;
      resolvedValue += value;
      console.log(t.token_id.slice(0,12) + '...: ' + tokens.toFixed(1).padStart(7) + ' tokens, resolved @ $' + Number(resPrice).toFixed(2) + ' = $' + value.toFixed(2));
    } else {
      totalUnresolved += tokens;
      unresolvedTokens.push({ token_id: t.token_id, tokens });
      console.log(t.token_id.slice(0,12) + '...: ' + tokens.toFixed(1).padStart(7) + ' tokens, UNRESOLVED');
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Resolved tokens: ' + totalResolved.toFixed(2) + ', value @ resolution: $' + resolvedValue.toFixed(2));
  console.log('Unresolved tokens: ' + totalUnresolved.toFixed(2));

  console.log('\n=== ANALYSIS ===');
  console.log('If all resolved tokens redeemable: $' + resolvedValue.toFixed(2));
  console.log('Expected surplus value (from cash flow): $62.17');
  console.log('Difference: $' + (resolvedValue - 62.17).toFixed(2));

  console.log('\n=== CONCLUSIONS ===');
  if (resolvedValue > 62.17) {
    console.log('Resolved value EXCEEDS expected. User may not have redeemed all winners yet.');
    console.log('Or: the resolution data includes tokens user has already redeemed.');
  } else if (resolvedValue < 62.17) {
    console.log('Resolved value LESS than expected. Unresolved tokens must have value.');
  }

  // Check unresolved tokens for current market prices
  if (unresolvedTokens.length > 0) {
    console.log('\n=== UNRESOLVED TOKEN CURRENT PRICES ===\n');

    let unresolvedValue = 0;
    for (const ut of unresolvedTokens) {
      const lastPrice = await clickhouse.query({
        query: `
          SELECT argMax(usdc_amount / token_amount, trade_time) as price
          FROM pm_trader_events_v2
          WHERE token_id = '${ut.token_id}' AND is_deleted = 0 AND token_amount > 0
        `,
        format: 'JSONEachRow'
      }).then(r => r.json()) as any[];

      const price = Number(lastPrice[0]?.price) || 0;
      const value = ut.tokens * price;
      unresolvedValue += value;
      console.log(ut.token_id.slice(0,12) + '...: ' + ut.tokens.toFixed(1) + ' @ $' + price.toFixed(4) + ' = $' + value.toFixed(2));
    }

    console.log('\nTotal unresolved value (at last trade): $' + unresolvedValue.toFixed(2));
    console.log('Total (resolved + unresolved): $' + (resolvedValue + unresolvedValue).toFixed(2));
  }
}

main().catch(console.error);
