/**
 * Check token balance invariants - balances should never go negative
 *
 * For each (wallet, token_id), compute running sum of token_delta
 * If min(running_sum) < 0, we have a data integrity issue
 *
 * Run with: npx tsx scripts/pnl/check-negative-balances.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';

const TEST_WALLETS = [
  { addr: '0x56687bf447db6ffa42ffe2204a05edaa20f55839', name: 'Theo4' },
  { addr: '0xd38b71f3e8ed1af71983e5c309eac3dfa9b35029', name: 'primm' },
];

async function main() {
  const client = getClickHouseClient();

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   CHECK NEGATIVE BALANCE INVARIANTS                                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  for (const w of TEST_WALLETS) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`=== ${w.name} (${w.addr.slice(0, 10)}...) ===`);
    console.log(`${'='.repeat(70)}\n`);

    // Check maker-only first
    console.log('--- MAKER-ONLY TRADES ---\n');

    const makerQ = `
      WITH events AS (
        SELECT
          event_id,
          any(trade_time) as trade_time,
          any(token_id) as token_id,
          any(side) as side,
          any(token_amount) / 1000000 as token_amount
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${w.addr}' AND is_deleted = 0 AND role = 'maker'
        GROUP BY event_id
      ),
      with_delta AS (
        SELECT
          token_id,
          trade_time,
          if(side = 'buy', token_amount, -token_amount) as token_delta
        FROM events
      ),
      running AS (
        SELECT
          token_id,
          trade_time,
          token_delta,
          sum(token_delta) OVER (PARTITION BY token_id ORDER BY trade_time ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as running_bal
        FROM with_delta
      )
      SELECT
        count(distinct token_id) as total_tokens,
        countIf(min_bal < -0.001) as tokens_with_negative,
        min(min_bal) as worst_negative
      FROM (
        SELECT token_id, min(running_bal) as min_bal
        FROM running
        GROUP BY token_id
      )
    `;

    const makerR = await client.query({ query: makerQ, format: 'JSONEachRow' });
    const maker = (await makerR.json())[0] as any;

    console.log(`  Total tokens traded: ${maker.total_tokens}`);
    console.log(`  Tokens with negative balance: ${maker.tokens_with_negative}`);
    console.log(`  Worst negative balance: ${Number(maker.worst_negative).toFixed(4)}`);

    // Check taker-only
    console.log('\n--- TAKER-ONLY TRADES ---\n');

    const takerQ = `
      WITH events AS (
        SELECT
          event_id,
          any(trade_time) as trade_time,
          any(token_id) as token_id,
          any(side) as side,
          any(token_amount) / 1000000 as token_amount
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${w.addr}' AND is_deleted = 0 AND role = 'taker'
        GROUP BY event_id
      ),
      with_delta AS (
        SELECT
          token_id,
          trade_time,
          if(side = 'buy', token_amount, -token_amount) as token_delta
        FROM events
      ),
      running AS (
        SELECT
          token_id,
          trade_time,
          token_delta,
          sum(token_delta) OVER (PARTITION BY token_id ORDER BY trade_time ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as running_bal
        FROM with_delta
      )
      SELECT
        count(distinct token_id) as total_tokens,
        countIf(min_bal < -0.001) as tokens_with_negative,
        min(min_bal) as worst_negative
      FROM (
        SELECT token_id, min(running_bal) as min_bal
        FROM running
        GROUP BY token_id
      )
    `;

    const takerR = await client.query({ query: takerQ, format: 'JSONEachRow' });
    const taker = (await takerR.json())[0] as any;

    console.log(`  Total tokens traded: ${taker.total_tokens}`);
    console.log(`  Tokens with negative balance: ${taker.tokens_with_negative}`);
    console.log(`  Worst negative balance: ${Number(taker.worst_negative).toFixed(4)}`);

    // Check all trades combined
    console.log('\n--- ALL TRADES (MAKER + TAKER) ---\n');

    const allQ = `
      WITH events AS (
        SELECT
          event_id,
          any(trade_time) as trade_time,
          any(token_id) as token_id,
          any(side) as side,
          any(token_amount) / 1000000 as token_amount
        FROM pm_trader_events_v2
        WHERE trader_wallet = '${w.addr}' AND is_deleted = 0
        GROUP BY event_id
      ),
      with_delta AS (
        SELECT
          token_id,
          trade_time,
          if(side = 'buy', token_amount, -token_amount) as token_delta
        FROM events
      ),
      running AS (
        SELECT
          token_id,
          trade_time,
          token_delta,
          sum(token_delta) OVER (PARTITION BY token_id ORDER BY trade_time ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as running_bal
        FROM with_delta
      )
      SELECT
        count(distinct token_id) as total_tokens,
        countIf(min_bal < -0.001) as tokens_with_negative,
        min(min_bal) as worst_negative
      FROM (
        SELECT token_id, min(running_bal) as min_bal
        FROM running
        GROUP BY token_id
      )
    `;

    const allR = await client.query({ query: allQ, format: 'JSONEachRow' });
    const all = (await allR.json())[0] as any;

    console.log(`  Total tokens traded: ${all.total_tokens}`);
    console.log(`  Tokens with negative balance: ${all.tokens_with_negative}`);
    console.log(`  Worst negative balance: ${Number(all.worst_negative).toFixed(4)}`);

    // If there are negative balances, show an example
    if (Number(all.tokens_with_negative) > 0) {
      console.log('\n--- EXAMPLE NEGATIVE BALANCE TOKEN ---\n');

      const exampleQ = `
        WITH events AS (
          SELECT
            event_id,
            any(trade_time) as trade_time,
            any(token_id) as token_id,
            any(side) as side,
            any(role) as role,
            any(token_amount) / 1000000 as token_amount,
            any(usdc_amount) / 1000000 as usdc_amount
          FROM pm_trader_events_v2
          WHERE trader_wallet = '${w.addr}' AND is_deleted = 0
          GROUP BY event_id
        ),
        with_delta AS (
          SELECT
            *,
            if(side = 'buy', token_amount, -token_amount) as token_delta
          FROM events
        ),
        running AS (
          SELECT
            *,
            sum(token_delta) OVER (PARTITION BY token_id ORDER BY trade_time ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as running_bal
          FROM with_delta
        ),
        bad_tokens AS (
          SELECT token_id
          FROM running
          GROUP BY token_id
          HAVING min(running_bal) < -0.001
          LIMIT 1
        )
        SELECT
          trade_time,
          role,
          side,
          token_amount,
          usdc_amount,
          token_delta,
          running_bal
        FROM running
        WHERE token_id IN (SELECT token_id FROM bad_tokens)
        ORDER BY trade_time
        LIMIT 15
      `;

      const exampleR = await client.query({ query: exampleQ, format: 'JSONEachRow' });
      const examples = await exampleR.json();

      console.log('  Trade history for first negative-balance token:');
      for (const e of examples) {
        const sign = Number(e.running_bal) < 0 ? '⚠️' : '  ';
        console.log(`  ${sign} ${e.trade_time} | ${e.role}+${e.side} | tokens: ${Number(e.token_amount).toFixed(2)} | delta: ${Number(e.token_delta).toFixed(2)} | balance: ${Number(e.running_bal).toFixed(2)}`);
      }
    }
  }

  console.log('\n\n=== DIAGNOSIS ===\n');
  console.log('If MAKER-ONLY has no negative balances but TAKER-ONLY does:');
  console.log('  → Taker sign convention is inverted');
  console.log('  → Solution: Normalize taker token_delta signs');
  console.log('\nIf ALL TRADES has negative balances:');
  console.log('  → Sign convention is consistent but data represents sales before buys');
  console.log('  → Or token_id mapping issue');
}

main().catch(console.error);
