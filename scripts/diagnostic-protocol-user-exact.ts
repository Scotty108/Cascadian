#!/usr/bin/env npx tsx

import "dotenv/config";
import { createClient } from "@clickhouse/client";

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST || "https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443",
  username: process.env.CLICKHOUSE_USER || "default",
  password: process.env.CLICKHOUSE_PASSWORD || "8miOkWI~OhsDb",
  database: process.env.CLICKHOUSE_DATABASE || "default",
  request_timeout: 600000,
});

async function queryData(query: string) {
  const result = await ch.query({ query, format: 'JSON' });
  const text = await result.text();
  return JSON.parse(text).data || [];
}

async function main() {
  console.log("\n════════════════════════════════════════════════════════════════════");
  console.log("DIAGNOSTIC PROTOCOL - STEPS 1-5 (EXACT)");
  console.log("════════════════════════════════════════════════════════════════════\n");

  // STEP 1: Confirm dedup is feeding every downstream view
  console.log("📊 STEP 1: Confirm Dedup Effectiveness\n");
  try {
    const dedupCheck = await queryData(`
      WITH wallets AS (
        SELECT array(
          '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
          '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
        ) AS w
      )
      SELECT
        'raw' AS tag,
        count() AS rows,
        uniqExact(transaction_hash, toInt32OrNull(log_index)) AS uniq_fills
      FROM trades_raw, wallets
      WHERE lower(wallet_address) IN w

      UNION ALL
      SELECT
        'dedup',
        count(),
        uniqExact(transaction_hash, toInt32OrNull(log_index))
      FROM trades_dedup, wallets
      WHERE lower(wallet_address) IN w
    `);

    if (dedupCheck.length >= 2) {
      const raw = dedupCheck.find((r: any) => r.tag === 'raw');
      const dedup = dedupCheck.find((r: any) => r.tag === 'dedup');

      console.log(`  Raw trades:       ${raw.rows} rows, ${raw.uniq_fills} unique fills`);
      console.log(`  Dedup trades:     ${dedup.rows} rows, ${dedup.uniq_fills} unique fills`);
      console.log(`  Duplicates found: ${raw.rows - dedup.rows} (removed)`);

      if (dedup.rows === dedup.uniq_fills) {
        console.log(`  ✅ PASS: dedup.rows === dedup.uniq_fills\n`);
      } else {
        console.log(`  ❌ FAIL: Still have duplicates in dedup!\n`);
      }
    }
  } catch (e: any) {
    console.error(`  ❌ Step 1 failed: ${e.message?.substring(0, 200)}\n`);
  }

  // STEP 2: Prove bridge and resolution joins are one-to-one
  console.log("🔍 STEP 2: Verify Bridge & Resolution Joins (1:1)\n");

  try {
    console.log("  2a) canonical_condition cardinality check...");
    const bridgeCard = await queryData(`
      SELECT market_id, count() c
      FROM canonical_condition
      GROUP BY market_id
      HAVING c > 1
      LIMIT 10
    `);

    if (bridgeCard.length === 0) {
      console.log(`      ✅ PASS: No duplicate market_ids\n`);
    } else {
      console.log(`      ❌ FAIL: Found ${bridgeCard.length} markets with duplicates\n`);
    }
  } catch (e: any) {
    console.error(`      ❌ Check failed: ${e.message?.substring(0, 100)}\n`);
  }

  try {
    console.log("  2b) winning_index cardinality check...");
    const winCard = await queryData(`
      SELECT condition_id_norm, count() c
      FROM winning_index
      GROUP BY condition_id_norm
      HAVING c > 1
      LIMIT 10
    `);

    if (winCard.length === 0) {
      console.log(`      ✅ PASS: No duplicate condition_id_norms\n`);
    } else {
      console.log(`      ❌ FAIL: Found ${winCard.length} conditions with duplicates\n`);
    }
  } catch (e: any) {
    console.error(`      ❌ Check failed: ${e.message?.substring(0, 100)}\n`);
  }

  try {
    console.log("  2c) Fanout check across joins with ANY...");
    const fanoutCheck = await queryData(`
      WITH wallets AS (
        SELECT array(
          '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
          '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
        ) AS w
      )
      SELECT
        'base' AS tag,
        count() AS rows
      FROM trades_dedup, wallets
      WHERE lower(wallet_address) IN w

      UNION ALL
      SELECT
        'bridge',
        count()
      FROM trades_dedup t
      ANY LEFT JOIN canonical_condition c USING (market_id)
      , wallets
      WHERE lower(t.wallet_address) IN w

      UNION ALL
      SELECT
        'bridge+win',
        count()
      FROM trades_dedup t
      ANY LEFT JOIN canonical_condition c USING (market_id)
      ANY LEFT JOIN winning_index wi USING (condition_id_norm)
      , wallets
      WHERE lower(t.wallet_address) IN w
    `);

    if (fanoutCheck.length >= 3) {
      const base = fanoutCheck.find((r: any) => r.tag === 'base');
      const bridge = fanoutCheck.find((r: any) => r.tag === 'bridge');
      const bridgeWin = fanoutCheck.find((r: any) => r.tag === 'bridge+win');

      console.log(`      Base rows:         ${base.rows}`);
      console.log(`      After bridge join: ${bridge.rows}`);
      console.log(`      After win join:    ${bridgeWin.rows}`);

      if (base.rows === bridge.rows && bridge.rows === bridgeWin.rows) {
        console.log(`      ✅ PASS: No fanout detected\n`);
      } else {
        console.log(`      ❌ FAIL: Fanout detected!\n`);
      }
    }
  } catch (e: any) {
    console.error(`      ❌ Check failed: ${e.message?.substring(0, 100)}\n`);
  }

  // STEP 3: Recompute with corrected views
  console.log("🔧 STEP 3: Recreate Views with Unit Scaling Fix\n");

  try {
    const views = [
      [
        "trade_cashflows_v3 (unit normalized)",
        `CREATE OR REPLACE VIEW trade_cashflows_v3 AS
SELECT
  lower(toString(wallet_address)) AS wallet,
  lower(toString(market_id)) AS market_id,
  lower(replaceAll(toString(condition_id),'0x','')) AS condition_id_norm,
  toInt16OrNull(outcome_index) AS outcome_idx,
  -- normalize price to [0,1]
  case
    when entry_price > 10000 then toFloat64(entry_price)/10000
    when entry_price > 100 then toFloat64(entry_price)/100
    else toFloat64(entry_price)
  end AS px_norm,
  toFloat64(shares) AS sh_norm,
  -- sign by side
  sum(
    if(side IN ('YES','BUY',1), -px_norm*abs(sh_norm), px_norm*abs(sh_norm))
  ) AS cashflow_usdc
FROM trades_dedup
WHERE market_id NOT IN ('12')
GROUP BY wallet, market_id, condition_id_norm, outcome_idx, px_norm, sh_norm`
      ],
      [
        "outcome_positions_v2 (corrected)",
        `CREATE OR REPLACE VIEW outcome_positions_v2 AS
SELECT
  lower(toString(wallet_address)) AS wallet,
  lower(toString(market_id)) AS market_id,
  lower(replaceAll(toString(condition_id),'0x','')) AS condition_id_norm,
  toInt16OrNull(outcome_index) AS outcome_idx,
  sum( if(side IN ('YES','BUY',1),  1.0, -1.0) * toFloat64(shares) ) AS net_shares
FROM trades_dedup
WHERE market_id NOT IN ('12')
GROUP BY wallet, market_id, condition_id_norm, outcome_idx`
      ],
      [
        "realized_pnl_by_market_final (corrected settlement)",
        `CREATE OR REPLACE VIEW realized_pnl_by_market_final AS
WITH win AS (
  SELECT condition_id_norm, toInt16(win_idx) AS win_idx, resolved_at
  FROM winning_index
)
SELECT
  p.wallet,
  p.market_id,
  p.condition_id_norm,
  w.resolved_at,
  round(
    sumIf(toFloat64(p.net_shares), p.outcome_idx = w.win_idx)
    +
    sum(-toFloat64(c.cashflow_usdc))
  , 4) AS realized_pnl_usd
FROM outcome_positions_v2 p
ANY LEFT JOIN trade_cashflows_v3 c
  USING (wallet, market_id, condition_id_norm, outcome_idx)
ANY LEFT JOIN win w
  USING (condition_id_norm)
WHERE w.win_idx IS NOT NULL
GROUP BY p.wallet, p.market_id, p.condition_id_norm, w.resolved_at`
      ]
    ];

    let successCount = 0;
    for (const [name, query] of views) {
      try {
        console.log(`  Creating: ${name}...`);
        await ch.query({ query });
        console.log(`  ✅ ${name}\n`);
        successCount++;
      } catch (e: any) {
        console.error(`  ❌ ${name}: ${e.message?.substring(0, 100)}\n`);
      }
    }
    console.log(`  Views created: ${successCount}/${views.length}\n`);
  } catch (e: any) {
    console.error(`  ❌ Step 3 failed: ${e.message?.substring(0, 200)}\n`);
  }

  // STEP 4: Verify position aggregation
  console.log("📈 STEP 4: Verify Position Aggregation\n");
  try {
    const posCheck = await queryData(`
      WITH wallets AS (
        SELECT array(
          '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
          '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
        ) AS w
      )
      SELECT
        count() AS outcome_positions,
        countIf(net_shares > 0) AS long_positions,
        countIf(net_shares < 0) AS short_positions,
        countIf(net_shares = 0) AS zero_positions
      FROM outcome_positions_v2, wallets
      WHERE wallet IN w
    `);

    if (posCheck.length > 0) {
      const pos = posCheck[0];
      console.log(`  Total outcome positions: ${pos.outcome_positions}`);
      console.log(`  Long positions:         ${pos.long_positions}`);
      console.log(`  Short positions:        ${pos.short_positions}`);
      console.log(`  Zero positions:         ${pos.zero_positions}`);
      console.log(`  ✅ Positions aggregated\n`);
    }
  } catch (e: any) {
    console.error(`  ❌ Step 4 failed: ${e.message?.substring(0, 200)}\n`);
  }

  // STEP 5: Compute wallet totals and compare to Polymarket targets
  console.log("🎯 STEP 5: Final P&L Comparison vs Polymarket Targets\n");
  try {
    const finalResults = await queryData(`
      WITH wallets AS (
        SELECT array(
          '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8',
          '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0'
        ) AS w
      ),
      realized AS (
        SELECT wallet, round(sum(realized_pnl_usd),2) AS realized_usd
        FROM realized_pnl_by_market_final
        GROUP BY wallet
      ),
      unrealized AS (
        SELECT wallet, round(sum(unrealized_pnl_usd),2) AS unrealized_usd
        FROM wallet_unrealized_pnl_v2
        GROUP BY wallet
      )
      SELECT
        r.wallet,
        r.realized_usd,
        coalesce(u.unrealized_usd,0) AS unrealized_usd,
        round(r.realized_usd + coalesce(u.unrealized_usd,0),2) AS total_usd,
        case
          when r.wallet = '0xa4b366ad22fc0d06f1e934ff468e8922431a87b8' then 89975.16
          when r.wallet = '0xeb6f0a13ea8c5a7a0514c25495adbe815c1025f0' then 102001.46
        end AS expected_total,
        round(100.0 * abs( (r.realized_usd + coalesce(u.unrealized_usd,0)) - expected_total ) / nullIf(expected_total,0), 3) AS pct_diff
      FROM realized r
      ANY LEFT JOIN unrealized u USING (wallet)
      WHERE r.wallet IN (SELECT * FROM wallets)
    `);

    if (finalResults.length > 0) {
      console.log("  HolyMoses7 (0xa4b3...):");
      const holy = finalResults.find((r: any) => r.wallet.startsWith('0xa4b3'));
      if (holy) {
        console.log(`    Realized:   $${holy.realized_usd}`);
        console.log(`    Unrealized: $${holy.unrealized_usd}`);
        console.log(`    Total:      $${holy.total_usd}`);
        console.log(`    Expected:   $${holy.expected_total}`);
        console.log(`    Variance:   ${holy.pct_diff}%`);
        console.log(`    Status:     ${holy.pct_diff <= 5 ? '✅ PASS' : '❌ FAIL'}\n`);
      }

      console.log("  niggemon (0xeb6f...):");
      const niggemon = finalResults.find((r: any) => r.wallet.startsWith('0xeb6f'));
      if (niggemon) {
        console.log(`    Realized:   $${niggemon.realized_usd}`);
        console.log(`    Unrealized: $${niggemon.unrealized_usd}`);
        console.log(`    Total:      $${niggemon.total_usd}`);
        console.log(`    Expected:   $${niggemon.expected_total}`);
        console.log(`    Variance:   ${niggemon.pct_diff}%`);
        console.log(`    Status:     ${niggemon.pct_diff <= 5 ? '✅ PASS' : '❌ FAIL'}\n`);
      }

      const maxVar = Math.max(
        holy?.pct_diff || 0,
        niggemon?.pct_diff || 0
      );

      console.log("════════════════════════════════════════════════════════════════════");
      if (maxVar <= 5) {
        console.log(`✅ SUCCESS: All wallets within 5% variance! Work complete.\n`);
      } else {
        console.log(`❌ FAIL: Maximum variance is ${maxVar}% (threshold: 5%)`);
        console.log(`   Proceed to Step 6 diagnostics.\n`);
      }
    }
  } catch (e: any) {
    console.error(`  ❌ Step 5 failed: ${e.message?.substring(0, 200)}\n`);
  }

  console.log("════════════════════════════════════════════════════════════════════\n");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
