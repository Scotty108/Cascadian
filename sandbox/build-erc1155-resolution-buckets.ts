import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
import { clickhouse } from '../lib/clickhouse/client.js';

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

interface Position {
  condition_id: string;
  outcome_index: number;
  final_value_dollar: number;
  unrealized_gain: number;

}

async function buildERC1155ResolutionBuckets() {
  console.log('🎯 BUILDING ERC-1155 RESOLUTION + UNREDEEMED BUCKETS');
  console.log('='.repeat(70));
  console.log(`Target wallet: ${WALLET}`);
  console.log('');

  try {
    // Step 1: Get current holdings from clob_fills (authoritative source)
    console.log('📊 Step 1: Current holdings from clob_fills...');

    const currentRaw = await clickhouse.query({
      query: `
        WITH per_market_holdings AS (
          SELECT
            condition_id,
            outcome,
            SUM(CASE WHEN side = 'BUY' THEN size/1e6 ELSE -size/1e6 END) as net_shares,
            SUM(CASE WHEN side = 'BUY' THEN price*size/1e6 ELSE -price*size/1e6 END) as net_cost,
            MIN(timestamp) as first_trade,
            MAX(timestamp) as last_trade
          FROM default.clob_fills
          WHERE (lower(CAST(proxy_wallet AS String)) = lower('${WALLET}')
                 OR lower(CAST(user_eoa AS String)) = lower('${WALLET}'))
             AND outcome IS NOT NULL
          GROUP BY condition_id, outcome
          HAVING abs(net_shares) > 0
        )
        SELECT
          condition_id,
          outcome,
          net_shares,
              CASE WHEN net_shares = 0 THEN 1
              ELSE net_cost / net_shares END as avg_cost,
          first_trade,
          last_trade
        FROM per_market_holdings
        WHERE abs(net_shares) > 1
        ORDER BY abs(net_shares) DESC
        LIMIT 20
      `,
      format: 'JSONEachRow'
    });

    const currentPositions = await currentRaw.json();
    console.log(`Current holdings for ${WALLET}:`);
    console.log('Market | Outcome | Net Shares | Avg Cost | First | Last');
    console.log('-'.repeat(70));

    let total_current_holdings = 0;
    let total_current_cost = 0;

    currentPositions.forEach((pos: any) => {
      const market = pos.condition_id.slice(-8);
      total_current_holdings += Number(pos.net_shares);
      total_current_cost += Number(pos.avg_cost) * Number(pos.net_shares);

      console.log(`${market} | ${pos.outcome.padEnd(7)} | ${pos.net_shares.toLocaleString().padStart(10)} | $${Number(pos.avg_cost).toFixed(3)} | ${pos.first_trade} | ${pos.last_trade}`);
    });

    console.log(`\nTotal current holdings: ${total_current_holdings.toLocaleString()} shares`);
    console.log(`Total current cost: $${total_current_cost.toLocaleString()}`);

    // Step 2: Check for resolved positions
    console.log('\n🔍 Step 2: Check position resolutions...');

    const resolvedData = await clickhouse.query({
      query: `
        SELECT
          c.condition_id,
          c.outcome,
          c.net_shares,
          c.avg_cost,
          mr.winning_outcome,
          mr.resolved_at
        FROM (
          SELECT
            condition_id,
            outcome,
            SUM(CASE WHEN side = 'BUY' THEN size/1e6 ELSE -size/1e6 END) as net_shares,
            SUM(CASE WHEN side = 'BUY' THEN price*size/1e6 ELSE -price*size/1e6 END) / NULLIF(SUM(CASE WHEN side = 'BUY' THEN size/1e6 ELSE -size/1e6 END), 0) as avg_cost
          FROM default.clob_fills
          WHERE (lower(CAST(proxy_wallet AS String)) = lower('${WALLET}')
                 OR lower(CAST(user_eoa AS String)) = lower('${WALLET}'))
          GROUP BY condition_id, outcome
          HAVING abs(net_shares) > 1
        ) c
        LEFT JOIN default.market_resolutions_final mr
        ON c.condition_id = mr.condition_id_norm
        WHERE mr.winning_outcome IS NOT NULL
      `,
      format: 'JSONEachRow'
    });

    const resolvedPositions = await resolvedData.json();

    if (resolvedPositions.length > 0) {
      console.log(`\nRESOLVED POSITIONS (${resolvedPositions.length} markets):`);
      console.log('Market | Outcome Held | Shares | Cost | Winning | Won? | P&L per Share ');
      console.log('-'.repeat(75));

      let total_resolved_bucket = 0;
      let total_held_value = 0;

      resolvedPositions.forEach((pos: any) => {
        const market = pos.condition_id.slice(-8);
        const won = pos.winning_outcome === pos.outcome;
        const final_value = won ? 1.0 : 0.0;
        const pnl_per_share = final_value - Number(pos.avg_cost);
        const position_value = final_value * Number(pos.net_shares);

        total_resolved_bucket += position_value - (Number(pos.avg_cost) * Number(pos.net_shares));
        total_held_value += position_value;

        console.log(`${market} | ${pos.outcome.padEnd(12)} | ${pos.net_shares.toLocaleString().padStart(8)} | $${Number(pos.avg_cost).toFixed(3)} | ${pos.winning_outcome} | ${won ? 'WIN  ' : 'LOSE '} | $${pnl_per_share.toFixed(3)}`);
      });

      console.log(`\nResolved bucket value: $${total_held_value.toLocaleString()}`);
      console.log(`Resolved P&L from redemption: $${total_resolved_bucket.toLocaleString()}`);
    } else {
      console.log('✅ ALL positions are still open/unresolved');
    }

    // Step 3: Look for redemptions (ERC-1155 burns)
    console.log('\n🔍 Step 3: Check ERC-1155 redemptions...');

    // Get the position tokens (CTF tokens) for this wallet
    const tokenQuery = await clickhouse.query({
      query: `
        SELECT DISTINCT
          LOWER(from_address) as holder,
          condition_id_norm,
          SUM(value) as total_burned,
          COUNT(*) as burn_count
        FROM default.erc1155_transfers
        WHERE LOWER(from_address) = lower('${WALLET}')
          AND condition_id_norm != '0x0000000000000000000000000000000000000000000000000000000000000000'
          AND to_address = '0x0000000000000000000000000000000000000000' -- burn address
        GROUP BY LOWER(from_address), condition_id_norm
      `,
      format: 'JSONEachRow'
    });

    const burns = await tokenQuery.json();

    if (burns.length > 0) {
      console.log(`\nERC-1155 BURNS (${burns.length} different tokens):`);
      console.log('Market | Tokens Burned | Redemption Status');
      console.log('-'.repeat(50));

      let total_burns = 0;

      burns.forEach((burn: any) => {
        const market = burn.condition_id_norm.slice(-8);
        total_burns += Number(burn.total_burned);

        console.log(`${market} | ${Number(burn.total_burned).toLocaleString().padStart(12)} | NEED PAYOUT DATA`);
      });

      console.log(`\nTotal burned tokens: ${total_burns.toLocaleString()}`);
      console.log('Need to map these to token_per_share_payout for dollar values');
    } else {
      console.log('No ERC-1155 burns detected in dataset');
    }

    console.log('\n📋 SUMMARY:');
    console.log(`Current unrealized P&L: ${(total_current_holdings) ? '+$' + total_current_holdings.toLocaleString() + ' (if market resolves)' : 'None' }`);
    console.log('\nTo get complete P&L you need:');
    console.log('1. Historical cost basis for old SELL trades (pre-Aug 2024)');
    console.log('2. Payout vectors for any burned ERC-1155 tokens');
    console.log('3. Unrealized value for current/outstanding positions (mark-to-market at $1/$0)');

  } catch (error) {
    console.error('Error:', error.message);
  }
}

buildERC1155ResolutionBuckets().catch(console.error);