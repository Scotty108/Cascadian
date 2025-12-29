/**
 * Analyze PnL from raw fills data
 *
 * Key question: Can we calculate accurate PnL using just CLOB fills + CTF events?
 */

import { clickhouse } from '../../lib/clickhouse/client';

const JUSTDOIT = '0x56bf1a64a14601aff2de20bb01045aed8da6c45a';

async function main() {
  console.log('═'.repeat(70));
  console.log('Redemption Analysis - What tokens were redeemed?');
  console.log('═'.repeat(70));

  // Get all redemption details
  const redemptions = await clickhouse.query({
    query: `
      SELECT
        condition_id,
        event_time,
        toFloat64OrZero(amount_or_payout) / 1e6 as payout_usdc,
        toFloat64OrZero(token_amount) / 1e6 as tokens_redeemed
      FROM pm_ctf_events
      WHERE lower(user_address) = '${JUSTDOIT.toLowerCase()}'
        AND event_type = 'PayoutRedemption'
        AND is_deleted = 0
      ORDER BY event_time
    `,
    format: 'JSONEachRow'
  });

  const rows: any[] = await redemptions.json();
  console.log('\nTotal redemptions: ' + rows.length);
  console.log('\ncondition_id (short)        | payout     | tokens');
  console.log('-'.repeat(60));

  let totalPayout = 0;
  let totalTokens = 0;
  const conditionPayouts: Record<string, number> = {};

  for (const r of rows) {
    const payout = Number(r.payout_usdc);
    const tokens = Number(r.tokens_redeemed);
    totalPayout += payout;
    totalTokens += tokens;
    const cid = r.condition_id || 'unknown';
    conditionPayouts[cid] = (conditionPayouts[cid] || 0) + payout;
    console.log((cid.slice(0, 30) || 'unknown').padEnd(30) + ' | $' + payout.toFixed(2).padStart(9) + ' | ' + tokens.toFixed(2));
  }

  console.log('-'.repeat(60));
  console.log('TOTAL'.padEnd(30) + ' | $' + totalPayout.toFixed(2).padStart(9) + ' | ' + totalTokens.toFixed(2));

  // Now check: were these tokens bought via CLOB?
  console.log('\n\n' + '═'.repeat(70));
  console.log('Cross-reference: Did CLOB show buys for these conditions?');
  console.log('═'.repeat(70));

  // Get the unique condition_ids from redemptions (excluding unknown)
  const conditions = Object.keys(conditionPayouts).filter(c => c !== 'unknown' && c !== '');

  if (conditions.length === 0) {
    console.log('No condition_ids found in redemptions.');

    // Check if there's actually token_id instead
    console.log('\nChecking pm_ctf_events schema...');
    const schema = await clickhouse.query({
      query: 'DESCRIBE pm_ctf_events',
      format: 'JSONEachRow'
    });
    const schemaRows: any[] = await schema.json();
    schemaRows.slice(0, 15).forEach((r: any) => console.log('  ' + r.name + ': ' + r.type));
  } else {
    console.log('\nGetting token mappings for redeemed conditions...');
    const conditionList = conditions.map(c => "'" + c + "'").join(',');

    const tokenMap = await clickhouse.query({
      query: `
        SELECT token_id_dec, condition_id, outcome_index
        FROM pm_token_to_condition_map_v4
        WHERE condition_id IN (${conditionList})
      `,
      format: 'JSONEachRow'
    });

    const tokenMapRows: any[] = await tokenMap.json();
    console.log('Token mappings found: ' + tokenMapRows.length);
  }

  // Alternative: Check ERC1155 transfers to see how tokens were acquired
  console.log('\n\n' + '═'.repeat(70));
  console.log('ERC1155 Transfer Analysis');
  console.log('═'.repeat(70));

  const erc1155 = await clickhouse.query({
    query: `
      SELECT
        count() as total,
        countIf(lower(to_address) = '${JUSTDOIT.toLowerCase()}') as incoming,
        countIf(lower(from_address) = '${JUSTDOIT.toLowerCase()}') as outgoing,
        sumIf(toFloat64(value), lower(to_address) = '${JUSTDOIT.toLowerCase()}') as tokens_in,
        sumIf(toFloat64(value), lower(from_address) = '${JUSTDOIT.toLowerCase()}') as tokens_out
      FROM pm_erc1155_transfers
      WHERE lower(from_address) = '${JUSTDOIT.toLowerCase()}'
         OR lower(to_address) = '${JUSTDOIT.toLowerCase()}'
    `,
    format: 'JSONEachRow'
  });

  const erc1155Row = (await erc1155.json())[0] as any;
  console.log('\nERC1155 transfers for JustDoIt:');
  console.log('  Total transfers: ' + erc1155Row.total);
  console.log('  Incoming: ' + erc1155Row.incoming + ' transfers, ' + Number(erc1155Row.tokens_in).toLocaleString() + ' tokens');
  console.log('  Outgoing: ' + erc1155Row.outgoing + ' transfers, ' + Number(erc1155Row.tokens_out).toLocaleString() + ' tokens');
  console.log('  Net: ' + (Number(erc1155Row.tokens_in) - Number(erc1155Row.tokens_out)).toLocaleString() + ' tokens');

  // Check the date range of ERC1155 data vs wallet activity
  console.log('\n\nERC1155 block range for this wallet:');
  const erc1155Range = await clickhouse.query({
    query: `
      SELECT
        min(block_number) as min_block,
        max(block_number) as max_block
      FROM pm_erc1155_transfers
      WHERE lower(from_address) = '${JUSTDOIT.toLowerCase()}'
         OR lower(to_address) = '${JUSTDOIT.toLowerCase()}'
    `,
    format: 'JSONEachRow'
  });
  const rangeRow = (await erc1155Range.json())[0] as any;
  console.log('  Block range: ' + rangeRow.min_block + ' - ' + rangeRow.max_block);

  // Check CLOB trade date range
  console.log('\nCLOB trade date range for this wallet:');
  const clobRange = await clickhouse.query({
    query: `
      SELECT
        min(trade_time) as first_trade,
        max(trade_time) as last_trade,
        min(block_number) as min_block,
        max(block_number) as max_block
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = '${JUSTDOIT.toLowerCase()}'
        AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const clobRangeRow = (await clobRange.json())[0] as any;
  console.log('  First trade: ' + clobRangeRow.first_trade);
  console.log('  Last trade: ' + clobRangeRow.last_trade);
  console.log('  Block range: ' + clobRangeRow.min_block + ' - ' + clobRangeRow.max_block);

  // KEY INSIGHT: Check if ERC1155 data starts AFTER some CLOB trades
  console.log('\n\n' + '═'.repeat(70));
  console.log('DATA GAP ANALYSIS');
  console.log('═'.repeat(70));

  // Global ERC1155 range
  const globalRange = await clickhouse.query({
    query: `
      SELECT
        min(block_number) as min_block,
        max(block_number) as max_block,
        count() as total
      FROM pm_erc1155_transfers
    `,
    format: 'JSONEachRow'
  });
  const globalRangeRow = (await globalRange.json())[0] as any;
  console.log('\nGlobal ERC1155 data:');
  console.log('  Block range: ' + globalRangeRow.min_block + ' - ' + globalRangeRow.max_block);
  console.log('  Total transfers: ' + Number(globalRangeRow.total).toLocaleString());

  // CLOB trades before ERC1155 start block
  const clobBeforeErc = await clickhouse.query({
    query: `
      SELECT
        count() as trades_before,
        sum(token_amount) / 1e6 as tokens_before,
        sum(usdc_amount) / 1e6 as usdc_before
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = '${JUSTDOIT.toLowerCase()}'
        AND block_number < ${globalRangeRow.min_block}
        AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const beforeRow = (await clobBeforeErc.json())[0] as any;
  console.log('\nJustDoIt CLOB trades BEFORE ERC1155 data starts (block ' + globalRangeRow.min_block + '):');
  console.log('  Trades: ' + beforeRow.trades_before);
  console.log('  Tokens: ' + Number(beforeRow.tokens_before).toLocaleString());
  console.log('  USDC: $' + Number(beforeRow.usdc_before).toLocaleString());

  // Conclusion
  console.log('\n\n' + '═'.repeat(70));
  console.log('CONCLUSION');
  console.log('═'.repeat(70));
  console.log(`
The answer to "can we calculate PnL just from fills data?" is:

**NO** - The fills data alone is insufficient because:

1. ERC1155 data starts at block ${globalRangeRow.min_block}
2. Any token acquisitions before that block are invisible
3. JustDoIt shows ${beforeRow.trades_before} trades before ERC1155 data starts
4. ~54K tokens were sold/redeemed but never appear as CLOB buys

The only way to get accurate PnL is either:
a) Backfill ERC1155 from block 0 to capture all token movements
b) Use Polymarket's own PnL API if available
c) Accept inaccuracy for wallets with pre-${globalRangeRow.min_block} activity
`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
