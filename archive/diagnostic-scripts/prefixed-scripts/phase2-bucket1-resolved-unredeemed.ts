import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

// Decode CTF token_id to extract condition_id and outcome_index
// Format: token_id is 32-byte hex with condition_id in bits [255:2] and outcome_index in bits [1:0]
// For a 66-char hex string (0x + 64 chars), last 2 hex chars encode outcome
function decodeTokenId(tokenId: string): { conditionId: string; outcomeIndex: number } | null {
  try {
    // Remove 0x prefix if present
    let hex = tokenId.startsWith('0x') ? tokenId.slice(2) : tokenId;

    // Pad to 64 chars if needed
    hex = hex.padStart(64, '0');

    // Last 2 chars (1 byte) contain outcome index in lower bits
    // But CTF encoding is more complex - outcome is in lower 2 bits of entire 32-byte value
    // For simplicity, check if last byte has outcome encoded
    const lastByte = hex.slice(-2);
    const outcomeIndex = parseInt(lastByte, 16);

    // Condition ID is the upper portion (zero out lower 2 bits)
    // For now, just take first 62 chars as condition_id approximation
    const conditionId = hex.slice(0, 62) + '00';

    return { conditionId, outcomeIndex };
  } catch (error) {
    console.error(`Failed to decode token_id: ${tokenId}`, error);
    return null;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('BUCKET 1: RESOLVED-BUT-UNREDEEMED INVENTORY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Methodology:');
  console.log('   1. Calculate wallet\'s current ERC-1155 token balances');
  console.log('   2. Check which markets have resolved');
  console.log('   3. Value resolved positions: $1 (won) or $0 (lost)');
  console.log('   4. Calculate P&L: resolution_value - original_cost\n');

  // Step 1: Get wallet's current ERC-1155 balances
  console.log('Step 1: Calculating current ERC-1155 balances...\n');

  const balanceQuery = await clickhouse.query({
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
        )
      SELECT
        incoming.token_id,
        incoming.amount_in - COALESCE(outgoing.amount_out, 0) as balance
      FROM incoming
      LEFT JOIN outgoing ON incoming.token_id = outgoing.token_id
      WHERE incoming.amount_in > COALESCE(outgoing.amount_out, 0)
      ORDER BY balance DESC
    `,
    format: 'JSONEachRow'
  });

  const balances: any[] = await balanceQuery.json();
  console.log(`Found ${balances.length} tokens with positive balances\n`);

  if (balances.length === 0) {
    console.log('⚠️  Wallet has no ERC-1155 tokens!\n');
    console.log('This means:');
    console.log('   - Either all positions have been redeemed (burned)');
    console.log('   - Or we need to check the balance calculation\n');
    return;
  }

  // Sample first few balances
  console.log('Sample balances (top 10):\n');
  balances.slice(0, 10).forEach((b, i) => {
    const decoded = decodeTokenId(b.token_id);
    console.log(`${i + 1}. Token: ${b.token_id.substring(0, 30)}...`);
    console.log(`   Balance: ${b.balance}`);
    if (decoded) {
      console.log(`   Condition: ${decoded.conditionId.substring(0, 30)}...`);
      console.log(`   Outcome: ${decoded.outcomeIndex}`);
    }
    console.log('');
  });

  // Step 2: Check which tokens correspond to resolved markets
  console.log('Step 2: Checking for resolved markets...\n');

  let totalResolvedValue = 0;
  let totalCost = 0;
  let resolvedCount = 0;
  let wonCount = 0;
  let lostCount = 0;

  for (const balance of balances) {
    const decoded = decodeTokenId(balance.token_id);
    if (!decoded) continue;

    // Check if this market resolved
    const resolutionQuery = await clickhouse.query({
      query: `
        SELECT
          condition_id_norm,
          winning_index,
          resolved_at
        FROM default.market_resolutions_final
        WHERE condition_id_norm = '${decoded.conditionId}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const resolutions = await resolutionQuery.json();

    if (resolutions.length > 0) {
      const resolution = resolutions[0];
      const won = resolution.winning_index === decoded.outcomeIndex;
      const shares = parseInt(balance.balance);
      const resolutionValue = won ? shares * 1.0 : 0;

      resolvedCount++;
      if (won) wonCount++;
      else lostCount++;

      totalResolvedValue += resolutionValue;

      // Get cost basis from original BUY trades
      const costQuery = await clickhouse.query({
        query: `
          SELECT
            SUM(price * size) as total_cost
          FROM default.clob_fills
          WHERE lower(proxy_wallet) = lower('${WALLET}')
            AND lower(condition_id) = lower('${decoded.conditionId}')
            AND side = 'BUY'
        `,
        format: 'JSONEachRow'
      });

      const costResult = await costQuery.json();
      const cost = costResult.length > 0 ? parseFloat(costResult[0].total_cost || '0') : 0;
      totalCost += cost;

      if (resolvedCount <= 10) {
        console.log(`${won ? '✅ WON' : '❌ LOST'}: ${decoded.conditionId.substring(0, 30)}...`);
        console.log(`   Outcome: ${decoded.outcomeIndex}`);
        console.log(`   Shares: ${shares.toLocaleString()}`);
        console.log(`   Cost: $${cost.toFixed(2)}`);
        console.log(`   Resolution value: $${resolutionValue.toFixed(2)}`);
        console.log(`   P&L: ${resolutionValue - cost >= 0 ? '+' : ''}$${(resolutionValue - cost).toFixed(2)}`);
        console.log(`   Resolved: ${resolution.resolved_at}\n`);
      }
    }
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('BUCKET 1 SUMMARY: RESOLVED-BUT-UNREDEEMED');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Total positions still in wallet: ${balances.length}`);
  console.log(`   Resolved positions: ${resolvedCount}`);
  console.log(`   Won: ${wonCount}`);
  console.log(`   Lost: ${lostCount}`);
  console.log(`   Unresolved: ${balances.length - resolvedCount}\n`);

  const bucket1PnL = totalResolvedValue - totalCost;

  console.log(`Total cost (from CLOB fills): $${totalCost.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Total resolution value: $${totalResolvedValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
  console.log(`Bucket 1 P&L: ${bucket1PnL >= 0 ? '+' : ''}$${bucket1PnL.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('NEXT STEP');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Bucket 1 P&L: ' + (bucket1PnL >= 0 ? '+' : '') + `$${bucket1PnL.toFixed(2)}`);
  console.log('Still need: Bucket 2 (redemptions) to get complete P&L\n');

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
