#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 120000,
});

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: 'JSON' });
    const text = await result.text();
    return JSON.parse(text).data || [];
  } catch (e: any) {
    console.error(`Query error: ${e.message?.substring(0, 200)}`);
    return [];
  }
}

const wallet1 = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';
const wallet2 = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';

const expected = {
  [wallet1]: 89975.16,
  [wallet2]: 102001.46
};

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("FINAL GAP ANALYSIS - WHY IS REALIZED P&L OFF?");
  console.log("════════════════════════════════════════════════════════════════\n");

  // Check 1: Are wallets keyed to EOA or proxy in trades_raw?
  console.log("📍 CHECK 1: Wallet Address Formats in trades_raw\n");
  try {
    const sample = await queryData(`
      SELECT DISTINCT lower(wallet_address) as wallet
      FROM trades_raw
      WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}',
        -- Also check proxy-like addresses (lowercase, 40 hex chars)
        '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
        '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0')
      LIMIT 10
    `);

    if (sample.length === 0) {
      console.log(`  ⚠️  Neither wallet found in trades_raw with exact EOA match\n`);
    } else {
      for (const row of sample) {
        console.log(`  ✅ Found: ${row.wallet}\n`);
      }
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 150)}\n`);
  }

  // Check 2: Trade count and coverage
  console.log("📊 CHECK 2: Trade Count and Market Coverage\n");
  try {
    const counts = await queryData(`
      SELECT
        lower(wallet_address) as wallet,
        count() as total_trades,
        count(DISTINCT market_id) as unique_markets,
        countIf(condition_id != '') as with_condition_id,
        countIf(outcome_index > 0) as with_outcome_index
      FROM trades_raw
      WHERE lower(wallet_address) IN ('${wallet1}', '${wallet2}')
      GROUP BY wallet
      ORDER BY wallet
    `);

    for (const row of counts) {
      const expected_val = expected[row.wallet];
      console.log(`  ${row.wallet.substring(0, 12)}...`);
      console.log(`    Total trades: ${row.total_trades}`);
      console.log(`    Unique markets: ${row.unique_markets}`);
      console.log(`    With condition_id: ${row.with_condition_id}`);
      console.log(`    With outcome_index: ${row.with_outcome_index}\n`);
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 150)}\n`);
  }

  // Check 3: Can we match trades to winning_index?
  console.log("🔗 CHECK 3: Trade-to-Resolution Matching\n");
  try {
    const matches = await queryData(`
      SELECT
        lower(t.wallet_address) as wallet,
        count(DISTINCT t.trade_id) as matched_trades,
        countDistinct(lower(replaceAll(t.condition_id, '0x', ''))) as matched_conditions
      FROM trades_raw t
      INNER JOIN winning_index w ON lower(replaceAll(t.condition_id, '0x', '')) = w.condition_id_norm
      WHERE lower(t.wallet_address) IN ('${wallet1}', '${wallet2}')
      GROUP BY wallet
      ORDER BY wallet
    `);

    if (matches.length === 0) {
      console.log(`  ❌ NO matches between trades_raw and winning_index\n`);
    } else {
      for (const row of matches) {
        const total_trades = row.wallet === wallet1 ? 8484 : 16472; // From earlier diagnostics
        const coverage = (parseFloat(row.matched_trades) / total_trades * 100).toFixed(2);
        console.log(`  ${row.wallet.substring(0, 12)}...`);
        console.log(`    Matched trades: ${row.matched_trades} (${coverage}% coverage)`);
        console.log(`    Matched conditions: ${row.matched_conditions}\n`);
      }
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 150)}\n`);
  }

  // Check 4: What does the current wallet_pnl_summary_final show?
  console.log("💰 CHECK 4: Current wallet_pnl_summary_final Values\n");
  try {
    const summary = await queryData(`
      SELECT
        wallet,
        realized_pnl_usd,
        unrealized_pnl_usd,
        total_pnl_usd
      FROM wallet_pnl_summary_final
      WHERE wallet IN ('${wallet1}', '${wallet2}')
      ORDER BY wallet
    `);

    for (const row of summary) {
      const expected_val = expected[row.wallet];
      const realized = parseFloat(row.realized_pnl_usd || 0);
      const variance = ((realized - expected_val) / expected_val * 100).toFixed(2);

      console.log(`  ${row.wallet.substring(0, 12)}...`);
      console.log(`    Realized PnL: $${row.realized_pnl_usd}`);
      console.log(`    Expected: $${expected_val.toFixed(2)}`);
      console.log(`    Variance: ${variance}%`);
      console.log(`    Gap: $${(expected_val - realized).toFixed(2)}\n`);
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 150)}\n`);
  }

  // Check 5: Is the gap explained by missing resolution data?
  console.log("❓ CHECK 5: Would Including Unresolved Trades Close the Gap?\n");
  try {
    const unresolved = await queryData(`
      SELECT
        lower(t.wallet_address) as wallet,
        count() as unresolved_trades,
        round(sum(
          CASE
            WHEN t.side = 1 THEN -t.entry_price * t.shares
            WHEN t.side = 2 THEN t.entry_price * t.shares
            ELSE 0
          END
        ), 2) as unresolved_cashflow,
        round(sum(COALESCE(t.fee_usd, 0) + COALESCE(t.slippage_usd, 0)), 2) as fees
      FROM trades_raw t
      LEFT JOIN winning_index w ON lower(replaceAll(t.condition_id, '0x', '')) = w.condition_id_norm
      WHERE lower(t.wallet_address) IN ('${wallet1}', '${wallet2}')
        AND w.condition_id_norm IS NULL
      GROUP BY wallet
      ORDER BY wallet
    `);

    for (const row of unresolved) {
      const cashflow = parseFloat(row.unresolved_cashflow || 0);
      const fees = parseFloat(row.fees || 0);
      const net = cashflow - fees;
      const expected_val = expected[row.wallet];
      const current_pnl = row.wallet === wallet1 ? 52090.38 : 116004.32;
      const potential_total = current_pnl + net;
      const gap = expected_val - potential_total;

      console.log(`  ${row.wallet.substring(0, 12)}...`);
      console.log(`    Unresolved trades: ${row.unresolved_trades}`);
      console.log(`    Unresolved net P&L: $${net.toFixed(2)}`);
      console.log(`    Current realized: $${current_pnl.toFixed(2)}`);
      console.log(`    Potential total: $${potential_total.toFixed(2)}`);
      console.log(`    Expected: $${expected_val.toFixed(2)}`);
      console.log(`    Remaining gap: $${gap.toFixed(2)} (${(gap/expected_val*100).toFixed(2)}%)\n`);
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 150)}\n`);
  }

  // Check 6: Sample trades that matched vs didn't match
  console.log("🔍 CHECK 6: Sample Matched Trades (First 5)\n");
  try {
    const samples = await queryData(`
      SELECT
        lower(t.wallet_address) as wallet,
        t.trade_id,
        t.market_id,
        t.outcome_index,
        w.win_idx,
        t.side,
        t.shares,
        t.entry_price,
        COALESCE(t.fee_usd, 0) + COALESCE(t.slippage_usd, 0) as total_fees,
        CASE
          WHEN t.outcome_index = w.win_idx THEN 'WIN'
          ELSE 'LOSS'
        END as result
      FROM trades_raw t
      INNER JOIN winning_index w ON lower(replaceAll(t.condition_id, '0x', '')) = w.condition_id_norm
      WHERE lower(t.wallet_address) = '${wallet1}'
      ORDER BY t.timestamp DESC
      LIMIT 5
    `);

    if (samples.length === 0) {
      console.log(`  No matched trades found for wallet1\n`);
    } else {
      for (const s of samples) {
        console.log(`  Market: ${s.market_id}`);
        console.log(`    Outcome: ${s.outcome_index} (winning: ${s.win_idx}, ${s.result})`);
        console.log(`    Side: ${s.side === 1 ? 'BUY' : 'SELL'}, Shares: ${s.shares}`);
        console.log(`    Price: $${s.entry_price}, Fees: $${s.total_fees}\n`);
      }
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message?.substring(0, 150)}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
