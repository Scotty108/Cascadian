/**
 * Export CLOB-Only Filtered Wallets with Full Stats
 *
 * Filters: CLOB-only, >=20 trades, Omega>1, PnL>=$500, active 30 days
 *
 * Usage:
 *   npx tsx scripts/pnl/export-clob-filtered-wallets.ts
 *   npx tsx scripts/pnl/export-clob-filtered-wallets.ts --minTrades 20 --minPnl 500
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';
import * as fs from 'fs';
import * as path from 'path';

// CLI Args
function parseArgs() {
  const args = process.argv.slice(2);
  let minTrades = 20;
  let minPnl = 500;
  let minOmega = 1.0;
  let activeDays = 30;
  let maxExternalSellPct = 0.5;
  let limit = 500;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--minTrades' && args[i + 1]) minTrades = parseInt(args[i + 1]);
    if (args[i] === '--minPnl' && args[i + 1]) minPnl = parseFloat(args[i + 1]);
    if (args[i] === '--minOmega' && args[i + 1]) minOmega = parseFloat(args[i + 1]);
    if (args[i] === '--activeDays' && args[i + 1]) activeDays = parseInt(args[i + 1]);
    if (args[i] === '--maxExternalSellPct' && args[i + 1]) maxExternalSellPct = parseFloat(args[i + 1]);
    if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[i + 1]);
  }

  return { minTrades, minPnl, minOmega, activeDays, maxExternalSellPct, limit };
}

async function main() {
  const config = parseArgs();

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   EXPORT CLOB-FILTERED WALLETS WITH FULL STATS                            ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  console.log('Filters:');
  console.log(`  --minTrades:          ${config.minTrades}`);
  console.log(`  --minPnl:             $${config.minPnl}`);
  console.log(`  --minOmega:           ${config.minOmega}`);
  console.log(`  --activeDays:         ${config.activeDays}`);
  console.log(`  --maxExternalSellPct: ${config.maxExternalSellPct}%`);
  console.log(`  --limit:              ${config.limit}`);
  console.log('');

  // Load candidate wallets to restrict scope
  const candidatesPath = path.join(process.cwd(), 'data', 'candidate-wallets.json');
  let candidateWallets: string[] = [];
  try {
    const candidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8')) as any[];
    // Sort by clob_rows ascending (smallest first) and take limit
    const sorted = [...candidates].sort((a, b) => a.clob_rows - b.clob_rows);
    candidateWallets = sorted.slice(0, 50).map((c: any) => c.wallet_address.toLowerCase());
    console.log(`Loaded ${candidateWallets.length} candidate wallets (smallest by activity)\n`);
  } catch (e) {
    console.log('Warning: candidate-wallets.json not found, scanning all wallets (slow)');
  }

  const walletFilter = candidateWallets.length > 0
    ? `AND wallet_address IN (${candidateWallets.map(w => `'${w}'`).join(',')})`
    : '';

  const client = getClickHouseClient();

  // Simplified single query that computes all stats
  // Uses a heuristic for external sells: total_sell_tokens > total_buy_tokens means external inventory
  const query = `
    WITH
    -- Step 1: Dedupe CLOB trades by event_id per wallet
    deduped AS (
      SELECT
        wallet_address,
        event_id,
        any(condition_id) AS cond_id,
        any(outcome_index) AS out_idx,
        any(token_delta) AS tok_delta,
        any(usdc_delta) AS usd_delta,
        any(event_time) AS evt_time,
        any(payout_norm) AS pay_norm
      FROM pm_unified_ledger_v9_clob_tbl
      WHERE source_type = 'CLOB'
        ${walletFilter}
      GROUP BY wallet_address, event_id
    ),

    -- Step 2: Aggregate per position (wallet, condition, outcome)
    position_agg AS (
      SELECT
        wallet_address,
        cond_id,
        out_idx,
        sum(usd_delta) / 1e6 AS cash_flow,
        sum(tok_delta) / 1e6 AS final_tokens,
        sum(if(tok_delta > 0, tok_delta, 0)) / 1e6 AS total_buys,
        sum(if(tok_delta < 0, -tok_delta, 0)) / 1e6 AS total_sells,
        any(pay_norm) AS payout_norm,
        max(evt_time) AS last_trade,
        count() AS trades_in_position
      FROM deduped
      WHERE cond_id IS NOT NULL AND cond_id != ''
      GROUP BY wallet_address, cond_id, out_idx
    ),

    -- Step 3: Compute position PnL with synthetic resolutions (skip mark prices for speed, use 0.5 for unresolved)
    position_pnl AS (
      SELECT
        wallet_address,
        cond_id,
        cash_flow,
        final_tokens,
        total_buys,
        total_sells,
        last_trade,
        trades_in_position,
        -- External sell heuristic: sold more than bought from CLOB
        greatest(total_sells - total_buys, 0) AS external_sell_tokens,
        -- Settlement price: payout_norm if resolved, else 0.5
        coalesce(payout_norm, 0.5) AS settle_price,
        payout_norm IS NOT NULL AS is_resolved,
        -- Position PnL = cash_flow + (final_tokens * settle_price)
        cash_flow + (final_tokens * coalesce(payout_norm, 0.5)) AS pos_pnl
      FROM position_agg
    ),

    -- Step 5: Aggregate per wallet
    wallet_stats AS (
      SELECT
        wallet_address,
        -- PnL
        sum(pos_pnl) AS total_pnl,
        sum(if(pos_pnl > 0, pos_pnl, 0)) AS gains,
        -sum(if(pos_pnl < 0, pos_pnl, 0)) AS losses,
        -- Omega: gains / losses (θ=0)
        if(sum(if(pos_pnl < 0, -pos_pnl, 0)) = 0,
           if(sum(if(pos_pnl > 0, pos_pnl, 0)) > 0, 999, 0),
           sum(if(pos_pnl > 0, pos_pnl, 0)) / sum(if(pos_pnl < 0, -pos_pnl, 0))
        ) AS omega_0,
        -- Activity
        sum(trades_in_position) AS trade_count,
        count() AS positions,
        countIf(is_resolved) AS resolved_positions,
        max(last_trade) AS last_active,
        min(last_trade) AS first_active,
        -- External sells (rename to avoid conflicts)
        sum(external_sell_tokens) AS ext_sell_sum,
        sum(total_sells) AS tot_sell_sum
      FROM position_pnl
      GROUP BY wallet_address
    )

    SELECT
      wallet_address AS wallet,
      round(total_pnl, 2) AS total_pnl,
      round(omega_0, 3) AS omega_0,
      trade_count,
      positions,
      resolved_positions,
      positions - resolved_positions AS unresolved_positions,
      round(gains, 2) AS gains,
      round(losses, 2) AS losses,
      round(ext_sell_sum, 4) AS external_sell_tokens,
      round(tot_sell_sum, 4) AS total_sell_tokens,
      round(100.0 * ext_sell_sum / nullIf(tot_sell_sum, 0), 4) AS external_sell_pct,
      last_active,
      first_active
    FROM wallet_stats
    WHERE
      trade_count >= ${config.minTrades}
      AND total_pnl >= ${config.minPnl}
      AND omega_0 > ${config.minOmega}
      AND last_active >= now() - INTERVAL ${config.activeDays} DAY
      AND (100.0 * ext_sell_sum / nullIf(tot_sell_sum, 0)) <= ${config.maxExternalSellPct}
    ORDER BY total_pnl DESC
    LIMIT ${config.limit}
  `;

  console.log('Running export query...\n');
  const startTime = Date.now();

  try {
    const result = await client.query({
      query,
      format: 'JSONEachRow',
      clickhouse_settings: {
        max_execution_time: 600,
      },
    });

    const rows = await result.json() as any[];
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`✅ Query completed in ${elapsed}s\n`);
    console.log(`Found ${rows.length} wallets matching all criteria\n`);

    if (rows.length > 0) {
      // Stats
      const totalPnl = rows.reduce((s, r: any) => s + r.total_pnl, 0);
      const avgOmega = rows.reduce((s, r: any) => s + r.omega_0, 0) / rows.length;
      const avgTrades = rows.reduce((s, r: any) => s + r.trade_count, 0) / rows.length;

      console.log('╔════════════════════════════════════════════════════════════════════════════╗');
      console.log('║                              SUMMARY                                       ║');
      console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

      console.log(`  Wallets found:    ${rows.length}`);
      console.log(`  Total PnL:        $${totalPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
      console.log(`  Avg Omega:        ${avgOmega.toFixed(2)}`);
      console.log(`  Avg Trades:       ${avgTrades.toFixed(0)}`);

      console.log('\n🏆 Top 20 Super Forecasters:');
      console.log('┌────┬──────────────────────────────────────────────┬────────────────┬─────────┬────────┬───────────────┐');
      console.log('│ #  │ Wallet                                       │ Total PnL      │ Omega   │ Trades │ Ext Sell %    │');
      console.log('├────┼──────────────────────────────────────────────┼────────────────┼─────────┼────────┼───────────────┤');

      rows.slice(0, 20).forEach((r: any, i: number) => {
        const pnlStr = r.total_pnl >= 0
          ? `+$${r.total_pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
          : `-$${Math.abs(r.total_pnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
        const omegaStr = r.omega_0 >= 999 ? '∞' : r.omega_0.toFixed(2);
        console.log(
          `│ ${String(i + 1).padStart(2)} │ ${r.wallet.padEnd(44)} │ ${pnlStr.padStart(14)} │ ${omegaStr.padStart(7)} │ ${String(r.trade_count).padStart(6)} │ ${(r.external_sell_pct.toFixed(2) + '%').padStart(13)} │`
        );
      });

      console.log('└────┴──────────────────────────────────────────────┴────────────────┴─────────┴────────┴───────────────┘');
    }

    // Write exports
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const exportsDir = path.join(process.cwd(), 'data', 'exports');
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }

    // JSON export
    const jsonPath = path.join(exportsDir, `clob_filtered_wallets.${timestamp}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify({
      generated_at: new Date().toISOString(),
      query_time_seconds: parseFloat(elapsed),
      filters: config,
      summary: {
        count: rows.length,
        total_pnl: rows.reduce((s, r: any) => s + r.total_pnl, 0),
      },
      wallets: rows,
    }, null, 2));

    // CSV export
    const csvPath = path.join(exportsDir, `clob_filtered_wallets.${timestamp}.csv`);
    const csvHeader = 'wallet,total_pnl,omega_0,trade_count,positions,resolved_positions,unresolved_positions,gains,losses,external_sell_tokens,total_sell_tokens,external_sell_pct,last_active,first_active';
    const csvRows = rows.map((r: any) =>
      `${r.wallet},${r.total_pnl},${r.omega_0},${r.trade_count},${r.positions},${r.resolved_positions},${r.unresolved_positions},${r.gains},${r.losses},${r.external_sell_tokens},${r.total_sell_tokens},${r.external_sell_pct},${r.last_active},${r.first_active}`
    );
    fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'));

    console.log(`\n✅ JSON: ${jsonPath}`);
    console.log(`✅ CSV:  ${csvPath}`);

  } catch (error: any) {
    console.error('❌ Query failed:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);
