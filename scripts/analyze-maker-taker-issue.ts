/**
 * Analyze why maker-only works for f918 but won't work generally
 *
 * Hypothesis: The taker trades are the "byproduct" sells from splits,
 * while maker trades are the "intentional" buys.
 *
 * For taker-heavy wallets (users who hit existing orders), maker-only would fail.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });

import { clickhouse } from '../lib/clickhouse/client';

const WALLET = '0xf918977ef9d3f101385eda508621d5f835fa9052';

async function main() {
  console.log('Analyzing maker vs taker pattern for f918\n');

  // Get detailed breakdown by role + side + outcome
  const query = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(role) as role,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens,
        any(trade_time) as trade_time,
        lower(concat('0x', hex(any(transaction_hash)))) as tx_hash
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}')
        AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      d.role,
      d.side,
      m.outcome_index,
      count() as cnt,
      sum(d.usdc) as total_usdc,
      sum(d.tokens) as total_tokens
    FROM deduped d
    LEFT JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
    WHERE m.condition_id IS NOT NULL
    GROUP BY d.role, d.side, m.outcome_index
    ORDER BY d.role, d.side, m.outcome_index
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const rows = (await result.json()) as any[];

  console.log('Role | Side | Outcome | Trades | USDC | Tokens');
  console.log('-'.repeat(60));
  for (const row of rows) {
    console.log(
      `${row.role.padEnd(6)} | ${row.side.padEnd(4)} | ${row.outcome_index.toString().padStart(7)} | ${row.cnt.toString().padStart(6)} | ${row.total_usdc.toFixed(2).padStart(8)} | ${row.total_tokens.toFixed(2).padStart(8)}`
    );
  }

  // Key insight: Are maker trades predominantly BUYs and taker trades predominantly SELLs?
  console.log('\n\nPattern Analysis:');

  const makerBuys = rows.filter((r: any) => r.role === 'maker' && r.side === 'buy');
  const makerSells = rows.filter((r: any) => r.role === 'maker' && r.side === 'sell');
  const takerBuys = rows.filter((r: any) => r.role === 'taker' && r.side === 'buy');
  const takerSells = rows.filter((r: any) => r.role === 'taker' && r.side === 'sell');

  const sumTrades = (arr: any[]) => arr.reduce((s, r) => s + r.cnt, 0);
  const sumUsdc = (arr: any[]) => arr.reduce((s, r) => s + r.total_usdc, 0);

  console.log(`Maker BUYs: ${sumTrades(makerBuys)} trades, $${sumUsdc(makerBuys).toFixed(2)}`);
  console.log(`Maker SELLs: ${sumTrades(makerSells)} trades, $${sumUsdc(makerSells).toFixed(2)}`);
  console.log(`Taker BUYs: ${sumTrades(takerBuys)} trades, $${sumUsdc(takerBuys).toFixed(2)}`);
  console.log(`Taker SELLs: ${sumTrades(takerSells)} trades, $${sumUsdc(takerSells).toFixed(2)}`);

  // Check if taker sells match CTF splits
  console.log('\n\nChecking if taker sells correspond to split byproducts...');

  const txQuery = `
    WITH clob AS (
      SELECT
        lower(concat('0x', hex(any(transaction_hash)))) as tx_hash,
        any(role) as role,
        any(side) as side,
        any(token_amount) / 1e6 as tokens
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${WALLET}')
        AND is_deleted = 0
      GROUP BY event_id
    ),
    splits AS (
      SELECT DISTINCT tx_hash
      FROM pm_ctf_events
      WHERE tx_hash IN (SELECT tx_hash FROM clob)
        AND event_type = 'PositionSplit'
    )
    SELECT
      c.role,
      c.side,
      CASE WHEN s.tx_hash IS NOT NULL THEN 'yes' ELSE 'no' END as in_split_tx,
      count() as cnt
    FROM clob c
    LEFT JOIN splits s ON c.tx_hash = s.tx_hash
    GROUP BY c.role, c.side, in_split_tx
    ORDER BY c.role, c.side, in_split_tx
  `;

  const txResult = await clickhouse.query({ query: txQuery, format: 'JSONEachRow' });
  const txRows = (await txResult.json()) as any[];

  console.log('\nRole | Side | In Split TX | Trades');
  console.log('-'.repeat(45));
  for (const row of txRows) {
    console.log(
      `${row.role.padEnd(6)} | ${row.side.padEnd(4)} | ${row.in_split_tx.padEnd(11)} | ${row.cnt.toString().padStart(6)}`
    );
  }

  // Conclusion
  console.log('\n\nConclusion:');
  console.log('If taker sells are in split TXs → they are byproduct sells from splits');
  console.log('If maker buys are the primary trades → maker-only captures the user intent');
  console.log('\nBUT: This pattern may not hold for all wallets!');
  console.log('A taker-heavy wallet would have intentional trades as TAKER, not MAKER.');
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error('Error:', e); process.exit(1); });
