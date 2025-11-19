import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';

async function main() {
  console.log('═'.repeat(80));
  console.log('LABEL-BASED VS BINARY P&L CALCULATION TEST');
  console.log('═'.repeat(80));
  console.log();

  const testWallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  // Step 1: Check label coverage
  console.log('Step 1: Label Coverage Analysis');
  console.log('─'.repeat(80));

  const coverageQuery = await clickhouse.query({
    query: `
      WITH test_markets AS (
        SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid_norm
        FROM clob_fills
        WHERE lower(proxy_wallet) = lower('${testWallet}')
      )
      SELECT
        count(*) as total_markets,
        countIf(moe.condition_id_norm IS NOT NULL) as has_labels
      FROM test_markets tm
      LEFT JOIN (
        SELECT DISTINCT condition_id_norm FROM market_outcomes_expanded
      ) moe ON tm.cid_norm = moe.condition_id_norm
    `,
    format: 'JSONEachRow'
  });
  const coverage = (await coverageQuery.json())[0];

  console.log(`Total markets: ${coverage.total_markets}`);
  console.log(`Markets with labels: ${coverage.has_labels}`);
  console.log(`Missing labels: ${Number(coverage.total_markets) - Number(coverage.has_labels)}`);
  console.log();

  // Step 2: Calculate P&L both ways
  console.log('Step 2: Calculating P&L (Label-Based vs Binary)');
  console.log('─'.repeat(80));

  const pnlQuery = await clickhouse.query({
    query: `
      WITH clob_agg AS (
        SELECT
          lower(cf.proxy_wallet) AS wallet,
          lower(replaceAll(cf.condition_id, '0x', '')) AS cid_norm,
          ctm.outcome_index AS outcome_idx,
          sum((if(cf.side = 'BUY', -1, 1) * cf.price * cf.size) / 1000000.0) AS cashflow,
          sum((if(cf.side = 'BUY', 1, -1) * cf.size) / 1000000.0) AS net_shares
        FROM clob_fills cf
        INNER JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
        WHERE lower(cf.proxy_wallet) = lower('${testWallet}')
        GROUP BY wallet, cid_norm, outcome_idx
      ),
      gamma_deduped AS (
        SELECT cid, argMax(winning_outcome, fetched_at) AS winning_outcome
        FROM gamma_resolved
        GROUP BY cid
      )
      SELECT
        ca.cid_norm,
        ca.outcome_idx,
        moe.outcome_label,
        gd.winning_outcome,
        ca.net_shares,
        ca.cashflow,
        -- Label-based matching (GPT approach)
        if(moe.outcome_label IS NOT NULL AND lower(trim(moe.outcome_label)) = lower(trim(gd.winning_outcome)), 1, 0) AS is_winning_label,
        -- Binary matching (current approach)
        if((gd.winning_outcome IN ('Yes', 'Up', 'Over') AND ca.outcome_idx = 0) OR
           (gd.winning_outcome IN ('No', 'Down', 'Under') AND ca.outcome_idx = 1), 1, 0) AS is_winning_binary,
        -- Label-based P&L
        ca.cashflow + if(moe.outcome_label IS NOT NULL AND lower(trim(moe.outcome_label)) = lower(trim(gd.winning_outcome)), ca.net_shares, 0) AS pnl_label,
        -- Binary P&L (current)
        ca.cashflow + if((gd.winning_outcome IN ('Yes', 'Up', 'Over') AND ca.outcome_idx = 0) OR
           (gd.winning_outcome IN ('No', 'Down', 'Under') AND ca.outcome_idx = 1), ca.net_shares, 0) AS pnl_binary
      FROM clob_agg ca
      INNER JOIN gamma_deduped gd ON ca.cid_norm = gd.cid
      LEFT JOIN market_outcomes_expanded moe
        ON ca.cid_norm = moe.condition_id_norm
        AND ca.outcome_idx = moe.outcome_idx
      ORDER BY abs(pnl_label - pnl_binary) DESC
    `,
    format: 'JSONEachRow'
  });
  const pnl = await pnlQuery.json();

  console.log('Positions with largest discrepancies:');
  console.table(pnl.slice(0, 15).map((r: any) => ({
    cid: r.cid_norm.substring(0, 12) + '...',
    idx: r.outcome_idx,
    label: r.outcome_label || '(null)',
    winner: r.winning_outcome,
    shares: Number(r.net_shares).toFixed(2),
    label_win: r.is_winning_label,
    binary_win: r.is_winning_binary,
    pnl_label: `$${Number(r.pnl_label).toFixed(2)}`,
    pnl_binary: `$${Number(r.pnl_binary).toFixed(2)}`,
    diff: `$${(Number(r.pnl_label) - Number(r.pnl_binary)).toFixed(2)}`
  })));

  // Step 3: Calculate totals
  console.log();
  console.log('Step 3: Total P&L Comparison');
  console.log('─'.repeat(80));

  const totalQuery = await clickhouse.query({
    query: `
      WITH clob_agg AS (
        SELECT
          lower(cf.proxy_wallet) AS wallet,
          lower(replaceAll(cf.condition_id, '0x', '')) AS cid_norm,
          ctm.outcome_index AS outcome_idx,
          sum((if(cf.side = 'BUY', -1, 1) * cf.price * cf.size) / 1000000.0) AS cashflow,
          sum((if(cf.side = 'BUY', 1, -1) * cf.size) / 1000000.0) AS net_shares
        FROM clob_fills cf
        INNER JOIN ctf_token_map ctm ON cf.asset_id = ctm.token_id
        WHERE lower(cf.proxy_wallet) = lower('${testWallet}')
        GROUP BY wallet, cid_norm, outcome_idx
      ),
      gamma_deduped AS (
        SELECT cid, argMax(winning_outcome, fetched_at) AS winning_outcome
        FROM gamma_resolved
        GROUP BY cid
      )
      SELECT
        sum(ca.cashflow + if(moe.outcome_label IS NOT NULL AND lower(trim(moe.outcome_label)) = lower(trim(gd.winning_outcome)), ca.net_shares, 0)) AS total_pnl_label,
        sum(ca.cashflow + if((gd.winning_outcome IN ('Yes', 'Up', 'Over') AND ca.outcome_idx = 0) OR
           (gd.winning_outcome IN ('No', 'Down', 'Under') AND ca.outcome_idx = 1), ca.net_shares, 0)) AS total_pnl_binary,
        count(*) as total_positions,
        countIf(moe.outcome_label IS NULL) as positions_without_labels
      FROM clob_agg ca
      INNER JOIN gamma_deduped gd ON ca.cid_norm = gd.cid
      LEFT JOIN market_outcomes_expanded moe
        ON ca.cid_norm = moe.condition_id_norm
        AND ca.outcome_idx = moe.outcome_idx
    `,
    format: 'JSONEachRow'
  });
  const totals = (await totalQuery.json())[0];

  console.log('═'.repeat(80));
  console.log('FINAL RESULTS');
  console.log('═'.repeat(80));
  console.log(`Label-Based P&L (GPT):    $${Number(totals.total_pnl_label).toFixed(2)}`);
  console.log(`Binary P&L (Current):      $${Number(totals.total_pnl_binary).toFixed(2)}`);
  console.log(`Difference:                $${(Number(totals.total_pnl_label) - Number(totals.total_pnl_binary)).toFixed(2)}`);
  console.log();
  console.log(`Total positions: ${totals.total_positions}`);
  console.log(`Positions without labels: ${totals.positions_without_labels}`);
  console.log('═'.repeat(80));
  console.log();

  const diff = Math.abs(Number(totals.total_pnl_label) - Number(totals.total_pnl_binary));

  if (diff < 1) {
    console.log('✅ Label-based and binary produce same results');
    console.log('   → Binary mapping assumption is correct for this wallet');
  } else {
    console.log('🚨 DISCREPANCY FOUND!');
    console.log(`   → Difference: $${diff.toFixed(2)}`);
    console.log('   → Label-based matching gives different P&L');
    console.log('   → This could be part of the explanation!');
  }
}

main().catch(console.error);
