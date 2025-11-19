import { getClickHouseClient } from './lib/clickhouse/client';

const client = getClickHouseClient();

async function main() {
  try {
    const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

    // Task 1: P&L Component Breakdown
    console.log('\n=== TASK 1: P&L COMPONENT BREAKDOWN ===\n');
    
    const componentQuery = `
      SELECT
        sumIf(realized_pnl_usd, realized_pnl_usd > 0) AS pnl_positive,
        sumIf(realized_pnl_usd, realized_pnl_usd < 0) AS pnl_negative,
        sum(realized_pnl_usd) AS pnl_total,
        sum(covered_volume_usd) AS volume_total,
        count(*) AS position_count,
        countIf(realized_pnl_usd > 0) AS winning_positions,
        countIf(realized_pnl_usd < 0) AS losing_positions
      FROM pm_wallet_market_pnl_v2
      WHERE wallet_address = '${wallet}'
    `;
    
    const componentResult = await client.query({
      query: componentQuery,
      format: 'JSONEachRow',
    });
    
    const componentData = await componentResult.json<any[]>();
    console.log('Component Breakdown:');
    console.log(JSON.stringify(componentData, null, 2));

    // Task 3: Sign Convention - check resolved positions
    console.log('\n=== TASK 3: SETTLEMENT GAP ANALYSIS ===\n');
    
    const settlementQuery = `
      SELECT
        count(*) AS resolved_open_positions,
        sum(final_position_size) AS total_unsold_shares,
        sum(abs(realized_pnl_usd)) AS current_negative_pnl,
        sum(realized_pnl_usd) AS actual_realized_pnl
      FROM pm_wallet_market_pnl_v2
      WHERE 
        wallet_address = '${wallet}'
        AND is_resolved = 1
        AND final_position_size > 0
    `;
    
    const settlementResult = await client.query({
      query: settlementQuery,
      format: 'JSONEachRow',
    });
    
    const settlementData = await settlementResult.json<any[]>();
    console.log('Resolved Open Positions (with unsold shares):');
    console.log(JSON.stringify(settlementData, null, 2));

    // Task 4: Get sample positions for concrete examples
    console.log('\n=== SAMPLE POSITIONS FOR CONCRETE EXAMPLES ===\n');
    
    const sampleQuery = `
      SELECT
        market_id,
        condition_id,
        final_position_size,
        avg_entry_price,
        total_cost_usd,
        total_proceeds_usd,
        realized_pnl_usd,
        is_resolved,
        winning_outcome_index
      FROM pm_wallet_market_pnl_v2
      WHERE wallet_address = '${wallet}'
      ORDER BY abs(realized_pnl_usd) DESC
      LIMIT 5
    `;
    
    const sampleResult = await client.query({
      query: sampleQuery,
      format: 'JSONEachRow',
    });
    
    const sampleData = await sampleResult.json<any[]>();
    console.log('Top 5 positions by absolute P&L:');
    console.log(JSON.stringify(sampleData, null, 2));

    // Task 5: Analyze position breakdown by status
    console.log('\n=== POSITION BREAKDOWN BY STATUS ===\n');
    
    const statusQuery = `
      SELECT
        is_resolved,
        final_position_size > 0 AS has_unsold_shares,
        count(*) AS position_count,
        sum(realized_pnl_usd) AS total_pnl,
        avg(realized_pnl_usd) AS avg_pnl
      FROM pm_wallet_market_pnl_v2
      WHERE wallet_address = '${wallet}'
      GROUP BY is_resolved, has_unsold_shares
      ORDER BY is_resolved, has_unsold_shares
    `;
    
    const statusResult = await client.query({
      query: statusQuery,
      format: 'JSONEachRow',
    });
    
    const statusData = await statusResult.json<any[]>();
    console.log('Position Breakdown by Status:');
    console.log(JSON.stringify(statusData, null, 2));

    // Additional: Check if any settlement_pnl exists
    console.log('\n=== SETTLEMENT P&L CHECK ===\n');
    
    const settlementCheckQuery = `
      SELECT
        sum(settlement_pnl_usd) AS total_settlement_pnl,
        countIf(settlement_pnl_usd != 0) AS positions_with_settlement,
        max(settlement_pnl_usd) AS max_settlement,
        min(settlement_pnl_usd) AS min_settlement
      FROM pm_wallet_market_pnl_v2
      WHERE wallet_address = '${wallet}'
    `;
    
    const settlementCheckResult = await client.query({
      query: settlementCheckQuery,
      format: 'JSONEachRow',
    });
    
    const settlementCheckData = await settlementCheckResult.json<any[]>();
    console.log('Settlement P&L Status:');
    console.log(JSON.stringify(settlementCheckData, null, 2));

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
