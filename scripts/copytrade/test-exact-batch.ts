import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000,
});

async function test() {
  // Test the originally-bad wallets
  const wallets = [
    '0x126b65f562cf1d0be0a96db6be43559517bca516',  // Prometheus2
    '0x010395e426e2df31b2cb0a4e1dd0e5af792c067b',  // DontTrustFakeMedia
  ];
  const walletList = wallets.map(w => `'${w}'`).join(',');
  console.log('Testing originally-bad wallets:');

  // Restructured query: Use subquery instead of CTE to force materialization
  const query = `
    SELECT
      wallet,
      count() AS n_positions,
      uniqExact(condition_id) AS n_events,
      sum(trade_count) AS n_trades,
      round(sum(abs_cash_flow), 2) AS total_notional,
      sum(is_resolved) AS n_resolved,
      sum(is_win) AS n_wins,
      sum(is_loss) AS n_losses,
      round(sum(is_win) / nullIf(sum(is_resolved), 0) * 100, 1) AS win_pct,
      round(sum(win_pnl) / nullIf(abs(sum(loss_pnl)), 0), 2) AS omega,
      round(sum(rpnl), 2) AS realized_pnl,
      round(sum(win_pnl), 2) AS gross_wins,
      round(abs(sum(loss_pnl)), 2) AS gross_losses,
      toString(min(first_trade)) AS first_trade,
      toString(max(last_trade)) AS last_trade
    FROM (
      SELECT
        p.wallet,
        p.condition_id,
        abs(p.cash_flow) AS abs_cash_flow,
        p.trade_count,
        p.first_trade,
        p.last_trade,
        if(r.resolution_price IS NOT NULL, 1, 0) AS is_resolved,
        if(r.resolution_price IS NOT NULL,
          p.cash_flow + (p.final_tokens * r.resolution_price),
          0
        ) AS rpnl,
        if(r.resolution_price IS NOT NULL AND (p.cash_flow + (p.final_tokens * r.resolution_price)) > 0, 1, 0) AS is_win,
        if(r.resolution_price IS NOT NULL AND (p.cash_flow + (p.final_tokens * r.resolution_price)) <= 0, 1, 0) AS is_loss,
        if(r.resolution_price IS NOT NULL AND (p.cash_flow + (p.final_tokens * r.resolution_price)) > 0,
          p.cash_flow + (p.final_tokens * r.resolution_price), 0) AS win_pnl,
        if(r.resolution_price IS NOT NULL AND (p.cash_flow + (p.final_tokens * r.resolution_price)) < 0,
          p.cash_flow + (p.final_tokens * r.resolution_price), 0) AS loss_pnl
      FROM (
        SELECT
          lower(wallet_address) AS wallet,
          condition_id,
          outcome_index,
          sum(usdc_delta) AS cash_flow,
          sum(token_delta) AS final_tokens,
          count() AS trade_count,
          min(event_time) AS first_trade,
          max(event_time) AS last_trade
        FROM pm_unified_ledger_v6
        WHERE lower(wallet_address) IN (${walletList})
          AND source_type = 'CLOB'
          AND condition_id IS NOT NULL
          AND condition_id != ''
        GROUP BY wallet, condition_id, outcome_index
      ) AS p
      LEFT JOIN (
        SELECT condition_id, outcome_index, any(resolved_price) AS resolution_price
        FROM vw_pm_resolution_prices
        GROUP BY condition_id, outcome_index
      ) AS r ON p.condition_id = r.condition_id AND p.outcome_index = r.outcome_index
    )
    GROUP BY wallet
  `;

  console.log('Testing exact batch query...');
  try {
    const result = await ch.query({ query, format: 'JSONEachRow' });
    const data = await result.json();
    console.log('SUCCESS:', JSON.stringify(data, null, 2));
  } catch (e) {
    console.log('ERROR:', (e as Error).message);
  }

  await ch.close();
}

test().catch(console.error);
