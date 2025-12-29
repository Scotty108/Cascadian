import { getClickHouseClient } from '../../lib/clickhouse/client';

const ch = getClickHouseClient();
const theo4 = '0x56687bf447db6ffa42ffe2204a05edaa20f55839';

async function checkShortPositionsAndErc1155() {
  console.log('=== INVESTIGATING SHORT POSITIONS & ERC1155 DATA ===\n');

  // 1. Check what's in the ERC1155 transfers for Theo4
  console.log('=== ERC1155 SAMPLE DATA ===');
  const sample = await ch.query({
    query: `
      SELECT *
      FROM pm_erc1155_transfers
      WHERE lower(from_address) = lower('${theo4}')
         OR lower(to_address) = lower('${theo4}')
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const sampleData = await sample.json() as any[];
  console.log(`Sample transfers: ${sampleData.length}`);
  sampleData.forEach((s: any) => console.log(JSON.stringify(s, null, 2)));

  // 2. SHORT POSITIONS - These are key!
  console.log('\n=== SHORT POSITIONS (More sold than bought) ===');
  const shorts = await ch.query({
    query: `
      WITH trades AS (
        SELECT
          token_id,
          sum(if(side = 'buy', token_amount, -token_amount)) / 1e6 as net_shares,
          sum(if(side = 'buy', usdc_amount, -usdc_amount)) / 1e6 as net_cost,
          count() as trade_count
        FROM (
          SELECT event_id, any(token_id) as token_id,
                 any(side) as side, any(token_amount) as token_amount, any(usdc_amount) as usdc_amount
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = lower('${theo4}') AND is_deleted = 0
          GROUP BY event_id
        )
        GROUP BY token_id
      )
      SELECT
        token_id,
        net_shares,
        net_cost,
        trade_count
      FROM trades
      WHERE net_shares < -1000  -- Sold more than bought
      ORDER BY net_cost ASC
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const shortsData = await shorts.json() as any[];
  console.log('Top 10 short positions:');
  shortsData.forEach((s: any) => {
    console.log(`  Token ${s.token_id?.substring(0,30)}... : ${Number(s.net_shares).toLocaleString()} shares, $${Number(s.net_cost).toLocaleString()} (${s.trade_count} trades)`);
  });

  // 3. Check if these shorts are RESOLVED markets
  console.log('\n=== CHECKING IF SHORTS ARE RESOLVED ===');
  if (shortsData.length > 0) {
    const tokenId = shortsData[0].token_id;
    console.log(`Checking token: ${tokenId}`);

    // Check mapping table
    const mapping = await ch.query({
      query: `
        SELECT *
        FROM pm_token_to_condition_map_v3
        WHERE toString(token_id) = '${tokenId}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });
    const mapData = await mapping.json() as any[];
    console.log('Mapping data:');
    mapData.forEach((m: any) => console.log(JSON.stringify(m, null, 2)));
  }

  // 4. CRITICAL: Check if UI considers "cost basis" differently
  console.log('\n=== ALTERNATIVE PNL CALCULATION ===');
  const simpleFlow = await ch.query({
    query: `
      SELECT
        count() as events,
        sum(usdc_amount) / 1e6 as total_usdc_flow,
        sum(if(side = 'buy', usdc_amount, 0)) / 1e6 as buy_usdc,
        sum(if(side = 'sell', usdc_amount, 0)) / 1e6 as sell_usdc
      FROM (
        SELECT event_id, any(side) as side, any(usdc_amount) as usdc_amount
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${theo4}') AND is_deleted = 0
        GROUP BY event_id
      )
    `,
    format: 'JSONEachRow'
  });
  const flowData = await simpleFlow.json() as any[];
  console.log(`Total events: ${flowData[0].events}`);
  console.log(`Total USDC flow: $${Number(flowData[0].total_usdc_flow).toLocaleString()}`);
  console.log(`Buy USDC: $${Number(flowData[0].buy_usdc).toLocaleString()}`);
  console.log(`Sell USDC: $${Number(flowData[0].sell_usdc).toLocaleString()}`);
  console.log(`Net (sells - buys): $${(Number(flowData[0].sell_usdc) - Number(flowData[0].buy_usdc)).toLocaleString()}`);

  // 5. Check Polymarket API for this wallet's actual PnL
  console.log('\n=== CHECKING DATA FRESHNESS ===');
  const freshness = await ch.query({
    query: `
      SELECT
        min(trade_time) as first_trade,
        max(trade_time) as last_trade,
        count() as total_trades
      FROM (
        SELECT event_id, any(trade_time) as trade_time
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${theo4}') AND is_deleted = 0
        GROUP BY event_id
      )
    `,
    format: 'JSONEachRow'
  });
  const freshData = await freshness.json() as any[];
  console.log(`First trade: ${freshData[0].first_trade}`);
  console.log(`Last trade: ${freshData[0].last_trade}`);
  console.log(`Total trades: ${freshData[0].total_trades}`);

  // 6. Check vw_resolution_prices for these positions
  console.log('\n=== CHECKING RESOLUTION PRICES FOR OPEN POSITIONS ===');
  const resolutions = await ch.query({
    query: `
      WITH open_positions AS (
        SELECT
          token_id,
          sum(if(side = 'buy', token_amount, -token_amount)) / 1e6 as net_shares,
          sum(if(side = 'buy', usdc_amount, -usdc_amount)) / 1e6 as net_cost
        FROM (
          SELECT event_id, any(token_id) as token_id,
                 any(side) as side, any(token_amount) as token_amount, any(usdc_amount) as usdc_amount
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = lower('${theo4}') AND is_deleted = 0
          GROUP BY event_id
        )
        GROUP BY token_id
        HAVING net_shares > 1000
      )
      SELECT
        op.token_id,
        op.net_shares,
        op.net_cost,
        r.resolution_price,
        r.outcome_index,
        op.net_shares * coalesce(r.resolution_price, 0) as resolved_value,
        op.net_shares * coalesce(r.resolution_price, 0) - op.net_cost as pnl_if_resolved
      FROM open_positions op
      LEFT JOIN (
        SELECT DISTINCT
          toString(token_id) as token_id,
          outcome_index,
          resolution_price
        FROM vw_resolution_prices
      ) r ON op.token_id = r.token_id
      ORDER BY op.net_cost DESC
      LIMIT 15
    `,
    format: 'JSONEachRow'
  });
  const resData = await resolutions.json() as any[];
  console.log('Open positions with resolution status:');
  resData.forEach((r: any) => {
    const status = r.resolution_price !== null ? `RESOLVED @ ${r.resolution_price}` : 'OPEN';
    console.log(`  ${r.token_id?.substring(0,20)}... : ${Number(r.net_shares).toLocaleString()} shares, cost $${Number(r.net_cost).toLocaleString()}, ${status}`);
    if (r.resolution_price !== null) {
      console.log(`    -> Payout: $${Number(r.resolved_value).toLocaleString()}, PnL: $${Number(r.pnl_if_resolved).toLocaleString()}`);
    }
  });

  // 7. SUM UP: What's the total PnL if all positions were resolved at current prices?
  console.log('\n=== THEORETICAL PNL IF POSITIONS RESOLVED NOW ===');
  const theoreticalPnl = await ch.query({
    query: `
      WITH positions AS (
        SELECT
          token_id,
          sum(if(side = 'buy', token_amount, -token_amount)) / 1e6 as net_shares,
          sum(if(side = 'buy', usdc_amount, -usdc_amount)) / 1e6 as net_cost
        FROM (
          SELECT event_id, any(token_id) as token_id,
                 any(side) as side, any(token_amount) as token_amount, any(usdc_amount) as usdc_amount
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = lower('${theo4}') AND is_deleted = 0
          GROUP BY event_id
        )
        GROUP BY token_id
      )
      SELECT
        count() as total_positions,
        sum(net_cost) as total_cost,
        sum(if(net_shares > 0, net_shares, 0)) as long_shares,
        sum(if(net_shares < 0, net_shares, 0)) as short_shares,
        sum(if(net_shares > 0, net_cost, 0)) as long_cost,
        sum(if(net_shares < 0, net_cost, 0)) as short_cost
      FROM positions
    `,
    format: 'JSONEachRow'
  });
  const theoPnlData = await theoreticalPnl.json() as any[];
  console.log(`Total positions: ${theoPnlData[0].total_positions}`);
  console.log(`Total net cost: $${Number(theoPnlData[0].total_cost).toLocaleString()}`);
  console.log(`Long shares: ${Number(theoPnlData[0].long_shares).toLocaleString()}, cost: $${Number(theoPnlData[0].long_cost).toLocaleString()}`);
  console.log(`Short shares: ${Number(theoPnlData[0].short_shares).toLocaleString()}, cost: $${Number(theoPnlData[0].short_cost).toLocaleString()}`);

  // Calculate: If all longs resolve to 1 and all shorts resolve to 0, what's max PnL?
  const maxLongPnl = Number(theoPnlData[0].long_shares) - Number(theoPnlData[0].long_cost);
  const maxShortPnl = Math.abs(Number(theoPnlData[0].short_cost)); // Shorts at 0 = keep the premium
  console.log(`\nIf all LONGS win (resolve @ $1): PnL = $${maxLongPnl.toLocaleString()}`);
  console.log(`If all SHORTS win (resolve @ $0): PnL = $${maxShortPnl.toLocaleString()}`);
  console.log(`Best case scenario (all positions win): $${(maxLongPnl + maxShortPnl).toLocaleString()}`);
}

checkShortPositionsAndErc1155().catch(console.error);
