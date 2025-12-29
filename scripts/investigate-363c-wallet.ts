/**
 * Forensic Investigation: Wallet 0x363c709d75cef929a814b06ac08dd443cfb37311
 *
 * UI PnL: $0.00
 * V23c PnL: -$4,228.26
 *
 * Goal: Understand WHY there's a massive discrepancy
 */

import { clickhouse } from '../lib/clickhouse/client';

const wallet = '0x363c709d75cef929a814b06ac08dd443cfb37311';

async function analyzeByOutcome() {
  console.log('=== BREAKDOWN BY OUTCOME ===');
  console.log('Market: Will Donald Trump be the #1 searched person on Google in 2024?');
  console.log('Resolution: [0, 1] - Outcome 1 (YES) won');
  console.log('');

  // Token IDs (from our earlier discovery)
  const token0 = '108294418470154331012315576418925896822555088973525283627907335955315114276930'; // outcome_index 0 (NO)
  const token1 = '110180825973586203401768894817809331129104894097494819536337372966324218902403'; // outcome_index 1 (YES)

  // Analyze trades by token
  for (const [tokenId, outcomeName] of [[token0, 'NO (index 0)'], [token1, 'YES (index 1)']] as const) {
    console.log('--- ' + outcomeName + ' ---');

    const trades = await clickhouse.query({
      query: `
        WITH deduped AS (
          SELECT
            event_id,
            any(side) as side,
            any(usdc_amount) / 1e6 as usdc,
            any(token_amount) / 1e6 as tokens
          FROM pm_trader_events_v2
          WHERE lower(trader_wallet) = lower('${wallet}')
            AND token_id = '${tokenId}'
            AND is_deleted = 0
          GROUP BY event_id
        )
        SELECT
          side,
          count() as trades,
          sum(usdc) as total_usdc,
          sum(tokens) as total_tokens
        FROM deduped
        GROUP BY side
      `,
      format: 'JSONEachRow'
    });
    const t = await trades.json() as any[];

    let buyUsdc = 0, sellUsdc = 0, buyTokens = 0, sellTokens = 0;
    for (const row of t) {
      if (row.side.toUpperCase() === 'BUY') {
        buyUsdc = parseFloat(row.total_usdc);
        buyTokens = parseFloat(row.total_tokens);
      } else {
        sellUsdc = parseFloat(row.total_usdc);
        sellTokens = parseFloat(row.total_tokens);
      }
    }

    const netPosition = buyTokens - sellTokens;
    console.log('  BUY:  $' + buyUsdc.toFixed(2) + ', ' + buyTokens.toFixed(2) + ' tokens');
    console.log('  SELL: $' + sellUsdc.toFixed(2) + ', ' + sellTokens.toFixed(2) + ' tokens');
    console.log('  Net Position: ' + netPosition.toFixed(2) + ' tokens');
    console.log('  Cash Flow: $' + (sellUsdc - buyUsdc).toFixed(2));
    console.log('');
  }

  console.log('=== PNL CALCULATION WITH RESOLUTION ===');
  console.log('Resolution: [0, 1] means:');
  console.log('  - NO tokens (outcome 0) pay $0');
  console.log('  - YES tokens (outcome 1) pay $1');
  console.log('');

  // Get totals for NO token
  const token0Trades = await clickhouse.query({
    query: `
      WITH deduped AS (
        SELECT event_id, any(side) as side, any(usdc_amount) / 1e6 as usdc, any(token_amount) / 1e6 as tokens
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}') AND token_id = '${token0}' AND is_deleted = 0
        GROUP BY event_id
      )
      SELECT side, sum(usdc) as total_usdc, sum(tokens) as total_tokens FROM deduped GROUP BY side
    `,
    format: 'JSONEachRow'
  });
  const t0 = await token0Trades.json() as any[];

  // Get totals for YES token
  const token1Trades = await clickhouse.query({
    query: `
      WITH deduped AS (
        SELECT event_id, any(side) as side, any(usdc_amount) / 1e6 as usdc, any(token_amount) / 1e6 as tokens
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}') AND token_id = '${token1}' AND is_deleted = 0
        GROUP BY event_id
      )
      SELECT side, sum(usdc) as total_usdc, sum(tokens) as total_tokens FROM deduped GROUP BY side
    `,
    format: 'JSONEachRow'
  });
  const t1 = await token1Trades.json() as any[];

  // Parse results
  let no_buy_usdc = 0, no_sell_usdc = 0, no_buy_tokens = 0, no_sell_tokens = 0;
  let yes_buy_usdc = 0, yes_sell_usdc = 0, yes_buy_tokens = 0, yes_sell_tokens = 0;

  for (const row of t0) {
    if (row.side.toUpperCase() === 'BUY') { no_buy_usdc = parseFloat(row.total_usdc); no_buy_tokens = parseFloat(row.total_tokens); }
    else { no_sell_usdc = parseFloat(row.total_usdc); no_sell_tokens = parseFloat(row.total_tokens); }
  }
  for (const row of t1) {
    if (row.side.toUpperCase() === 'BUY') { yes_buy_usdc = parseFloat(row.total_usdc); yes_buy_tokens = parseFloat(row.total_tokens); }
    else { yes_sell_usdc = parseFloat(row.total_usdc); yes_sell_tokens = parseFloat(row.total_tokens); }
  }

  const no_net_position = no_buy_tokens - no_sell_tokens;
  const yes_net_position = yes_buy_tokens - yes_sell_tokens;
  const no_cash_flow = no_sell_usdc - no_buy_usdc;
  const yes_cash_flow = yes_sell_usdc - yes_buy_usdc;

  console.log('NO tokens (outcome 0, resolution_price = $0):');
  console.log('  Buy: ' + no_buy_tokens.toFixed(2) + ' tokens for $' + no_buy_usdc.toFixed(2));
  console.log('  Sell: ' + no_sell_tokens.toFixed(2) + ' tokens for $' + no_sell_usdc.toFixed(2));
  console.log('  Net Position: ' + no_net_position.toFixed(2) + ' tokens');
  console.log('  Cash Flow: $' + no_cash_flow.toFixed(2));
  console.log('  Position Value at Resolution: ' + no_net_position.toFixed(2) + ' * $0 = $0');
  console.log('  PnL for NO: $' + no_cash_flow.toFixed(2) + ' + $0 = $' + no_cash_flow.toFixed(2));
  console.log('');

  console.log('YES tokens (outcome 1, resolution_price = $1):');
  console.log('  Buy: ' + yes_buy_tokens.toFixed(2) + ' tokens for $' + yes_buy_usdc.toFixed(2));
  console.log('  Sell: ' + yes_sell_tokens.toFixed(2) + ' tokens for $' + yes_sell_usdc.toFixed(2));
  console.log('  Net Position: ' + yes_net_position.toFixed(2) + ' tokens');
  console.log('  Cash Flow: $' + yes_cash_flow.toFixed(2));
  console.log('  Position Value at Resolution: ' + yes_net_position.toFixed(2) + ' * $1 = $' + yes_net_position.toFixed(2));
  console.log('  PnL for YES: $' + yes_cash_flow.toFixed(2) + ' + $' + yes_net_position.toFixed(2) + ' = $' + (yes_cash_flow + yes_net_position).toFixed(2));
  console.log('');

  const totalPnL = no_cash_flow + yes_cash_flow + yes_net_position;
  console.log('=== TOTAL PNL (CLOB-only view) ===');
  console.log('NO PnL: $' + no_cash_flow.toFixed(2));
  console.log('YES PnL: $' + (yes_cash_flow + yes_net_position).toFixed(2));
  console.log('TOTAL: $' + totalPnL.toFixed(2));
  console.log('');

  console.log('=== DISCREPANCY ANALYSIS ===');
  console.log('Our calculation: $' + totalPnL.toFixed(2));
  console.log('V23c shows: -$4,228.26');
  console.log('Difference: $' + (totalPnL - (-4228.26)).toFixed(2));
  console.log('');

  // The key insight - check what happens if we DON'T include resolution payout
  console.log('=== HYPOTHESIS: ENGINE MISSING RESOLUTION PAYOUT ===');
  const pnlWithoutResolution = no_cash_flow + yes_cash_flow;
  console.log('If engine ignores resolution payout:');
  console.log('  PnL = Cash Flow only = $' + pnlWithoutResolution.toFixed(2));
  console.log('');

  // Check if there's a position tracking issue
  console.log('=== HYPOTHESIS: NEGATIVE POSITION NOT HANDLED ===');
  console.log('NO net position: ' + no_net_position.toFixed(2) + ' (should be ignored at $0 resolution)');
  console.log('YES net position: ' + yes_net_position.toFixed(2) + ' (NEGATIVE - sold more than bought!)');
  console.log('');
  console.log('If engine tries to "redeem" a negative position:');
  console.log('  It would show a LOSS even though the user already received cash from selling');
  console.log('');

  // Check the actual split that must have happened
  console.log('=== THE MISSING SPLIT ===');
  const tokenDeficit = (no_sell_tokens - no_buy_tokens) + (yes_sell_tokens - yes_buy_tokens);
  console.log('Total token deficit (sold more than bought): ' + tokenDeficit.toFixed(2));
  console.log('');
  console.log('This user must have:');
  console.log('1. Deposited ~$' + (tokenDeficit).toFixed(2) + ' USDC');
  console.log('2. Split into ' + tokenDeficit.toFixed(2) + ' NO + ' + tokenDeficit.toFixed(2) + ' YES tokens');
  console.log('3. Sold most of them on CLOB');
  console.log('');
  console.log('The Split operation is NOT in our CTF events or ERC1155 transfers!');
  console.log('This is a DATA GAP that explains the discrepancy.');

  process.exit(0);
}

analyzeByOutcome().catch(console.error);
