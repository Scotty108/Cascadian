/**
 * Debug unrealized PnL calculation
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function debug() {
  // Get a few positions with their mappings
  const q = `
    SELECT
      t.token_id,
      m.condition_id,
      m.outcome_index,
      sum(t.usdc_amount) / 1e6 as usdc,
      sum(t.token_amount) / 1e6 as tokens
    FROM pm_trader_events_v2 t
    LEFT JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE lower(t.trader_wallet) = lower('${wallet}')
      AND t.is_deleted = 0
      AND t.side = 'buy'
    GROUP BY t.token_id, m.condition_id, m.outcome_index
    HAVING tokens > 1000
    ORDER BY tokens DESC
    LIMIT 5
  `;

  const result = await clickhouse.query({ query: q, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  console.log('Sample unresolved positions:\n');

  for (const row of rows) {
    const price = row.usdc / row.tokens;
    console.log('Token:', row.token_id.slice(0, 20) + '...');
    console.log('  Condition:', row.condition_id ? row.condition_id.slice(0, 20) + '...' : 'UNMAPPED');
    console.log('  Outcome Index:', row.outcome_index);
    console.log('  Buy Price:', '$' + price.toFixed(4));
    console.log('  Tokens:', row.tokens.toFixed(2));

    if (!row.condition_id) {
      console.log('  SKIPPING - no condition mapping\n');
      continue;
    }

    // Fetch from Gamma API
    try {
      const url = `https://gamma-api.polymarket.com/markets?condition_id=${row.condition_id}`;
      const response = await fetch(url);
      if (response.ok) {
        const markets = await response.json();
        if (markets && markets.length > 0) {
          const market = markets[0];
          console.log('  Market:', market.question?.slice(0, 50) + '...');
          console.log('  Outcome Prices (raw):', market.outcomePrices);

          if (market.outcomePrices) {
            const prices = JSON.parse(market.outcomePrices);
            console.log('  Parsed prices:', prices);
            console.log('  Price[0] (Yes?):', prices[0]);
            console.log('  Price[1] (No?):', prices[1]);

            // What price would we use?
            const ourPrice = row.outcome_index === 0 ? parseFloat(prices[0]) : parseFloat(prices[1]);
            console.log('  Our chosen price (index=' + row.outcome_index + '):', ourPrice);
            console.log('  Unrealized PnL:', ((ourPrice - price) * row.tokens).toFixed(2));
          }

          if (market.tokens) {
            console.log('  Tokens array:', market.tokens.map((t: any) => ({
              outcome: t.outcome,
              price: t.price,
            })));
          }
        }
      }
    } catch (e) {
      console.log('  API Error:', e);
    }

    console.log('');
  }
}

debug();
