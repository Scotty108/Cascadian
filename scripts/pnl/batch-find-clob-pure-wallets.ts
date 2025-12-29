/**
 * BATCH FIND CLOB-PURE WALLETS
 *
 * Single ClickHouse query to find all CLOB-pure wallets at once.
 * Much faster than iterating wallet-by-wallet.
 *
 * Usage:
 *   npx tsx scripts/pnl/batch-find-clob-pure-wallets.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║       BATCH FIND CLOB-PURE WALLETS (Single Query)                          ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  const client = getClickHouseClient();

  // Single batch query that:
  // 1. Dedupes by event_id per wallet
  // 2. Computes running position with window functions
  // 3. Clamps sells to available position
  // 4. Calculates external_sell_pct
  // 5. Computes net PnL with synthetic resolutions
  const query = `
    WITH
    -- Step 1: Dedupe CLOB trades by event_id per wallet
    deduped AS (
      SELECT
        wallet_address,
        event_id,
        any(condition_id) AS cond_id,
        any(outcome_index) AS out_idx,
        any(side) AS side,
        any(usdc_delta) AS usdc_delta,
        any(token_delta) AS token_delta,
        any(event_time) AS event_time
      FROM pm_unified_ledger_v9_clob_tbl
      WHERE source_type = 'CLOB'
        AND condition_id != ''
      GROUP BY wallet_address, event_id
      HAVING cond_id IS NOT NULL AND cond_id != ''
    ),

    -- Step 2: Order trades and compute running position
    ordered AS (
      SELECT
        wallet_address,
        cond_id,
        out_idx,
        event_id,
        side,
        usdc_delta,
        token_delta,
        event_time,
        sum(token_delta) OVER (
          PARTITION BY wallet_address, cond_id, out_idx
          ORDER BY event_time, event_id
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ) AS pos_before
      FROM deduped
    ),

    -- Step 3: Clamp sells to available position
    clamped AS (
      SELECT
        wallet_address,
        cond_id,
        out_idx,
        side,
        usdc_delta,
        token_delta,
        -- For sells (token_delta < 0), clamp to available position
        CASE
          WHEN token_delta < 0 THEN
            greatest(token_delta, -coalesce(pos_before, 0))
          ELSE token_delta
        END AS token_delta_clamped,
        -- Track external sells
        CASE
          WHEN token_delta < 0 AND coalesce(pos_before, 0) < abs(token_delta) THEN
            abs(token_delta) - coalesce(pos_before, 0)
          ELSE 0
        END AS external_sell_tokens
      FROM ordered
    ),

    -- Step 4: Aggregate per wallet
    wallet_stats AS (
      SELECT
        wallet_address,
        count() AS clob_rows,
        uniqExact(cond_id) AS markets,
        sum(abs(token_delta)) AS total_token_volume,
        sum(external_sell_tokens) AS total_external_sells,
        -- External sell percentage
        if(sum(abs(token_delta)) > 0,
           sum(external_sell_tokens) / sum(abs(token_delta)) * 100,
           0) AS external_sell_pct,
        -- Net PnL (simplified: sum of USDC flows)
        sum(usdc_delta) / 1e6 AS cash_flow_usd
      FROM clamped
      GROUP BY wallet_address
      HAVING clob_rows >= 100  -- Minimum activity
    ),

    -- Step 5: Get resolution prices
    resolutions AS (
      SELECT
        condition_id,
        outcome_index,
        payout_norm
      FROM pm_market_resolution_prices_v1
      WHERE payout_norm IS NOT NULL
    ),

    -- Step 6: Compute final positions per wallet/market
    positions AS (
      SELECT
        c.wallet_address,
        c.cond_id,
        c.out_idx,
        sum(c.token_delta_clamped) AS final_tokens,
        sum(c.usdc_delta) / 1e6 AS cash_flow
      FROM clamped c
      GROUP BY c.wallet_address, c.cond_id, c.out_idx
    ),

    -- Step 7: Join with resolutions for realized PnL
    position_pnl AS (
      SELECT
        p.wallet_address,
        p.cond_id,
        p.cash_flow,
        p.final_tokens / 1e6 AS final_tokens_usd,
        coalesce(r.payout_norm, 0.5) AS resolution_price,
        r.payout_norm IS NOT NULL AS is_resolved,
        -- PnL = cash_flow + (final_tokens * resolution_price)
        p.cash_flow + (p.final_tokens / 1e6 * coalesce(r.payout_norm, 0.5)) AS position_pnl
      FROM positions p
      LEFT JOIN resolutions r ON p.cond_id = r.condition_id AND p.out_idx = r.outcome_index
    ),

    -- Step 8: Aggregate PnL per wallet
    wallet_pnl AS (
      SELECT
        wallet_address,
        sum(position_pnl) AS net_pnl,
        sum(if(position_pnl > 0, position_pnl, 0)) AS gain,
        sum(if(position_pnl < 0, position_pnl, 0)) AS loss,
        countIf(is_resolved) AS resolved_positions,
        count() AS total_positions
      FROM position_pnl
      GROUP BY wallet_address
    )

    -- Final: Join stats with PnL
    SELECT
      s.wallet_address,
      s.clob_rows,
      s.markets,
      round(s.external_sell_pct, 4) AS external_sell_pct,
      round(p.net_pnl, 2) AS net_pnl,
      round(p.gain, 2) AS gain,
      round(p.loss, 2) AS loss,
      p.resolved_positions,
      p.total_positions,
      -- Eligibility
      s.external_sell_pct <= 0.5 AS is_clob_pure
    FROM wallet_stats s
    JOIN wallet_pnl p ON s.wallet_address = p.wallet_address
    WHERE s.external_sell_pct <= 2.0  -- Pre-filter to reasonable candidates
    ORDER BY s.external_sell_pct ASC, abs(p.net_pnl) DESC
    LIMIT 200
  `;

  console.log('Running batch query (single ClickHouse call)...\n');
  const startTime = Date.now();

  try {
    const result = await client.query({
      query,
      format: 'JSONEachRow',
      clickhouse_settings: {
        max_execution_time: 300,
      },
    });

    const rows = await result.json() as any[];
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`✅ Query completed in ${elapsed}s\n`);

    // Filter CLOB-pure wallets
    const clobPure = rows.filter((r: any) => r.external_sell_pct <= 0.5);
    const nearPure = rows.filter((r: any) => r.external_sell_pct > 0.5 && r.external_sell_pct <= 1.0);

    console.log('╔════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                              RESULTS                                       ║');
    console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

    console.log(`  CLOB-Pure (≤0.5%):     ${clobPure.length} wallets`);
    console.log(`  Near-Pure (0.5-1%):    ${nearPure.length} wallets`);
    console.log(`  Total candidates:      ${rows.length} wallets`);

    if (clobPure.length > 0) {
      console.log('\n🏆 Top 20 CLOB-Pure Wallets:');
      console.log('┌────┬──────────────────────────────────────────────┬───────────────┬────────────────┬─────────┐');
      console.log('│ #  │ Wallet                                       │ Ext Sell %    │ Net PnL        │ Markets │');
      console.log('├────┼──────────────────────────────────────────────┼───────────────┼────────────────┼─────────┤');

      clobPure.slice(0, 20).forEach((r: any, i: number) => {
        const netStr = r.net_pnl >= 0
          ? `+$${r.net_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
          : `-$${Math.abs(r.net_pnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
        console.log(
          `│ ${String(i + 1).padStart(2)} │ ${r.wallet_address.padEnd(44)} │ ${(r.external_sell_pct.toFixed(3) + '%').padStart(13)} │ ${netStr.padStart(14)} │ ${String(r.markets).padStart(7)} │`
        );
      });

      console.log('└────┴──────────────────────────────────────────────┴───────────────┴────────────────┴─────────┘');
    }

    // Write output
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputPath = path.join(process.cwd(), 'data', `clob-pure-wallets.${timestamp}.json`);
    const stablePath = path.join(process.cwd(), 'data', 'clob-pure-wallets.json');

    const output = {
      generated_at: new Date().toISOString(),
      query_time_seconds: parseFloat(elapsed),
      summary: {
        clob_pure: clobPure.length,
        near_pure: nearPure.length,
        total_candidates: rows.length,
      },
      clob_pure_wallets: clobPure,
      all_candidates: rows,
    };

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    fs.writeFileSync(stablePath, JSON.stringify(output, null, 2));

    console.log(`\n✅ Versioned: ${outputPath}`);
    console.log(`✅ Stable:    ${stablePath}`);

    // CSV export for CLOB-pure wallets
    if (clobPure.length > 0) {
      const csvPath = path.join(process.cwd(), 'data', 'exports', `clob-pure-wallets.${timestamp}.csv`);
      const csvHeader = 'wallet_address,external_sell_pct,net_pnl,gain,loss,markets,clob_rows,resolved_positions,total_positions';
      const csvRows = clobPure.map((r: any) =>
        `${r.wallet_address},${r.external_sell_pct},${r.net_pnl},${r.gain},${r.loss},${r.markets},${r.clob_rows},${r.resolved_positions},${r.total_positions}`
      );

      const exportsDir = path.join(process.cwd(), 'data', 'exports');
      if (!fs.existsSync(exportsDir)) {
        fs.mkdirSync(exportsDir, { recursive: true });
      }

      fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'));
      console.log(`✅ CSV:       ${csvPath}`);
    }

  } catch (error: any) {
    console.error('❌ Query failed:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);
