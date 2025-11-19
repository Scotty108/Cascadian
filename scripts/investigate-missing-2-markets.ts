import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log("═".repeat(80));
  console.log("INVESTIGATING THE 2 MISSING MARKETS");
  console.log("═".repeat(80));
  console.log();

  const testWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  const missingMarkets = [
    '340c700abfd4870e2cc9f31d6df6fc95698b65e98da75dca89e1e2f5bace2a58',
    '6693435e9dfb8660742c0de5ddfca8f46350c219da98b8993b2ed9c726560838'
  ];

  console.log("These are the 2 markets in CLOB but NOT in final P&L view:");
  console.log();

  for (const conditionId of missingMarkets) {
    console.log(`Market: ${conditionId.substring(0, 16)}...`);
    console.log("─".repeat(80));

    // Check CLOB fills for this market
    const fillsQuery = await clickhouse.query({
      query: `
        SELECT
          cf.asset_id,
          cf.side,
          cf.price,
          cf.size / 1000000.0 as shares,
          if(cf.side = 'BUY', -1, 1) * cf.price * cf.size / 1000000.0 as cashflow_contribution,
          ctm.outcome_index
        FROM clob_fills cf
        LEFT JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
        WHERE lower(cf.proxy_wallet) = lower('${testWallet}')
          AND lower(replaceAll(cf.condition_id, '0x', '')) = '${conditionId}'
        ORDER BY cf.timestamp
      `,
      format: 'JSONEachRow'
    });
    const fills = await fillsQuery.json();

    console.log(`Fills: ${fills.length}`);
    if (fills.length > 0) {
      console.table(fills.map((f: any) => ({
        asset_id: f.asset_id.substring(0, 16) + '...',
        side: f.side,
        price: f.price.toFixed(4),
        shares: f.shares.toFixed(2),
        cashflow: f.cashflow_contribution ? `$${f.cashflow_contribution.toFixed(2)}` : 'N/A',
        outcome: f.outcome_index
      })));

      // Calculate totals
      const totalCashflow = fills.reduce((sum: number, f: any) =>
        sum + (f.cashflow_contribution || 0), 0);
      const netSharesByOutcome = new Map<number, number>();

      for (const fill of fills) {
        if (fill.outcome_index !== null) {
          const current = netSharesByOutcome.get(fill.outcome_index) || 0;
          const delta = fill.side === 'BUY' ? fill.shares : -fill.shares;
          netSharesByOutcome.set(fill.outcome_index, current + delta);
        }
      }

      console.log(`\nTotals:`);
      console.log(`  Total cashflow: $${totalCashflow.toFixed(2)}`);
      console.log(`  Net shares by outcome:`);
      netSharesByOutcome.forEach((shares, outcome) => {
        console.log(`    Outcome ${outcome}: ${shares.toFixed(2)} shares`);
      });
    }

    // Check resolution
    const resolutionQuery = await clickhouse.query({
      query: `
        SELECT
          cid,
          winning_outcome,
          count(*) as dup_count
        FROM gamma_resolved
        WHERE cid = '${conditionId}'
        GROUP BY cid, winning_outcome
      `,
      format: 'JSONEachRow'
    });
    const resolutions = await resolutionQuery.json();

    console.log(`\nResolution data:`);
    if (resolutions.length > 0) {
      resolutions.forEach((r: any) => {
        console.log(`  Winning outcome: ${r.winning_outcome} (${r.dup_count} rows)`);
      });

      // Calculate what P&L SHOULD be
      if (resolutions.length === 1 && fills.length > 0) {
        const winningOutcome = resolutions[0].winning_outcome;
        const isYesWinning = winningOutcome === 'Yes' || winningOutcome === 'Up' || winningOutcome === 'Over';
        const isNoWinning = winningOutcome === 'No' || winningOutcome === 'Down' || winningOutcome === 'Under';

        let totalPnl = 0;
        const totalCashflow = fills.reduce((sum: number, f: any) =>
          sum + (f.cashflow_contribution || 0), 0);

        // Calculate net shares for winning outcome
        let winningShares = 0;
        for (const fill of fills) {
          if ((isYesWinning && fill.outcome_index === 0) ||
              (isNoWinning && fill.outcome_index === 1)) {
            winningShares += fill.side === 'BUY' ? fill.shares : -fill.shares;
          }
        }

        totalPnl = totalCashflow + winningShares;

        console.log(`\nCalculated P&L for this market:`);
        console.log(`  Cashflow: $${totalCashflow.toFixed(2)}`);
        console.log(`  Winning shares (${winningOutcome}): ${winningShares.toFixed(2)}`);
        console.log(`  Total P&L: $${totalPnl.toFixed(2)}`);
      }
    } else {
      console.log(`  ❌ NO RESOLUTION DATA!`);
    }

    console.log();
  }

  // Calculate total impact of missing markets
  console.log("═".repeat(80));
  console.log("TOTAL IMPACT OF MISSING 2 MARKETS");
  console.log("═".repeat(80));
  console.log();

  let totalMissingPnl = 0;

  for (const conditionId of missingMarkets) {
    const pnlQuery = await clickhouse.query({
      query: `
        WITH fills_data AS (
          SELECT
            ctm.outcome_index,
            cf.side,
            cf.price,
            cf.size / 1000000.0 as shares,
            if(cf.side = 'BUY', -1, 1) * cf.price * cf.size / 1000000.0 as cashflow_contribution
          FROM clob_fills cf
          LEFT JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
          WHERE lower(cf.proxy_wallet) = lower('${testWallet}')
            AND lower(replaceAll(cf.condition_id, '0x', '')) = '${conditionId}'
        ),
        resolution_data AS (
          SELECT argMax(winning_outcome, fetched_at) as winning_outcome
          FROM gamma_resolved
          WHERE cid = '${conditionId}'
        )
        SELECT
          sum(fd.cashflow_contribution) as total_cashflow,
          sum(
            if(
              (rd.winning_outcome IN ('Yes', 'Up', 'Over') AND fd.outcome_index = 0) OR
              (rd.winning_outcome IN ('No', 'Down', 'Under') AND fd.outcome_index = 1),
              if(fd.side = 'BUY', fd.shares, -fd.shares),
              0
            )
          ) as winning_shares
        FROM fills_data fd
        CROSS JOIN resolution_data rd
      `,
      format: 'JSONEachRow'
    });
    const result = (await pnlQuery.json())[0];

    if (result) {
      const marketPnl = Number(result.total_cashflow) + Number(result.winning_shares);
      console.log(`Market ${conditionId.substring(0, 12)}...:`);
      console.log(`  Cashflow: $${Number(result.total_cashflow).toFixed(2)}`);
      console.log(`  Winning shares: ${Number(result.winning_shares).toFixed(2)}`);
      console.log(`  P&L: $${marketPnl.toFixed(2)}`);
      console.log();

      totalMissingPnl += marketPnl;
    }
  }

  console.log("═".repeat(80));
  console.log(`Total missing P&L from 2 markets: $${totalMissingPnl.toFixed(2)}`);
  console.log();
  console.log(`Current P&L:                       $34,990.56`);
  console.log(`+ Missing markets:                 $${totalMissingPnl.toFixed(2)}`);
  console.log(`= Corrected P&L:                   $${(34990.56 + totalMissingPnl).toFixed(2)}`);
  console.log();
  console.log(`Dome target:                       $87,030.51`);
  console.log(`Remaining gap:                     $${(87030.51 - (34990.56 + totalMissingPnl)).toFixed(2)}`);
  console.log();

  if (Math.abs(34990.56 + totalMissingPnl - 87030.51) < 5000) {
    console.log("✅ BREAKTHROUGH! The 2 missing markets explain the gap!");
  }

  console.log("═".repeat(80));
}

main().catch(console.error);
