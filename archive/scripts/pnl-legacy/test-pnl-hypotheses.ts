/**
 * Test Multiple PnL Hypotheses Against UI Values
 *
 * Goal: Find the formula that matches Polymarket UI PnL for all wallets
 *
 * Reference wallets with UI PnL values:
 * - W1: -$6,138.90
 * - W2: +$4,404.92
 * - W3: +$5.44
 * - W4: -$1.13
 * - W5: +$146.90
 * - W6: +$319.42
 *
 * Terminal: Claude 1
 * Date: 2025-11-26
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || 'Lbr.jYtw5ikf3',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

const TEST_WALLETS = [
  { label: 'W1', address: '0x9d36c904930a7d06c5403f9e16996e919f586486', uiPnl: -6138.90 },
  { label: 'W2', address: '0xdfe10ac1e7de4f273bae988f2fc4d42434f72838', uiPnl: 4404.92 },
  { label: 'W3', address: '0x418db17eaa8f25eaf2085657d0becd82462c6786', uiPnl: 5.44 },
  { label: 'W4', address: '0x4974d02a2e6ca79b33f6e915e98f5a8cc5237fdb', uiPnl: -1.13 },
  { label: 'W5', address: '0xeab03de44f98ad31ecc19cd597bcdef1c9fe42c2', uiPnl: 146.90 },
  { label: 'W6', address: '0x7dca4d9f31ceba9d2d5b7a723eccd5e2e7ccc48d', uiPnl: 319.42 },
];

interface HypothesisResult {
  name: string;
  results: { wallet: string; calculated: number | null; ui: number; error: number | null }[];
  passCount: number;
}

// Hypothesis 1: Pure trading cash flow (all trades, no resolution)
async function h1_pureCashFlow(wallet: string): Promise<number | null> {
  const result = await client.query({
    query: `
      WITH deduped AS (
        SELECT event_id, any(side) as side, any(usdc_amount)/1e6 as usdc
        FROM pm_trader_events_v2
        WHERE trader_wallet = {wallet:String} AND is_deleted = 0
        GROUP BY event_id
      )
      SELECT SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as pnl
      FROM deduped
    `,
    query_params: { wallet },
    format: 'JSONEachRow'
  });
  const rows = await result.json() as any[];
  return rows[0]?.pnl ?? null;
}

// Hypothesis 2: Cash flow + resolution value for resolved markets
async function h2_cashFlowPlusResolution(wallet: string): Promise<number | null> {
  const result = await client.query({
    query: `
      WITH deduped AS (
        SELECT event_id, any(side) as side, any(usdc_amount)/1e6 as usdc,
               any(token_amount)/1e6 as tokens, any(token_id) as token_id
        FROM pm_trader_events_v2
        WHERE trader_wallet = {wallet:String} AND is_deleted = 0
        GROUP BY event_id
      ),
      with_condition AS (
        SELECT d.*, m.condition_id, m.outcome_index
        FROM deduped d
        JOIN pm_token_to_condition_map_v3 m ON toString(d.token_id) = toString(m.token_id_dec)
      ),
      aggregated AS (
        SELECT
          condition_id, outcome_index,
          SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as cash_flow,
          SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as final_shares
        FROM with_condition
        GROUP BY condition_id, outcome_index
      ),
      with_resolution AS (
        SELECT a.*,
          CASE
            WHEN r.payout_numerators LIKE '[0,%' AND a.outcome_index = 0 THEN 0.0
            WHEN r.payout_numerators LIKE '[0,%' AND a.outcome_index = 1 THEN 1.0
            WHEN r.payout_numerators LIKE '[1,%' AND a.outcome_index = 0 THEN 1.0
            WHEN r.payout_numerators LIKE '[1,%' AND a.outcome_index = 1 THEN 0.0
            ELSE NULL
          END AS resolution_price
        FROM aggregated a
        LEFT JOIN pm_condition_resolutions r ON lower(a.condition_id) = lower(r.condition_id) AND r.is_deleted = 0
      )
      SELECT SUM(cash_flow + final_shares * coalesce(resolution_price, 0)) as pnl
      FROM with_resolution
    `,
    query_params: { wallet },
    format: 'JSONEachRow'
  });
  const rows = await result.json() as any[];
  return rows[0]?.pnl ?? null;
}

// Hypothesis 3: Only resolved markets (cash flow + resolution)
async function h3_resolvedMarketsOnly(wallet: string): Promise<number | null> {
  const result = await client.query({
    query: `
      WITH deduped AS (
        SELECT event_id, any(side) as side, any(usdc_amount)/1e6 as usdc,
               any(token_amount)/1e6 as tokens, any(token_id) as token_id
        FROM pm_trader_events_v2
        WHERE trader_wallet = {wallet:String} AND is_deleted = 0
        GROUP BY event_id
      ),
      with_condition AS (
        SELECT d.*, m.condition_id, m.outcome_index
        FROM deduped d
        JOIN pm_token_to_condition_map_v3 m ON toString(d.token_id) = toString(m.token_id_dec)
      ),
      aggregated AS (
        SELECT
          condition_id, outcome_index,
          SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as cash_flow,
          SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as final_shares
        FROM with_condition
        GROUP BY condition_id, outcome_index
      ),
      with_resolution AS (
        SELECT a.*,
          CASE
            WHEN r.payout_numerators LIKE '[0,%' AND a.outcome_index = 0 THEN 0.0
            WHEN r.payout_numerators LIKE '[0,%' AND a.outcome_index = 1 THEN 1.0
            WHEN r.payout_numerators LIKE '[1,%' AND a.outcome_index = 0 THEN 1.0
            WHEN r.payout_numerators LIKE '[1,%' AND a.outcome_index = 1 THEN 0.0
            ELSE NULL
          END AS resolution_price
        FROM aggregated a
        INNER JOIN pm_condition_resolutions r ON lower(a.condition_id) = lower(r.condition_id) AND r.is_deleted = 0
        WHERE r.payout_numerators IS NOT NULL
      )
      SELECT SUM(cash_flow + final_shares * resolution_price) as pnl
      FROM with_resolution
    `,
    query_params: { wallet },
    format: 'JSONEachRow'
  });
  const rows = await result.json() as any[];
  return rows[0]?.pnl ?? null;
}

// Hypothesis 4: Cash flow only from positions that had sells (closed positions)
async function h4_closedPositionsOnly(wallet: string): Promise<number | null> {
  const result = await client.query({
    query: `
      WITH deduped AS (
        SELECT event_id, any(side) as side, any(usdc_amount)/1e6 as usdc,
               any(token_amount)/1e6 as tokens, any(token_id) as token_id
        FROM pm_trader_events_v2
        WHERE trader_wallet = {wallet:String} AND is_deleted = 0
        GROUP BY event_id
      ),
      with_condition AS (
        SELECT d.*, m.condition_id, m.outcome_index
        FROM deduped d
        JOIN pm_token_to_condition_map_v3 m ON toString(d.token_id) = toString(m.token_id_dec)
      ),
      position_activity AS (
        SELECT
          condition_id, outcome_index,
          SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as cash_flow,
          SUM(CASE WHEN side = 'sell' THEN 1 ELSE 0 END) as sell_count
        FROM with_condition
        GROUP BY condition_id, outcome_index
      )
      SELECT SUM(cash_flow) as pnl
      FROM position_activity
      WHERE sell_count > 0
    `,
    query_params: { wallet },
    format: 'JSONEachRow'
  });
  const rows = await result.json() as any[];
  return rows[0]?.pnl ?? null;
}

// Hypothesis 5: Redeemed winnings only (resolved + position was sold/zero)
async function h5_redeemedOnly(wallet: string): Promise<number | null> {
  const result = await client.query({
    query: `
      WITH deduped AS (
        SELECT event_id, any(side) as side, any(usdc_amount)/1e6 as usdc,
               any(token_amount)/1e6 as tokens, any(token_id) as token_id
        FROM pm_trader_events_v2
        WHERE trader_wallet = {wallet:String} AND is_deleted = 0
        GROUP BY event_id
      ),
      with_condition AS (
        SELECT d.*, m.condition_id, m.outcome_index
        FROM deduped d
        JOIN pm_token_to_condition_map_v3 m ON toString(d.token_id) = toString(m.token_id_dec)
      ),
      aggregated AS (
        SELECT
          condition_id, outcome_index,
          SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as cash_flow,
          SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as final_shares
        FROM with_condition
        GROUP BY condition_id, outcome_index
      ),
      with_resolution AS (
        SELECT a.*,
          CASE
            WHEN r.payout_numerators LIKE '[0,%' AND a.outcome_index = 0 THEN 0.0
            WHEN r.payout_numerators LIKE '[0,%' AND a.outcome_index = 1 THEN 1.0
            WHEN r.payout_numerators LIKE '[1,%' AND a.outcome_index = 0 THEN 1.0
            WHEN r.payout_numerators LIKE '[1,%' AND a.outcome_index = 1 THEN 0.0
            ELSE NULL
          END AS resolution_price
        FROM aggregated a
        INNER JOIN pm_condition_resolutions r ON lower(a.condition_id) = lower(r.condition_id) AND r.is_deleted = 0
        WHERE r.payout_numerators IS NOT NULL
      )
      -- Only positions with zero final shares (fully closed)
      SELECT SUM(cash_flow + final_shares * resolution_price) as pnl
      FROM with_resolution
      WHERE ABS(final_shares) < 0.01
    `,
    query_params: { wallet },
    format: 'JSONEachRow'
  });
  const rows = await result.json() as any[];
  return rows[0]?.pnl ?? null;
}

// Hypothesis 6: Cash flow from sold shares only (sell revenue - buy cost for sold shares)
async function h6_realizedTradingPnl(wallet: string): Promise<number | null> {
  const result = await client.query({
    query: `
      WITH deduped AS (
        SELECT event_id, any(side) as side, any(usdc_amount)/1e6 as usdc,
               any(token_amount)/1e6 as tokens, any(token_id) as token_id
        FROM pm_trader_events_v2
        WHERE trader_wallet = {wallet:String} AND is_deleted = 0
        GROUP BY event_id
      ),
      with_condition AS (
        SELECT d.*, m.condition_id, m.outcome_index
        FROM deduped d
        JOIN pm_token_to_condition_map_v3 m ON toString(d.token_id) = toString(m.token_id_dec)
      ),
      position_stats AS (
        SELECT
          condition_id, outcome_index,
          SUM(CASE WHEN side = 'buy' THEN tokens ELSE 0 END) as total_bought,
          SUM(CASE WHEN side = 'sell' THEN tokens ELSE 0 END) as total_sold,
          SUM(CASE WHEN side = 'buy' THEN usdc ELSE 0 END) as buy_cost,
          SUM(CASE WHEN side = 'sell' THEN usdc ELSE 0 END) as sell_revenue
        FROM with_condition
        GROUP BY condition_id, outcome_index
      )
      -- For each position: realized PnL = sell revenue - (buy cost * sold_fraction)
      SELECT SUM(
        CASE
          WHEN total_bought > 0 AND total_sold > 0
          THEN sell_revenue - (buy_cost * least(total_sold / total_bought, 1.0))
          ELSE 0
        END
      ) as pnl
      FROM position_stats
    `,
    query_params: { wallet },
    format: 'JSONEachRow'
  });
  const rows = await result.json() as any[];
  return rows[0]?.pnl ?? null;
}

// Hypothesis 7: Winning markets only (resolution price = 1 for held tokens)
async function h7_winningMarketsOnly(wallet: string): Promise<number | null> {
  const result = await client.query({
    query: `
      WITH deduped AS (
        SELECT event_id, any(side) as side, any(usdc_amount)/1e6 as usdc,
               any(token_amount)/1e6 as tokens, any(token_id) as token_id
        FROM pm_trader_events_v2
        WHERE trader_wallet = {wallet:String} AND is_deleted = 0
        GROUP BY event_id
      ),
      with_condition AS (
        SELECT d.*, m.condition_id, m.outcome_index
        FROM deduped d
        JOIN pm_token_to_condition_map_v3 m ON toString(d.token_id) = toString(m.token_id_dec)
      ),
      aggregated AS (
        SELECT
          condition_id, outcome_index,
          SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) as cash_flow,
          SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) as final_shares
        FROM with_condition
        GROUP BY condition_id, outcome_index
      ),
      with_resolution AS (
        SELECT a.*,
          CASE
            WHEN r.payout_numerators LIKE '[0,%' AND a.outcome_index = 0 THEN 0.0
            WHEN r.payout_numerators LIKE '[0,%' AND a.outcome_index = 1 THEN 1.0
            WHEN r.payout_numerators LIKE '[1,%' AND a.outcome_index = 0 THEN 1.0
            WHEN r.payout_numerators LIKE '[1,%' AND a.outcome_index = 1 THEN 0.0
            ELSE NULL
          END AS resolution_price
        FROM aggregated a
        INNER JOIN pm_condition_resolutions r ON lower(a.condition_id) = lower(r.condition_id) AND r.is_deleted = 0
        WHERE r.payout_numerators IS NOT NULL
      )
      -- Only positions where resolution_price = 1 (winning tokens)
      SELECT SUM(cash_flow + final_shares * resolution_price) as pnl
      FROM with_resolution
      WHERE resolution_price = 1.0
    `,
    query_params: { wallet },
    format: 'JSONEachRow'
  });
  const rows = await result.json() as any[];
  return rows[0]?.pnl ?? null;
}

// Hypothesis 8: Net position value (final shares * last trade price)
async function h8_netPositionLastPrice(wallet: string): Promise<number | null> {
  // This is complex - skip for now
  return null;
}

async function runHypothesis(name: string, fn: (wallet: string) => Promise<number | null>): Promise<HypothesisResult> {
  const results: HypothesisResult['results'] = [];
  let passCount = 0;

  for (const w of TEST_WALLETS) {
    try {
      const calculated = await fn(w.address);
      const error = calculated !== null && w.uiPnl !== 0
        ? Math.abs((calculated - w.uiPnl) / Math.abs(w.uiPnl))
        : null;

      if (error !== null && error <= 0.05) passCount++;

      results.push({
        wallet: w.label,
        calculated,
        ui: w.uiPnl,
        error
      });
    } catch (e) {
      console.error(`Error in ${name} for ${w.label}:`, e);
      results.push({ wallet: w.label, calculated: null, ui: w.uiPnl, error: null });
    }
  }

  return { name, results, passCount };
}

function formatPnl(n: number | null): string {
  if (n === null) return 'N/A'.padStart(12);
  const sign = n >= 0 ? '+' : '-';
  return (sign + '$' + Math.abs(n).toFixed(2)).padStart(12);
}

function formatError(e: number | null): string {
  if (e === null) return 'N/A'.padStart(8);
  return ((e * 100).toFixed(1) + '%').padStart(8);
}

async function main() {
  console.log('');
  console.log('='.repeat(100));
  console.log('POLYMARKET UI PNL HYPOTHESIS TESTING');
  console.log('Goal: Find formula that matches UI PnL for all 6 reference wallets');
  console.log('='.repeat(100));
  console.log('');

  const hypotheses: [string, (wallet: string) => Promise<number | null>][] = [
    ['H1: Pure cash flow (all trades)', h1_pureCashFlow],
    ['H2: Cash flow + resolution value (all)', h2_cashFlowPlusResolution],
    ['H3: Resolved markets only', h3_resolvedMarketsOnly],
    ['H4: Closed positions only (has sells)', h4_closedPositionsOnly],
    ['H5: Redeemed only (final shares ≈ 0)', h5_redeemedOnly],
    ['H6: Realized trading PnL (FIFO-ish)', h6_realizedTradingPnl],
    ['H7: Winning markets only', h7_winningMarketsOnly],
  ];

  const allResults: HypothesisResult[] = [];

  for (const [name, fn] of hypotheses) {
    console.log(`Testing: ${name}...`);
    const result = await runHypothesis(name, fn);
    allResults.push(result);
    console.log(`  → ${result.passCount}/6 wallets match (within 5%)`);
  }

  // Summary table
  console.log('');
  console.log('='.repeat(100));
  console.log('DETAILED RESULTS');
  console.log('='.repeat(100));

  for (const hr of allResults) {
    console.log('');
    console.log(`${hr.name} - ${hr.passCount}/6 PASS`);
    console.log('-'.repeat(80));
    console.log('Wallet |   Calculated |       UI PnL |   Error | Status');
    console.log('-'.repeat(80));

    for (const r of hr.results) {
      const status = r.error !== null && r.error <= 0.05 ? 'PASS' : 'FAIL';
      console.log(
        `${r.wallet.padEnd(7)}| ${formatPnl(r.calculated)} | ${formatPnl(r.ui)} | ${formatError(r.error)} | ${status}`
      );
    }
  }

  // Best hypothesis
  console.log('');
  console.log('='.repeat(100));
  console.log('RANKING');
  console.log('='.repeat(100));
  const sorted = [...allResults].sort((a, b) => b.passCount - a.passCount);
  for (let i = 0; i < sorted.length; i++) {
    console.log(`${i + 1}. ${sorted[i].name} - ${sorted[i].passCount}/6`);
  }

  await client.close();
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
