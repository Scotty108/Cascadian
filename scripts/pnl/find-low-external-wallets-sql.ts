/**
 * STEP 1: Batch Eligibility Query (Single ClickHouse Query)
 *
 * Finds wallets with low external_sell_pct in ONE query.
 * Much faster than per-wallet loops.
 *
 * Usage:
 *   npx tsx scripts/pnl/find-low-external-wallets-sql.ts
 *   npx tsx scripts/pnl/find-low-external-wallets-sql.ts --limit 100
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { getClickHouseClient } from '../../lib/clickhouse/client';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const args = process.argv.slice(2);
  let limit = 200;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1]);
    }
  }

  console.log('╔════════════════════════════════════════════════════════════════════════════╗');
  console.log('║   STEP 1: BATCH ELIGIBILITY QUERY (Single ClickHouse Query)               ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

  // Load candidate wallets (pick smallest by clob_rows)
  const candidatesPath = path.join(process.cwd(), 'data', 'candidate-wallets.json');
  const candidates = JSON.parse(fs.readFileSync(candidatesPath, 'utf-8')) as any[];

  // Sort by clob_rows ascending (smallest first) and take limit
  const sorted = [...candidates].sort((a, b) => a.clob_rows - b.clob_rows);
  const selected = sorted.slice(0, limit);
  const walletList = selected.map((c: any) => `'${c.wallet_address.toLowerCase()}'`).join(',');

  console.log(`Selected ${selected.length} smallest wallets from ${candidates.length} candidates\n`);

  const client = getClickHouseClient();

  // Single batch query for eligibility
  // Key: compute external_sell_pct using window function for running position
  const query = `
    WITH
    -- Step 1: Dedupe by event_id per wallet
    deduped AS (
      SELECT
        wallet_address,
        event_id,
        any(condition_id) AS cond_id,
        any(outcome_index) AS out_idx,
        any(token_delta) AS token_delta,
        any(event_time) AS event_time
      FROM pm_unified_ledger_v9_clob_tbl
      WHERE source_type = 'CLOB'
        AND wallet_address IN (${walletList})
      GROUP BY wallet_address, event_id
    ),

    -- Step 2: Compute running position per (wallet, condition, outcome)
    with_pos AS (
      SELECT
        wallet_address,
        cond_id,
        out_idx,
        token_delta,
        sum(token_delta) OVER (
          PARTITION BY wallet_address, cond_id, out_idx
          ORDER BY event_time, event_id
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ) AS pos_before
      FROM deduped
    ),

    -- Step 3: Flag external sells (selling more than you have from CLOB)
    flagged AS (
      SELECT
        wallet_address,
        token_delta,
        -- External sell: selling when pos_before is insufficient
        if(token_delta < 0 AND coalesce(pos_before, 0) < abs(token_delta),
           abs(token_delta) - greatest(coalesce(pos_before, 0), 0),
           0) AS external_sell_tokens,
        -- All sells
        if(token_delta < 0, abs(token_delta), 0) AS sell_tokens,
        -- Mapped check
        if(cond_id IS NOT NULL AND cond_id != '', 1, 0) AS is_mapped
      FROM with_pos
    ),

    -- Step 4: Aggregate per wallet
    wallet_stats AS (
      SELECT
        wallet_address,
        count() AS clob_rows,
        sum(external_sell_tokens) AS total_external_sells,
        sum(sell_tokens) AS total_sell_tokens,
        100.0 * sum(external_sell_tokens) / nullIf(sum(sell_tokens), 0) AS external_sell_pct,
        100.0 * sum(is_mapped) / count() AS mapped_ratio
      FROM flagged
      GROUP BY wallet_address
    )

    SELECT
      wallet_address,
      clob_rows,
      round(external_sell_pct, 4) AS external_sell_pct,
      round(mapped_ratio, 2) AS mapped_ratio,
      total_external_sells,
      total_sell_tokens,
      -- Eligibility check
      external_sell_pct <= 0.5 AND mapped_ratio >= 99.9 AS is_eligible
    FROM wallet_stats
    ORDER BY external_sell_pct ASC, clob_rows DESC
  `;

  console.log('Running batch eligibility query...\n');
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

    // Categorize results
    const eligible = rows.filter((r: any) => r.is_eligible);
    const nearEligible = rows.filter((r: any) =>
      !r.is_eligible &&
      r.external_sell_pct <= 1.0 &&
      r.mapped_ratio >= 99.0
    );

    console.log('╔════════════════════════════════════════════════════════════════════════════╗');
    console.log('║                              RESULTS                                       ║');
    console.log('╚════════════════════════════════════════════════════════════════════════════╝\n');

    console.log(`  Eligible (≤0.5% ext, ≥99.9% mapped):  ${eligible.length} wallets`);
    console.log(`  Near-eligible (≤1% ext, ≥99% mapped): ${nearEligible.length} wallets`);
    console.log(`  Total processed:                      ${rows.length} wallets`);

    if (eligible.length > 0) {
      console.log('\n🏆 Top 20 Eligible Wallets:');
      console.log('┌────┬──────────────────────────────────────────────┬───────────────┬──────────────┬──────────┐');
      console.log('│ #  │ Wallet                                       │ Ext Sell %    │ Mapped %     │ CLOB Rows│');
      console.log('├────┼──────────────────────────────────────────────┼───────────────┼──────────────┼──────────┤');

      eligible.slice(0, 20).forEach((r: any, i: number) => {
        console.log(
          `│ ${String(i + 1).padStart(2)} │ ${r.wallet_address.padEnd(44)} │ ${(r.external_sell_pct?.toFixed(3) + '%').padStart(13)} │ ${(r.mapped_ratio?.toFixed(1) + '%').padStart(12)} │ ${String(r.clob_rows).padStart(8)} │`
        );
      });

      console.log('└────┴──────────────────────────────────────────────┴───────────────┴──────────────┴──────────┘');
    } else {
      console.log('\n⚠️  No eligible wallets found. Consider:');
      console.log('    - Increasing --limit');
      console.log('    - Relaxing criteria (external_sell_pct <= 1%)');
    }

    // Write output
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outputPath = path.join(process.cwd(), 'data', `low-external-wallets.${timestamp}.json`);
    const stablePath = path.join(process.cwd(), 'data', 'low-external-wallets.json');

    const output = {
      generated_at: new Date().toISOString(),
      query_time_seconds: parseFloat(elapsed),
      criteria: {
        external_sell_pct_max: 0.5,
        mapped_ratio_min: 99.9,
      },
      summary: {
        total_processed: rows.length,
        eligible: eligible.length,
        near_eligible: nearEligible.length,
      },
      eligible_wallets: eligible,
      all_results: rows,
    };

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    fs.writeFileSync(stablePath, JSON.stringify(output, null, 2));

    console.log(`\n✅ Versioned: ${outputPath}`);
    console.log(`✅ Stable:    ${stablePath}`);

  } catch (error: any) {
    console.error('❌ Query failed:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);
