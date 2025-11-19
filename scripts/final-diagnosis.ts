#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default'
});

const problemWallet = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

async function main() {
  console.log('=== FINAL DIAGNOSIS ===\n');

  // Get a sample position with payout data
  const query = `
    WITH positions AS (
      SELECT
        condition_id_norm,
        outcome_index,
        SUM(CASE WHEN trade_direction = 'BUY' THEN shares ELSE -shares END) as net_shares,
        SUM(CASE WHEN trade_direction = 'BUY' THEN -usd_value ELSE usd_value END) as net_cost
      FROM vw_trades_canonical
      WHERE lower(wallet_address_norm) = lower('${problemWallet}')
        AND condition_id_norm != ''
        AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
      GROUP BY condition_id_norm, outcome_index
      HAVING ABS(net_shares) > 0.01
      ORDER BY ABS(net_cost) DESC
      LIMIT 5
    )
    SELECT
      substring(p.condition_id_norm, 1, 12) as cid_short,
      p.condition_id_norm as full_cid,
      p.outcome_index,
      round(p.net_shares, 2) as shares,
      round(p.net_cost, 2) as cost,
      r.winning_index,
      r.payout_numerators,
      r.payout_denominator
    FROM positions p
    LEFT JOIN market_resolutions_final r
      ON replaceAll(p.condition_id_norm, '0x', '') = r.condition_id_norm
  `;

  const result = await client.query({ query, format: 'JSONEachRow' });
  const positions = await result.json();

  console.log('Sample positions with resolution data:');
  for (const pos of positions) {
    console.log('\n' + '─'.repeat(80));
    console.log(`Condition ID: ${pos.full_cid}`);
    console.log(`Outcome: ${pos.outcome_index}`);
    console.log(`Shares: ${pos.shares}`);
    console.log(`Cost: $${pos.cost}`);
    console.log(`Winning index: ${pos.winning_index}`);
    console.log(`Payout numerators: ${pos.payout_numerators}`);
    console.log(`Payout denominator: ${pos.payout_denominator}`);

    if (pos.payout_numerators && pos.payout_denominator) {
      const payoutArray = pos.payout_numerators;
      const denom = pos.payout_denominator;
      const outcomeIndex = Number(pos.outcome_index);
      const winnerIndex = Number(pos.winning_index);

      console.log(`\nPayout vector: [${payoutArray}] / ${denom}`);

      // ClickHouse arrays are 1-indexed
      if (outcomeIndex < payoutArray.length) {
        const payoutRatio = payoutArray[outcomeIndex] / denom;
        console.log(`Payout for outcome ${outcomeIndex}: ${payoutArray[outcomeIndex]}/${denom} = ${payoutRatio}`);

        const realizedValue = Number(pos.shares) * payoutRatio;
        const pnl = realizedValue - Number(pos.cost);

        console.log(`Realized value: ${pos.shares} * ${payoutRatio} = $${realizedValue.toFixed(2)}`);
        console.log(`P&L: $${realizedValue.toFixed(2)} - $${pos.cost} = $${pnl.toFixed(2)}`);
      }
    } else {
      console.log('\n⚠ NO RESOLUTION DATA');
    }
  }

  await client.close();
}

main().catch(console.error);
