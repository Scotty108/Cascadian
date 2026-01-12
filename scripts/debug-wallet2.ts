import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '../lib/clickhouse/client';

const wallet = '0x4bdb41f924986cabd96e8526b5f4fd08a3fc338d';

async function investigate() {
  // Check raw trade counts and volumes by role
  const rawQuery = `
    SELECT
      role,
      side,
      count() as trade_count,
      sum(usdc_amount) / 1e6 as total_usdc,
      sum(token_amount) / 1e6 as total_tokens,
      sum(fee_amount) / 1e6 as total_fees
    FROM pm_trader_events_v3 t
    JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
    WHERE lower(t.trader_wallet) = '${wallet}'
      AND m.condition_id != ''
    GROUP BY role, side
    ORDER BY role, side
  `;

  console.log('=== RAW TRADES BY ROLE/SIDE ===');
  const raw = await clickhouse.query({ query: rawQuery, format: 'JSONEachRow' });
  const rawRows = (await raw.json()) as any[];
  console.table(rawRows);

  // Check true self-fills
  const selfFillQuery = `
    SELECT count() as self_fill_count
    FROM (
      SELECT t.transaction_hash, t.token_id, t.usdc_amount, t.token_amount
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet}'
        AND m.condition_id != ''
      GROUP BY t.transaction_hash, t.token_id, t.usdc_amount, t.token_amount
      HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
    )
  `;

  console.log('\n=== TRUE SELF-FILLS ===');
  const sf = await clickhouse.query({ query: selfFillQuery, format: 'JSONEachRow' });
  const sfRows = (await sf.json()) as any[];
  console.log('Self-fill groups:', sfRows[0]?.self_fill_count || 0);

  // Check what the V1.3 engine sees after filtering (with hex-encoded tx hash)
  const filteredQuery = `
    WITH true_self_fills AS (
      SELECT
        concat(hex(t.transaction_hash), '_', t.token_id, '_', toString(t.usdc_amount), '_', toString(t.token_amount)) as sf_key
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet}'
        AND m.condition_id != ''
      GROUP BY t.transaction_hash, t.token_id, t.usdc_amount, t.token_amount
      HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
    ),
    all_trades AS (
      SELECT
        t.event_id,
        concat(hex(t.transaction_hash), '_', t.token_id, '_', toString(t.usdc_amount), '_', toString(t.token_amount)) as trade_key,
        t.side,
        t.role,
        t.usdc_amount / 1e6 as usdc,
        t.token_amount / 1e6 as tokens,
        t.fee_amount / 1e6 as fee
      FROM pm_trader_events_v3 t
      JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
      WHERE lower(t.trader_wallet) = '${wallet}'
        AND m.condition_id != ''
    ),
    filtered_trades AS (
      SELECT a.*
      FROM all_trades a
      LEFT JOIN true_self_fills s ON a.trade_key = s.sf_key
      WHERE NOT (a.role = 'taker' AND s.sf_key IS NOT NULL)
    )
    SELECT
      side,
      count() as trade_count,
      sum(usdc) as total_usdc,
      sum(tokens) as total_tokens,
      sum(fee) as total_fees
    FROM filtered_trades
    GROUP BY side
    ORDER BY side
  `;

  console.log('\n=== FILTERED TRADES (V1.3 with hex) ===');
  const filt = await clickhouse.query({ query: filteredQuery, format: 'JSONEachRow' });
  const filtRows = (await filt.json()) as any[];
  console.table(filtRows);

  // Calculate expected PnL from filtered trades
  const buyUsdc = filtRows.find((r: any) => r.side === 'buy')?.total_usdc || 0;
  const sellUsdc = filtRows.find((r: any) => r.side === 'sell')?.total_usdc || 0;
  const totalFees = filtRows.reduce((sum: number, r: any) => sum + Number(r.total_fees || 0), 0);

  console.log('\n=== PNL BREAKDOWN ===');
  console.log(`Buy cost: $${Number(buyUsdc).toFixed(2)}`);
  console.log(`Sell proceeds: $${Number(sellUsdc).toFixed(2)}`);
  console.log(`Total fees: $${totalFees.toFixed(2)}`);
  console.log(`Net (sell - buy - fees): $${(Number(sellUsdc) - Number(buyUsdc) - totalFees).toFixed(2)}`);
  console.log(`API PnL: $-430.02`);
  console.log(`Gap: $${(Number(sellUsdc) - Number(buyUsdc) - totalFees + 430.02).toFixed(2)}`);

  // Check if there are resolution payouts we're missing
  const resolutionQuery = `
    SELECT
      o.condition_id,
      o.outcome_index,
      sumIf(o.tokens, o.side='buy') as bought,
      sumIf(o.tokens, o.side='sell') as sold,
      bought - sold as net_tokens,
      r.norm_prices,
      if(length(r.norm_prices) > 0, arrayElement(r.norm_prices, toUInt8(o.outcome_index + 1)), 0) as payout_price,
      net_tokens * payout_price as settlement
    FROM (
      WITH true_self_fills AS (
        SELECT
          concat(hex(t.transaction_hash), '_', t.token_id, '_', toString(t.usdc_amount), '_', toString(t.token_amount)) as sf_key
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${wallet}'
          AND m.condition_id != ''
        GROUP BY t.transaction_hash, t.token_id, t.usdc_amount, t.token_amount
        HAVING countIf(role = 'maker') > 0 AND countIf(role = 'taker') > 0
      ),
      all_trades AS (
        SELECT
          m.condition_id,
          m.outcome_index,
          t.side,
          t.token_amount / 1e6 as tokens,
          concat(hex(t.transaction_hash), '_', t.token_id, '_', toString(t.usdc_amount), '_', toString(t.token_amount)) as trade_key,
          t.role
        FROM pm_trader_events_v3 t
        JOIN pm_token_to_condition_map_v5 m ON t.token_id = m.token_id_dec
        WHERE lower(t.trader_wallet) = '${wallet}'
          AND m.condition_id != ''
      )
      SELECT a.*
      FROM all_trades a
      LEFT JOIN true_self_fills s ON a.trade_key = s.sf_key
      WHERE NOT (a.role = 'taker' AND s.sf_key IS NOT NULL)
    ) o
    LEFT JOIN pm_condition_resolutions_norm r ON lower(o.condition_id) = lower(r.condition_id)
    GROUP BY o.condition_id, o.outcome_index, r.norm_prices
    HAVING net_tokens > 0.01
    ORDER BY abs(settlement) DESC
    LIMIT 10
  `;

  console.log('\n=== TOP POSITIONS WITH SETTLEMENT ===');
  const res = await clickhouse.query({ query: resolutionQuery, format: 'JSONEachRow' });
  const resRows = (await res.json()) as any[];
  console.table(resRows.map((r: any) => ({
    condition_id: r.condition_id?.substring(0, 16) + '...',
    outcome: r.outcome_index,
    net_tokens: Number(r.net_tokens).toFixed(2),
    payout: r.payout_price,
    settlement: Number(r.settlement).toFixed(2)
  })));

  process.exit(0);
}

investigate().catch(console.error);
