#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 45000,
});

async function queryData(query: string) {
  try {
    const result = await ch.query({ query, format: 'JSONCompact' });
    const text = await result.text();
    const parsed = JSON.parse(text);
    return parsed.data || [];
  } catch (e: any) {
    console.error(`Query error: ${e.message}`);
    return null;
  }
}

async function main() {
  const wallet1 = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8';
  const wallet2 = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0';

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log("INVESTIGATION: Why HolyMoses7 is -31% while niggemon is -2.3%");
  console.log("════════════════════════════════════════════════════════════════\n");

  // Portfolio composition comparison
  console.log("1. PORTFOLIO COMPOSITION");
  console.log("─".repeat(70));

  let result = await queryData(`
    SELECT 
      wallet,
      count() as total_positions,
      countIf(net_shares > 0) as long_positions,
      countIf(net_shares < 0) as short_positions,
      countIf(net_shares = 0) as closed_positions,
      round(sum(net_shares), 2) as total_net_shares,
      round(sum(abs(net_shares)), 2) as total_abs_exposure
    FROM outcome_positions_v2
    WHERE wallet IN (lower('${wallet1}'), lower('${wallet2}'))
    GROUP BY wallet
    ORDER BY wallet
  `);

  if (result && result.length > 0) {
    console.log(`  Wallet | Positions | Long | Short | Closed | Net Shares | Exposure`);
    console.log(`  ${"─".repeat(70)}`);
    for (const r of result) {
      const w = r[0].substring(0, 12);
      const total = r[1];
      const long = r[2];
      const short = r[3];
      const closed = r[4];
      const net = r[5];
      const exposure = r[6];
      console.log(`  ${w}... | ${total} | ${long} | ${short} | ${closed} | ${net} | ${exposure}`);
    }
  }
  console.log("");

  // Check winning position distribution
  console.log("2. WINNING vs LOSING POSITIONS");
  console.log("─".repeat(70));

  result = await queryData(`
    WITH win AS (
      SELECT condition_id_norm, toInt16(win_idx) AS win_idx FROM winning_index
    )
    SELECT 
      p.wallet,
      countIf(p.outcome_idx = w.win_idx AND p.net_shares > 0) as winning_longs,
      countIf(p.outcome_idx = w.win_idx AND p.net_shares < 0) as winning_shorts,
      countIf(p.outcome_idx != w.win_idx AND p.net_shares > 0) as losing_longs,
      countIf(p.outcome_idx != w.win_idx AND p.net_shares < 0) as losing_shorts
    FROM outcome_positions_v2 AS p
    ANY LEFT JOIN win AS w ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
    WHERE p.wallet IN (lower('${wallet1}'), lower('${wallet2}'))
      AND w.win_idx IS NOT NULL
    GROUP BY p.wallet
    ORDER BY p.wallet
  `);

  if (result && result.length > 0) {
    console.log(`  Wallet | Win Longs | Win Shorts | Loss Longs | Loss Shorts`);
    console.log(`  ${"─".repeat(65)}`);
    for (const r of result) {
      const w = r[0].substring(0, 12);
      const wl = r[1];
      const ws = r[2];
      const ll = r[3];
      const ls = r[4];
      console.log(`  ${w}... | ${wl} | ${ws} | ${ll} | ${ls}`);
    }
  }
  console.log("");

  // Check open vs closed positions
  console.log("3. OPEN vs RESOLVED POSITIONS");
  console.log("─".repeat(70));

  result = await queryData(`
    WITH win AS (
      SELECT condition_id_norm, toInt16(win_idx) AS win_idx FROM winning_index
    )
    SELECT 
      p.wallet,
      count() as total,
      countIf(w.win_idx IS NOT NULL) as resolved,
      countIf(w.win_idx IS NULL) as unresolved
    FROM outcome_positions_v2 AS p
    LEFT JOIN win AS w ON lower(replaceAll(w.condition_id_norm, '0x', '')) = lower(replaceAll(p.condition_id_norm, '0x', ''))
    WHERE p.wallet IN (lower('${wallet1}'), lower('${wallet2}'))
    GROUP BY p.wallet
    ORDER BY p.wallet
  `);

  if (result && result.length > 0) {
    console.log(`  Wallet | Total | Resolved | Unresolved | % Resolved`);
    console.log(`  ${"─".repeat(55)}`);
    for (const r of result) {
      const w = r[0].substring(0, 12);
      const total = r[1];
      const resolved = r[2];
      const unresolved = r[3];
      const pct = total > 0 ? (resolved * 100 / total).toFixed(1) : 0;
      console.log(`  ${w}... | ${total} | ${resolved} | ${unresolved} | ${pct}%`);
    }
  }
  console.log("");

  // Check gap: what's the missing $28k for HolyMoses7?
  console.log("4. P&L VARIANCE BREAKDOWN");
  console.log("─".repeat(70));

  const gap_holymoses = 89975.16 - 61921.44;
  const gap_niggemon = 102001.46 - 99691.54;

  console.log(`  HolyMoses7: Gap = $${gap_holymoses.toFixed(2)} (missing)`);
  console.log(`  niggemon:   Gap = $${gap_niggemon.toFixed(2)} (missing)`);
  console.log("");

  console.log(`  HYPOTHESIS: HolyMoses7 has more unresolved positions with unrealized gains`);
  console.log(`  that will materialize as realized P&L when markets resolve.\n`);

  console.log("════════════════════════════════════════════════════════════════\n");
}

main().catch(console.error);
