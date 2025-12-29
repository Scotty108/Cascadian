// DEPRECATED: ARCHIVED PnL LOGIC
// This file reflects older attempts to derive PnL from Goldsky user_positions / mystery ground truth.
// Do not use as a starting point for new features. Kept for historical reference only.
// See docs/systems/database/PNL_ENGINE_CANONICAL_SPEC.md for the current approach.

#!/usr/bin/env npx tsx
/**
 * Build RESA (Raw Event-Sourced Architecture) PnL Views
 *
 * Based on the RESA report, this creates the canonical PnL engine
 * that does NOT rely on Goldsky's broken realized_pnl field.
 *
 * Architecture:
 * 1. wallet_condition_ledger_v1 - Core ledger with TRADE + RESOLUTION events
 * 2. wallet_condition_pnl_v1 - Aggregated PnL per wallet/condition/outcome
 * 3. wallet_pnl_totals_v1 - Overall wallet metrics (gains, losses, net PnL, omega)
 *
 * Key insight: Net PnL = sum(usdc_delta) across all events
 * - TRADE BUY:  usdc_delta = -usdc_amount (spend USDC to get shares)
 * - TRADE SELL: usdc_delta = +usdc_amount (get USDC by selling shares)
 * - RESOLUTION WINNER: usdc_delta = +final_shares * 1.0 (each winning share pays $1)
 * - RESOLUTION LOSER:  usdc_delta = 0 (losing shares are worthless)
 */

import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@clickhouse/client";

config({ path: resolve(process.cwd(), ".env.local") });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "",
  database: process.env.CLICKHOUSE_DATABASE || "default",
});

async function executeSQL(name: string, sql: string) {
  console.log(`[${name}] Executing...`);
  try {
    await client.command({ query: sql });
    console.log(`[${name}] Success`);
  } catch (err: any) {
    console.error(`[${name}] Error:`, err.message);
    throw err;
  }
}

async function main() {
  console.log("=".repeat(80));
  console.log("  BUILDING RESA PnL VIEWS");
  console.log("  Raw Event-Sourced Architecture");
  console.log("=".repeat(80));
  console.log("");

  // Step 1: Create the core ledger view
  // This combines TRADE events from pm_trader_events_v2 with synthetic RESOLUTION events
  console.log("[STEP 1] Creating wallet_condition_ledger_v1...");

  const ledgerViewSQL = `
CREATE OR REPLACE VIEW vw_wallet_condition_ledger_v1 AS
WITH
-- Get all TRADE events with condition mapping
trades AS (
  SELECT
    lower(t.trader_wallet) AS wallet,
    m.condition_id,
    m.outcome_index,
    t.trade_time AS event_timestamp,
    'TRADE' AS event_type,
    -- Share delta: positive for buy, negative for sell
    CASE
      WHEN t.side = 'buy' THEN t.token_amount / 1e6
      ELSE -t.token_amount / 1e6
    END AS share_delta,
    -- USDC delta: negative for buy (spend), positive for sell (receive)
    -- Include fees in the cost
    CASE
      WHEN t.side = 'buy' THEN -(t.usdc_amount + t.fee_amount) / 1e6
      ELSE (t.usdc_amount - t.fee_amount) / 1e6
    END AS usdc_delta
  FROM pm_trader_events_v2 t
  INNER JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
),

-- Calculate final share balance per wallet/condition/outcome before resolution
position_balances AS (
  SELECT
    wallet,
    condition_id,
    outcome_index,
    sum(share_delta) AS final_shares
  FROM trades
  GROUP BY wallet, condition_id, outcome_index
  HAVING abs(final_shares) > 0.0001
),

-- Get resolutions with winning outcome
resolutions AS (
  SELECT
    condition_id,
    resolved_at,
    -- Parse payout_numerators to determine winner
    -- [1, 0] means outcome 0 wins, [0, 1] means outcome 1 wins
    CASE
      WHEN JSONExtractFloat(payout_numerators, 1) = 1 THEN 0
      WHEN JSONExtractFloat(payout_numerators, 2) = 1 THEN 1
      ELSE -1  -- Invalid or multi-outcome
    END AS winning_outcome
  FROM pm_condition_resolutions
  WHERE payout_numerators IS NOT NULL AND payout_numerators != ''
),

-- Generate RESOLUTION events (synthetic)
resolution_events AS (
  SELECT
    p.wallet,
    p.condition_id,
    p.outcome_index,
    r.resolved_at AS event_timestamp,
    'RESOLUTION' AS event_type,
    -- Close the position: share_delta = -final_shares
    -p.final_shares AS share_delta,
    -- USDC payout: winners get $1 per share, losers get $0
    CASE
      WHEN p.outcome_index = r.winning_outcome THEN p.final_shares * 1.0
      ELSE 0.0
    END AS usdc_delta
  FROM position_balances p
  INNER JOIN resolutions r ON p.condition_id = r.condition_id
  WHERE r.winning_outcome >= 0  -- Valid resolution
)

-- Combine TRADE and RESOLUTION events
SELECT * FROM trades
UNION ALL
SELECT * FROM resolution_events
`;

  await executeSQL("vw_wallet_condition_ledger_v1", ledgerViewSQL);

  // Step 2: Create aggregated PnL per wallet/condition/outcome
  console.log("
[STEP 2] Creating wallet_condition_pnl_v1...");

  const conditionPnlSQL = `
CREATE OR REPLACE VIEW vw_wallet_condition_pnl_v1 AS
SELECT
  wallet,
  condition_id,
  outcome_index,
  -- Trade metrics
  countIf(event_type = 'TRADE') AS trade_count,
  sumIf(share_delta, event_type = 'TRADE' AND share_delta > 0) AS total_bought,
  sumIf(abs(share_delta), event_type = 'TRADE' AND share_delta < 0) AS total_sold,
  -- Resolution status
  countIf(event_type = 'RESOLUTION') > 0 AS is_resolved,
  -- PnL breakdown
  sumIf(usdc_delta, usdc_delta > 0) AS gains,
  sumIf(usdc_delta, usdc_delta < 0) AS losses,
  sum(usdc_delta) AS net_pnl,
  -- Final position (should be 0 if resolved)
  sum(share_delta) AS final_shares
FROM vw_wallet_condition_ledger_v1
GROUP BY wallet, condition_id, outcome_index
`;

  await executeSQL("vw_wallet_condition_pnl_v1", conditionPnlSQL);

  // Step 3: Create wallet-level totals
  // Note: We query directly from the ledger to avoid nested aggregation issues
  console.log("
[STEP 3] Creating wallet_pnl_totals_v1...");

  const walletPnlSQL = `
CREATE OR REPLACE VIEW vw_wallet_pnl_totals_v1 AS
SELECT
  wallet,
  -- Event counts
  count() AS total_events,
  countIf(event_type = 'TRADE') AS total_trades,
  countIf(event_type = 'RESOLUTION') AS resolved_positions,
  -- Unique positions
  uniqExact(concat(condition_id, toString(outcome_index))) AS unique_positions,
  -- PnL totals from ledger
  sumIf(usdc_delta, usdc_delta > 0) AS total_gains,
  sumIf(usdc_delta, usdc_delta < 0) AS total_losses,
  sum(usdc_delta) AS net_pnl,
  -- Omega ratio (gains / |losses|), handle division by zero
  if(sumIf(usdc_delta, usdc_delta < 0) != 0,
     sumIf(usdc_delta, usdc_delta > 0) / abs(sumIf(usdc_delta, usdc_delta < 0)),
     0) AS omega_ratio
FROM vw_wallet_condition_ledger_v1
GROUP BY wallet
`;

  await executeSQL("vw_wallet_pnl_totals_v1", walletPnlSQL);

  console.log("
" + "=".repeat(80));
  console.log("  VIEWS CREATED SUCCESSFULLY");
  console.log("=".repeat(80));
  console.log("");
  console.log("Views available:");
  console.log("  - vw_wallet_condition_ledger_v1  (core ledger)");
  console.log("  - vw_wallet_condition_pnl_v1     (per-condition PnL)");
  console.log("  - vw_wallet_pnl_totals_v1        (wallet-level totals)");
  console.log("");
  console.log("Example queries:");
  console.log("  SELECT * FROM vw_wallet_pnl_totals_v1 WHERE wallet = '0x...'");
  console.log("  SELECT * FROM vw_wallet_condition_pnl_v1 WHERE wallet = '0x...' ORDER BY net_pnl DESC LIMIT 10");

  await client.close();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
