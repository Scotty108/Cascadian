import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

interface Burn {
  token_id: string;
  shares: number;
  block_timestamp: string;
  tx_hash: string;
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('CALCULATE REDEMPTION P&L FROM BURNS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Wallet: ${WALLET}\n`);

  // Step 1: Get all burns with decoded amounts
  console.log('Step 1: Fetch all burn events with decoded share amounts...\n');

  const burnsQuery = await clickhouse.query({
    query: `
      SELECT
        token_id,
        value,
        reinterpretAsUInt64(reverse(unhex(substring(value, 3)))) / 1e6 AS shares,
        block_timestamp,
        tx_hash
      FROM default.erc1155_transfers
      WHERE lower(from_address) = lower('${WALLET}')
        AND lower(to_address) = lower('${ZERO_ADDRESS}')
      ORDER BY block_timestamp
    `,
    format: 'JSONEachRow'
  });

  const burns: Burn[] = await burnsQuery.json();

  console.log(`   Found ${burns.length} burn events:\n`);

  let totalShares = 0;
  burns.forEach((b, i) => {
    const shares = parseFloat(b.shares.toString());
    totalShares += shares;
    console.log(`   ${i + 1}. Token: ${b.token_id.substring(0, 20)}...`);
    console.log(`      Shares: ${shares.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
    console.log(`      Time: ${b.block_timestamp}`);
    console.log(`      Tx: ${b.tx_hash.substring(0, 20)}...\n`);
  });

  console.log(`   Total shares burned: ${totalShares.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  // Step 2: Check if token_id can be mapped to condition_id
  console.log('Step 2: Check if we can map token_ids to markets...\n');

  // Try to find any mapping table
  const mappingCheck = await clickhouse.query({
    query: `
      SELECT name
      FROM system.tables
      WHERE database = 'default'
        AND (name LIKE '%token%' OR name LIKE '%market%' OR name LIKE '%condition%')
      ORDER BY name
    `,
    format: 'JSONEachRow'
  });

  const mappingTables: any[] = await mappingCheck.json();

  console.log('   Potential mapping tables:');
  mappingTables.forEach(t => {
    console.log(`      - ${t.name}`);
  });
  console.log();

  // Try direct lookup in a few common tables
  console.log('Step 3: Try to find token_id mappings...\n');

  const sampleTokenId = burns[0].token_id;

  // Check ctf_exchange_token_ids if it exists
  try {
    const tokenMapQuery = await clickhouse.query({
      query: `
        SELECT *
        FROM default.ctf_exchange_token_ids
        WHERE lower(token_id) = lower('${sampleTokenId}')
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const tokenMap: any[] = await tokenMapQuery.json();

    if (tokenMap.length > 0) {
      console.log(`   ✅ Found mapping in ctf_exchange_token_ids:`);
      console.log(`      Token: ${sampleTokenId.substring(0, 20)}...`);
      Object.entries(tokenMap[0]).forEach(([key, value]) => {
        console.log(`      ${key}: ${value}`);
      });
      console.log();
    } else {
      console.log(`   ❌ No mapping found in ctf_exchange_token_ids\n`);
    }
  } catch (e: any) {
    console.log(`   ⚠️  Table ctf_exchange_token_ids does not exist or error: ${e.message}\n`);
  }

  // Check if token_id appears in trades_raw
  console.log('Step 4: Check if burns match any trades...\n');

  for (const burn of burns.slice(0, 3)) {  // Check first 3
    const tradeQuery = await clickhouse.query({
      query: `
        SELECT
          market_id,
          condition_id,
          side,
          outcome_index,
          count() AS trade_count,
          sum(toFloat64(shares)) AS total_shares
        FROM default.trades_raw
        WHERE lower(wallet) = lower('${WALLET}')
        GROUP BY market_id, condition_id, side, outcome_index
        LIMIT 20
      `,
      format: 'JSONEachRow'
    });

    const trades: any[] = await tradeQuery.json();

    if (trades.length > 0) {
      console.log(`   Found ${trades.length} market positions for wallet:\n`);
      trades.forEach(t => {
        console.log(`      Market: ${t.market_id.substring(0, 20)}...`);
        console.log(`      Condition: ${t.condition_id.substring(0, 20)}...`);
        console.log(`      Side: ${t.side}, Outcome: ${t.outcome_index}`);
        console.log(`      Trades: ${t.trade_count}, Shares: ${parseFloat(t.total_shares).toFixed(2)}\n`);
      });
    }
    break;  // Just show first sample
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('REDEMPTION P&L ESTIMATION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Simple estimation: if outcomes won, payout = shares × $1
  console.log('Estimation approach:');
  console.log('   - Assume burned tokens were WINNING outcomes');
  console.log('   - Payout = shares_burned × $1 = ' + totalShares.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  console.log('   - Cost basis = need to find original entry prices\n');

  console.log('Without cost basis data, if ALL burns were winners:');
  console.log(`   Maximum redemption P&L ≈ $${totalShares.toLocaleString('en-US', { minimumFractionDigits: 2 })}\n`);

  console.log('To complete calculation, need:');
  console.log('   1. Map token_id → condition_id + outcome_index');
  console.log('   2. Check market resolutions (which outcomes won)');
  console.log('   3. Find original cost basis for each position');
  console.log('   4. Calculate: (shares × $1 if won) - cost_basis\n');

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
