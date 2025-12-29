/**
 * Export complete trade data and P&L calculation for spreadsheet validation
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

const WALLET = '0x925ad88d18dbc7bfeff3b71db7b96ed4bb572c2e';

async function main() {
  console.log('=== EXPORTING VALIDATION DATA ===\n');

  // 1. Get ALL trades (deduped)
  const tradesQ = `
    SELECT * FROM (
      SELECT
        event_id,
        any(side) as side,
        any(token_id) as token_id,
        any(usdc_amount) / 1e6 as usdc,
        any(token_amount) / 1e6 as tokens,
        min(trade_time) as trade_time,
        lower(concat('0x', hex(any(transaction_hash)))) as tx_hash
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
      GROUP BY event_id
    ) ORDER BY trade_time
  `;
  const tradesR = await clickhouse.query({ query: tradesQ, format: 'JSONEachRow' });
  const trades = await tradesR.json() as any[];

  // 2. Get token → condition mapping
  const tokenMappingQ = `
    SELECT token_id_dec, condition_id, outcome_index
    FROM pm_token_to_condition_patch
    WHERE source = 'greedy_calibration'
  `;
  const tokenMappingR = await clickhouse.query({ query: tokenMappingQ, format: 'JSONEachRow' });
  const tokenMappings = await tokenMappingR.json() as any[];

  const tokenToCondition = new Map<string, {condition_id: string, outcome_index: number}>();
  for (const m of tokenMappings) {
    tokenToCondition.set(m.token_id_dec, { condition_id: m.condition_id, outcome_index: m.outcome_index });
  }

  // 3. Get resolution prices
  const resQ = `
    SELECT condition_id, outcome_index, resolved_price
    FROM vw_pm_resolution_prices
  `;
  const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resolutions = await resR.json() as any[];

  const resolutionMap = new Map<string, number>();
  for (const r of resolutions) {
    resolutionMap.set(`${r.condition_id}_${r.outcome_index}`, parseFloat(r.resolved_price));
  }

  // 4. Get redemptions
  const redemptionQ = `
    SELECT
      condition_id,
      sum(toFloat64OrZero(amount_or_payout)) / 1e6 as usdc,
      min(event_timestamp) as redemption_time
    FROM pm_ctf_events
    WHERE lower(user_address) = '${WALLET}'
      AND event_type = 'PayoutRedemption'
      AND is_deleted = 0
    GROUP BY condition_id
  `;
  const redemptionR = await clickhouse.query({ query: redemptionQ, format: 'JSONEachRow' });
  const redemptions = await redemptionR.json() as any[];

  // 5. Get split costs
  const splitQ = `
    SELECT
      condition_id,
      sum(toFloat64OrZero(amount_or_payout)) / 1e6 as usdc,
      min(event_timestamp) as split_time
    FROM pm_ctf_events
    WHERE tx_hash IN (
      SELECT DISTINCT lower(concat('0x', hex(transaction_hash)))
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${WALLET}' AND is_deleted = 0
    )
    AND event_type = 'PositionSplit'
    AND is_deleted = 0
    GROUP BY condition_id
  `;
  const splitR = await clickhouse.query({ query: splitQ, format: 'JSONEachRow' });
  const splits = await splitR.json() as any[];

  // === BUILD CSV FILES ===

  // CSV 1: All Trades
  let tradesCsv = 'event_id,trade_time,side,token_id,usdc,tokens,condition_id,outcome_index,resolution_price\n';
  for (const t of trades) {
    const mapping = tokenToCondition.get(t.token_id);
    const conditionId = mapping?.condition_id || '';
    const outcomeIndex = mapping?.outcome_index ?? '';
    const resPrice = mapping ? (resolutionMap.get(`${mapping.condition_id}_${mapping.outcome_index}`) ?? '') : '';
    tradesCsv += `${t.event_id},${t.trade_time},${t.side},${t.token_id},${parseFloat(t.usdc).toFixed(6)},${parseFloat(t.tokens).toFixed(6)},${conditionId},${outcomeIndex},${resPrice}\n`;
  }
  fs.writeFileSync('exports/validation_trades.csv', tradesCsv);
  console.log(`Exported ${trades.length} trades to exports/validation_trades.csv`);

  // CSV 2: Token Positions
  const positionMap = new Map<string, {bought: number, sold: number}>();
  for (const t of trades) {
    if (!positionMap.has(t.token_id)) {
      positionMap.set(t.token_id, { bought: 0, sold: 0 });
    }
    const pos = positionMap.get(t.token_id)!;
    if (t.side === 'buy') {
      pos.bought += parseFloat(t.tokens);
    } else {
      pos.sold += parseFloat(t.tokens);
    }
  }

  let positionsCsv = 'token_id,tokens_bought,tokens_sold,net_position,condition_id,outcome_index,resolution_price,position_value\n';
  for (const [tokenId, pos] of positionMap.entries()) {
    const net = pos.bought - pos.sold;
    const mapping = tokenToCondition.get(tokenId);
    const conditionId = mapping?.condition_id || '';
    const outcomeIndex = mapping?.outcome_index ?? '';
    const resPrice = mapping ? (resolutionMap.get(`${mapping.condition_id}_${mapping.outcome_index}`) ?? 0) : 0;
    const value = net > 0 ? net * resPrice : 0;
    positionsCsv += `${tokenId},${pos.bought.toFixed(6)},${pos.sold.toFixed(6)},${net.toFixed(6)},${conditionId},${outcomeIndex},${resPrice},${value.toFixed(6)}\n`;
  }
  fs.writeFileSync('exports/validation_positions.csv', positionsCsv);
  console.log(`Exported ${positionMap.size} token positions to exports/validation_positions.csv`);

  // CSV 3: Splits
  let splitsCsv = 'condition_id,split_cost_usdc\n';
  for (const s of splits) {
    splitsCsv += `${s.condition_id},${parseFloat(s.usdc).toFixed(6)}\n`;
  }
  fs.writeFileSync('exports/validation_splits.csv', splitsCsv);
  console.log(`Exported ${splits.length} splits to exports/validation_splits.csv`);

  // CSV 4: Redemptions
  let redemptionsCsv = 'condition_id,redemption_usdc\n';
  for (const r of redemptions) {
    redemptionsCsv += `${r.condition_id},${parseFloat(r.usdc).toFixed(6)}\n`;
  }
  fs.writeFileSync('exports/validation_redemptions.csv', redemptionsCsv);
  console.log(`Exported ${redemptions.length} redemptions to exports/validation_redemptions.csv`);

  // CSV 5: Summary
  let totalBuys = 0, totalSells = 0;
  for (const t of trades) {
    if (t.side === 'buy') totalBuys += parseFloat(t.usdc);
    else totalSells += parseFloat(t.usdc);
  }

  let totalSplits = 0;
  for (const s of splits) totalSplits += parseFloat(s.usdc);

  let totalRedemptions = 0;
  for (const r of redemptions) totalRedemptions += parseFloat(r.usdc);

  let heldValue = 0;
  for (const [tokenId, pos] of positionMap.entries()) {
    const net = pos.bought - pos.sold;
    if (net > 0) {
      const mapping = tokenToCondition.get(tokenId);
      if (mapping) {
        const resPrice = resolutionMap.get(`${mapping.condition_id}_${mapping.outcome_index}`) ?? 0;
        heldValue += net * resPrice;
      }
    }
  }

  const pnl = totalSells + totalRedemptions - totalBuys - totalSplits + heldValue;

  let summaryCsv = 'component,amount_usdc,formula\n';
  summaryCsv += `CLOB Buys,${totalBuys.toFixed(2)},SUM of all buy trades\n`;
  summaryCsv += `CLOB Sells,${totalSells.toFixed(2)},SUM of all sell trades\n`;
  summaryCsv += `Redemptions,${totalRedemptions.toFixed(2)},SUM of PayoutRedemption events\n`;
  summaryCsv += `Split Costs,${totalSplits.toFixed(2)},SUM of PositionSplit events (via tx_hash)\n`;
  summaryCsv += `Held Value,${heldValue.toFixed(2)},SUM of (net_position * resolution_price) where net > 0\n`;
  summaryCsv += `---,---,---\n`;
  summaryCsv += `Calculated P&L,${pnl.toFixed(2)},Sells + Redemptions - Buys - Splits + HeldValue\n`;
  summaryCsv += `Ground Truth,-86.66,From Polymarket UI (Deposit - Balance)\n`;
  summaryCsv += `Error,${Math.abs(pnl - (-86.66)).toFixed(2)},|Calculated - Ground Truth|\n`;
  fs.writeFileSync('exports/validation_summary.csv', summaryCsv);
  console.log(`Exported summary to exports/validation_summary.csv`);

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('P&L FORMULA');
  console.log('='.repeat(60));
  console.log('\nP&L = Sells + Redemptions - Buys - SplitCost + HeldValue\n');
  console.log('Where:');
  console.log('  Sells       = SUM of USDC received from sell trades');
  console.log('  Redemptions = SUM of PayoutRedemption events');
  console.log('  Buys        = SUM of USDC spent on buy trades');
  console.log('  SplitCost   = SUM of PositionSplit events (linked via tx_hash)');
  console.log('  HeldValue   = SUM of (net_tokens * resolution_price) for winning positions');
  console.log('\n' + '='.repeat(60));
  console.log('CALCULATION');
  console.log('='.repeat(60));
  console.log(`\nSells:       $${totalSells.toFixed(2)}`);
  console.log(`Redemptions: $${totalRedemptions.toFixed(2)}`);
  console.log(`Buys:        $${totalBuys.toFixed(2)}`);
  console.log(`Split Cost:  $${totalSplits.toFixed(2)}`);
  console.log(`Held Value:  $${heldValue.toFixed(2)}`);
  console.log(`\nP&L = ${totalSells.toFixed(2)} + ${totalRedemptions.toFixed(2)} - ${totalBuys.toFixed(2)} - ${totalSplits.toFixed(2)} + ${heldValue.toFixed(2)}`);
  console.log(`P&L = $${pnl.toFixed(2)}`);
  console.log(`\nGround Truth: $-86.66`);
  console.log(`Error: $${Math.abs(pnl - (-86.66)).toFixed(2)}`);
}

main().catch(console.error);
