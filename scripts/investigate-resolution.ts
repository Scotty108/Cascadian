import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

const SPORTS_BETTOR = '0xf29bb8e0712075041e87e8605b69833ef738dd4c';

async function main() {
  // 1. Get vw_pm_ledger schema first
  console.log('=== vw_pm_ledger VIEW DEFINITION ===');
  const ledgerDefResult = await clickhouse.query({
    query: "SHOW CREATE TABLE vw_pm_ledger",
    format: 'JSONEachRow'
  });
  const ledgerDef = await ledgerDefResult.json() as any[];
  console.log(ledgerDef[0]?.statement || 'No definition found');

  // 2. Check what columns are in pm_wallet_market_pnl_v4 (seems to be a key table)
  console.log('\n=== pm_wallet_market_pnl_v4 SCHEMA ===');
  const pnlSchemaResult = await clickhouse.query({
    query: 'DESCRIBE TABLE pm_wallet_market_pnl_v4',
    format: 'JSONEachRow'
  });
  const pnlSchema = await pnlSchemaResult.json() as any[];
  for (const col of pnlSchema) {
    console.log(`  ${col.name}: ${col.type}`);
  }

  // 3. Get Sports Bettor's resolved positions with payouts
  console.log('\n=== SPORTS BETTOR RESOLVED POSITIONS (from vw_pm_resolution_payouts) ===');
  const resolvedResult = await clickhouse.query({
    query: `
      SELECT *
      FROM vw_pm_resolution_payouts
      WHERE wallet_address = '${SPORTS_BETTOR}'
      ORDER BY resolution_payout_usdc DESC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const resolved = await resolvedResult.json() as any[];
  console.log(`Found ${resolved.length} resolved positions for Sports Bettor`);
  for (const row of resolved) {
    console.log(JSON.stringify(row, null, 2));
  }

  // 4. Join with winning_outcome to see which positions won/lost
  console.log('\n=== SPORTS BETTOR POSITIONS WITH WIN/LOSS STATUS ===');
  const winLossResult = await clickhouse.query({
    query: `
      WITH positions AS (
        SELECT
          wallet_address,
          condition_id,
          outcome_index,
          sum(shares_delta) as net_shares,
          sum(cash_delta_usdc) as net_usdc
        FROM vw_pm_ledger
        WHERE wallet_address = '${SPORTS_BETTOR}'
          AND condition_id IS NOT NULL
          AND condition_id != ''
        GROUP BY wallet_address, condition_id, outcome_index
        HAVING net_shares != 0
      )
      SELECT
        p.condition_id,
        p.outcome_index as held_outcome,
        p.net_shares,
        p.net_usdc,
        w.winning_outcome_index,
        CASE
          WHEN w.winning_outcome_index IS NULL THEN 'unresolved'
          WHEN p.outcome_index = w.winning_outcome_index THEN 'won'
          ELSE 'lost'
        END as position_result
      FROM positions p
      LEFT JOIN vw_condition_winners w ON p.condition_id = w.condition_id
      ORDER BY position_result, abs(p.net_usdc) DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const winLoss = await winLossResult.json() as any[];
  console.log(`Found ${winLoss.length} positions with status`);
  for (const row of winLoss) {
    console.log(JSON.stringify(row, null, 2));
  }

  // 5. Calculate PnL for resolved positions
  console.log('\n=== SPORTS BETTOR PNL CALCULATION FOR RESOLVED POSITIONS ===');
  const pnlCalcResult = await clickhouse.query({
    query: `
      WITH positions AS (
        SELECT
          wallet_address,
          condition_id,
          outcome_index,
          sum(shares_delta) as net_shares,
          sum(cash_delta_usdc) as cost_basis  -- negative = spent money
        FROM vw_pm_ledger
        WHERE wallet_address = '${SPORTS_BETTOR}'
          AND condition_id IS NOT NULL
          AND condition_id != ''
        GROUP BY wallet_address, condition_id, outcome_index
      ),
      resolution AS (
        SELECT
          condition_id,
          payout_numerators
        FROM pm_condition_resolutions
        WHERE is_deleted = 0
      )
      SELECT
        p.condition_id,
        p.outcome_index,
        p.net_shares,
        p.cost_basis,
        -- Payout is shares * payout_ratio (1 if won, 0 if lost)
        greatest(0, p.net_shares) * if(JSONExtractInt(r.payout_numerators, p.outcome_index + 1) > 0, 1, 0) as payout,
        -- PnL = payout + cost_basis (cost_basis is negative)
        greatest(0, p.net_shares) * if(JSONExtractInt(r.payout_numerators, p.outcome_index + 1) > 0, 1, 0) + p.cost_basis as realized_pnl,
        CASE
          WHEN r.condition_id IS NULL THEN 'unresolved'
          WHEN JSONExtractInt(r.payout_numerators, p.outcome_index + 1) > 0 THEN 'won'
          ELSE 'lost'
        END as status
      FROM positions p
      LEFT JOIN resolution r ON p.condition_id = r.condition_id
      WHERE r.condition_id IS NOT NULL  -- only resolved
      ORDER BY realized_pnl ASC  -- biggest losses first
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const pnlCalc = await pnlCalcResult.json() as any[];
  console.log(`Found ${pnlCalc.length} resolved positions with PnL`);
  for (const row of pnlCalc) {
    console.log(JSON.stringify(row, null, 2));
  }

  // 6. Summary stats for Sports Bettor
  console.log('\n=== SPORTS BETTOR SUMMARY STATS ===');
  const summaryResult = await clickhouse.query({
    query: `
      WITH positions AS (
        SELECT
          wallet_address,
          condition_id,
          outcome_index,
          sum(shares_delta) as net_shares,
          sum(cash_delta_usdc) as cost_basis
        FROM vw_pm_ledger
        WHERE wallet_address = '${SPORTS_BETTOR}'
          AND condition_id IS NOT NULL
          AND condition_id != ''
        GROUP BY wallet_address, condition_id, outcome_index
      ),
      resolution AS (
        SELECT
          condition_id,
          payout_numerators
        FROM pm_condition_resolutions
        WHERE is_deleted = 0
      ),
      pnl_calc AS (
        SELECT
          p.condition_id,
          p.outcome_index,
          p.net_shares,
          p.cost_basis,
          greatest(0, p.net_shares) * if(JSONExtractInt(r.payout_numerators, p.outcome_index + 1) > 0, 1, 0) as payout,
          greatest(0, p.net_shares) * if(JSONExtractInt(r.payout_numerators, p.outcome_index + 1) > 0, 1, 0) + p.cost_basis as realized_pnl,
          CASE
            WHEN r.condition_id IS NULL THEN 'unresolved'
            WHEN JSONExtractInt(r.payout_numerators, p.outcome_index + 1) > 0 THEN 'won'
            ELSE 'lost'
          END as status
        FROM positions p
        LEFT JOIN resolution r ON p.condition_id = r.condition_id
      )
      SELECT
        status,
        count() as position_count,
        sum(cost_basis) as total_cost,
        sum(payout) as total_payout,
        sum(realized_pnl) as total_pnl
      FROM pnl_calc
      GROUP BY status
      ORDER BY status
    `,
    format: 'JSONEachRow'
  });
  const summary = await summaryResult.json() as any[];
  for (const row of summary) {
    console.log(JSON.stringify(row, null, 2));
  }

  // 7. Check pm_wallet_market_pnl_v4 for pre-calculated data
  console.log('\n=== pm_wallet_market_pnl_v4 FOR SPORTS BETTOR ===');
  const v4Result = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        outcome_index,
        question,
        category,
        net_shares,
        total_bought_usdc,
        total_sold_usdc,
        remaining_cost_basis,
        is_resolved,
        outcome_won,
        resolution_payout,
        trading_pnl,
        resolution_pnl,
        total_pnl
      FROM pm_wallet_market_pnl_v4
      WHERE wallet = '${SPORTS_BETTOR}'
      ORDER BY abs(total_pnl) DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const v4Data = await v4Result.json() as any[];
  console.log(`Found ${v4Data.length} positions in pm_wallet_market_pnl_v4`);
  for (const row of v4Data) {
    console.log(JSON.stringify(row, null, 2));
  }

  // 8. Summary from pm_wallet_market_pnl_v4
  console.log('\n=== pm_wallet_market_pnl_v4 SUMMARY ===');
  const v4SummaryResult = await clickhouse.query({
    query: `
      SELECT
        if(is_resolved = 1, if(outcome_won = 1, 'won', 'lost'), 'unresolved') as status,
        count() as position_count,
        sum(remaining_cost_basis) as total_cost_basis,
        sum(resolution_payout) as total_payout,
        sum(trading_pnl) as total_trading_pnl,
        sum(resolution_pnl) as total_resolution_pnl,
        sum(total_pnl) as total_pnl
      FROM pm_wallet_market_pnl_v4
      WHERE wallet = '${SPORTS_BETTOR}'
      GROUP BY status
      ORDER BY status
    `,
    format: 'JSONEachRow'
  });
  const v4Summary = await v4SummaryResult.json() as any[];
  for (const row of v4Summary) {
    console.log(JSON.stringify(row, null, 2));
  }

  // 9. Compare one specific position between methods
  console.log('\n=== COMPARING ONE CONDITION ACROSS SOURCES ===');
  const testCondition = '6216d86e522f11aae3f30faddd06427cd07389acc38de9dff1c0d4dd669d93a4';

  console.log('\n--- From vw_pm_ledger (raw trades) ---');
  const rawResult = await clickhouse.query({
    query: `
      SELECT
        outcome_index,
        sum(shares_delta) as net_shares,
        sum(cash_delta_usdc) as net_cash,
        sum(fee_usdc) as total_fees,
        count() as trade_count
      FROM vw_pm_ledger
      WHERE wallet_address = '${SPORTS_BETTOR}'
        AND condition_id = '${testCondition}'
      GROUP BY outcome_index
    `,
    format: 'JSONEachRow'
  });
  const rawData = await rawResult.json() as any[];
  for (const row of rawData) {
    console.log(JSON.stringify(row, null, 2));
  }

  console.log('\n--- From pm_condition_resolutions ---');
  const resResult = await clickhouse.query({
    query: `
      SELECT *
      FROM pm_condition_resolutions
      WHERE condition_id = '${testCondition}'
        AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const resData = await resResult.json() as any[];
  for (const row of resData) {
    console.log(JSON.stringify(row, null, 2));
  }

  console.log('\n--- From pm_wallet_market_pnl_v4 ---');
  const v4SpecificResult = await clickhouse.query({
    query: `
      SELECT *
      FROM pm_wallet_market_pnl_v4
      WHERE wallet = '${SPORTS_BETTOR}'
        AND condition_id = '${testCondition}'
    `,
    format: 'JSONEachRow'
  });
  const v4Specific = await v4SpecificResult.json() as any[];
  for (const row of v4Specific) {
    console.log(JSON.stringify(row, null, 2));
  }

  await clickhouse.close();
}

main().catch(console.error);
