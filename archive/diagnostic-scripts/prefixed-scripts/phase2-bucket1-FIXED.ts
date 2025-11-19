import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('BUCKET 1: RESOLVED-BUT-UNREDEEMED (WITH CORRECT DECODING)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Checking positions still in wallet for resolution status...\n');

  // Get current ERC-1155 balances with CORRECT decoding
  const balancesQuery = await clickhouse.query({
    query: `
      WITH
        incoming AS (
          SELECT
            token_id,
            SUM(reinterpretAsUInt256(reverse(unhex(substring(value, 3))))) as amount_in
          FROM default.erc1155_transfers
          WHERE to_address = lower('${WALLET}')
          GROUP BY token_id
        ),
        outgoing AS (
          SELECT
            token_id,
            SUM(reinterpretAsUInt256(reverse(unhex(substring(value, 3))))) as amount_out
          FROM default.erc1155_transfers
          WHERE from_address = lower('${WALLET}')
          GROUP BY token_id
        ),
        balances AS (
          SELECT
            incoming.token_id,
            incoming.amount_in - COALESCE(outgoing.amount_out, 0) as balance
          FROM incoming
          LEFT JOIN outgoing ON incoming.token_id = outgoing.token_id
          WHERE incoming.amount_in > COALESCE(outgoing.amount_out, 0)
        ),
        decoded AS (
          SELECT
            token_id,
            balance,
            lower(hex(bitShiftRight(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 8))) as condition_id_norm,
            toUInt8(bitAnd(reinterpretAsUInt256(reverse(unhex(substring(token_id, 3)))), 255)) as outcome_index
          FROM balances
        )
      SELECT
        d.token_id,
        d.balance,
        d.condition_id_norm,
        d.outcome_index,
        r.winning_index,
        r.resolved_at,
        CASE
          WHEN r.winning_index = d.outcome_index THEN toFloat64(d.balance) * 1.0
          ELSE 0
        END as resolution_value
      FROM decoded d
      LEFT JOIN default.market_resolutions_final r
        ON d.condition_id_norm = r.condition_id_norm
      WHERE r.condition_id_norm IS NOT NULL
      ORDER BY resolution_value DESC
    `,
    format: 'JSONEachRow'
  });

  const resolvedPositions: any[] = await balancesQuery.json();

  console.log(`Found ${resolvedPositions.length} resolved positions still in wallet\n`);

  if (resolvedPositions.length === 0) {
    console.log('⚠️  No resolved positions in wallet!');
    console.log('   All 69 positions are still in UNRESOLVED markets\n');
    console.log('   This means Bucket 1 P&L = $0\n');
    return;
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('RESOLVED POSITIONS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let totalResolvedValue = 0;
  let totalCost = 0;
  let wonCount = 0;
  let lostCount = 0;

  for (const position of resolvedPositions) {
    const won = position.winning_index === position.outcome_index;
    const resolvedValue = parseFloat(position.resolution_value);

    console.log(`${won ? '✅ WON' : '❌ LOST'}:`);
    console.log(`   Condition: ${position.condition_id_norm.substring(0, 30)}...`);
    console.log(`   Outcome held: ${position.outcome_index}`);
    console.log(`   Winning outcome: ${position.winning_index}`);
    console.log(`   Balance: ${position.balance.toLocaleString()}`);
    console.log(`   Resolution value: $${resolvedValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);

    if (won) wonCount++;
    else lostCount++;

    totalResolvedValue += resolvedValue;

    // Get cost basis
    const costQuery = await clickhouse.query({
      query: `
        SELECT
          SUM(price * size) as total_cost
        FROM default.clob_fills
        WHERE lower(proxy_wallet) = lower('${WALLET}')
          AND lower(hex(bitShiftRight(toUInt256(asset_id), 8))) = '${position.condition_id_norm}'
          AND toUInt8(bitAnd(toUInt256(asset_id), 255)) = ${position.outcome_index}
          AND side = 'BUY'
      `,
      format: 'JSONEachRow'
    });

    const costResult = await costQuery.json();
    const cost = costResult.length > 0 && costResult[0].total_cost ? parseFloat(costResult[0].total_cost) : 0;
    totalCost += cost;

    console.log(`   Cost basis: $${cost.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`   P&L: ${resolvedValue - cost >= 0 ? '+' : ''}$${(resolvedValue - cost).toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('BUCKET 1 SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Resolved positions in wallet: ${resolvedPositions.length}`);
  console.log(`   Won: ${wonCount}`);
  console.log(`   Lost: ${lostCount}`);
  console.log(`   Win rate: ${resolvedPositions.length > 0 ? (wonCount / resolvedPositions.length * 100).toFixed(1) : 0}%\n`);

  const bucket1PnL = totalResolvedValue - totalCost;

  console.log(`Total cost basis: $${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Total resolution value: $${totalResolvedValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`BUCKET 1 P&L: ${bucket1PnL >= 0 ? '+' : ''}$${bucket1PnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('COMPARISON TO DUNE ($80K)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Dune reported: ~$80,000`);
  console.log(`Our Bucket 1 P&L: $${Math.round(bucket1PnL).toLocaleString()}`);
  console.log(`Difference: $${Math.abs(80000 - bucket1PnL).toLocaleString()}\n`);

  if (Math.abs(bucket1PnL - 80000) < 10000) {
    console.log('✅ MATCH! Resolved-but-unredeemed P&L matches Dune!');
  } else if (Math.abs(bucket1PnL - 80000) < 30000) {
    console.log('🟡 CLOSE - Bucket 1 alone is within $30K');
  } else {
    console.log('Need to combine with other sources (Bucket 2, explicit trades, etc.)');
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
