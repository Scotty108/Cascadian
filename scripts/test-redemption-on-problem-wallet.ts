import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default'
});

const CTF_CONTRACT = '0x4d97dcd97ec945f40cf65f87097ace5ea0476045';
const POLYMARKET_OPERATOR = '0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e';
const PROBLEM_WALLET = '0x4ce7';

async function testOnProblemWallet() {
  console.log('=== TESTING REDEMPTION DETECTION ON PROBLEM WALLET ===\n');
  console.log(`Wallet: ${PROBLEM_WALLET}\n`);

  // Step 1: Get wallet's unresolved positions
  console.log('Step 1: Fetching unresolved positions...\n');

  const unresolvedPositions = `
    SELECT
      condition_id_norm,
      outcome_index,
      shares,
      cost_basis_usd
    FROM cascadian_clean.vw_wallet_positions
    WHERE lower(wallet) LIKE lower('${PROBLEM_WALLET}%')
    ORDER BY cost_basis_usd DESC
    LIMIT 50
  `;

  const posResult = await client.query({ query: unresolvedPositions, format: 'JSONEachRow' });
  const positions = await posResult.json();

  console.log(`Found ${positions.length} positions for wallet ${PROBLEM_WALLET}\n`);

  if (positions.length > 0) {
    console.log('Top 10 positions by cost basis:');
    positions.slice(0, 10).forEach((pos: any, i: number) => {
      console.log(`${i + 1}. Condition: ${pos.condition_id_norm.substring(0, 16)}...`);
      console.log(`   Outcome: ${pos.outcome_index}`);
      console.log(`   Shares: ${parseFloat(pos.shares).toFixed(2)}`);
      console.log(`   Cost basis: $${parseFloat(pos.cost_basis_usd || 0).toFixed(2)}`);
    });
  }

  // Step 2: Build redemption-based inferences
  console.log('\n\nStep 2: Building redemption-based winner inferences...\n');

  const inferWinners = `
    WITH redemption_stats AS (
      SELECT
        lower(replaceAll(tm.condition_id_norm, '0x', '')) as condition_id,
        tm.outcome_index,
        COUNT(*) as redemption_count,
        COUNT(DISTINCT r.from_address) as unique_redeemers,
        ROW_NUMBER() OVER (
          PARTITION BY condition_id
          ORDER BY COUNT(*) DESC
        ) as rank
      FROM default.erc1155_transfers r
      JOIN default.ctf_token_map tm ON lower(r.token_id) = lower(tm.token_id)
      WHERE lower(r.to_address) = lower('${POLYMARKET_OPERATOR}')
        AND tm.condition_id_norm IS NOT NULL
        AND tm.condition_id_norm != ''
      GROUP BY condition_id, tm.outcome_index
    )
    SELECT
      condition_id,
      outcome_index as inferred_winner,
      redemption_count,
      unique_redeemers,
      rank
    FROM redemption_stats
    WHERE rank = 1
    ORDER BY redemption_count DESC
  `;

  const inferResult = await client.query({ query: inferWinners, format: 'JSONEachRow' });
  const inferences = await inferResult.json();

  console.log(`Built ${inferences.length} redemption-based winner inferences\n`);

  // Step 3: Match wallet positions with inferences
  console.log('Step 3: Matching wallet positions with redemption inferences...\n');

  const matches: any[] = [];

  positions.forEach((pos: any) => {
    const inference = inferences.find((inf: any) =>
      inf.condition_id === pos.condition_id_norm
    );

    if (inference) {
      matches.push({
        condition_id: pos.condition_id_norm,
        wallet_outcome: pos.outcome_index,
        inferred_winner: inference.inferred_winner,
        shares: pos.shares,
        cost_basis: pos.cost_basis_usd,
        redemption_count: inference.redemption_count,
        unique_redeemers: inference.unique_redeemers,
        is_winner: pos.outcome_index === inference.inferred_winner
      });
    }
  });

  console.log(`Found ${matches.length} matches between wallet positions and redemption inferences!\n`);

  if (matches.length === 0) {
    console.log('❌ No matches found. This wallet\'s positions don\'t have redemption data.');
    console.log('\nPossible reasons:');
    console.log('1. Markets haven\'t resolved yet');
    console.log('2. No one has redeemed these positions');
    console.log('3. Token mappings are missing in ctf_token_map');
  } else {
    console.log('✅ SUCCESS! Found matches:\n');

    matches.forEach((match: any, i: number) => {
      console.log(`${i + 1}. Condition: ${match.condition_id.substring(0, 16)}...`);
      console.log(`   Wallet held: Outcome ${match.wallet_outcome}`);
      console.log(`   Inferred winner: Outcome ${match.inferred_winner}`);
      console.log(`   Result: ${match.is_winner ? '🏆 WIN' : '❌ LOSS'}`);
      console.log(`   Shares: ${parseFloat(match.shares).toFixed(2)}`);
      console.log(`   Cost basis: $${parseFloat(match.cost_basis || 0).toFixed(2)}`);
      console.log(`   Redemptions: ${match.redemption_count} (${match.unique_redeemers} unique)`);
      console.log('');
    });

    // Calculate impact
    const winningPositions = matches.filter(m => m.is_winner);
    const losingPositions = matches.filter(m => !m.is_winner);
    const totalCostBasis = matches.reduce((sum, m) => sum + parseFloat(m.cost_basis || 0), 0);

    console.log('\n=== IMPACT SUMMARY ===');
    console.log(`Positions resolved via redemption data: ${matches.length}`);
    console.log(`Winning positions: ${winningPositions.length}`);
    console.log(`Losing positions: ${losingPositions.length}`);
    console.log(`Total cost basis affected: $${totalCostBasis.toFixed(2)}`);
    console.log(`\nWin rate: ${(winningPositions.length / matches.length * 100).toFixed(1)}%`);
  }

  // Step 4: Coverage analysis
  console.log('\n\nStep 4: Overall coverage for this wallet...\n');

  const coverage = `
    SELECT
      COUNT(*) as total_positions,
      COUNT(DISTINCT condition_id_norm) as unique_conditions
    FROM cascadian_clean.vw_wallet_positions
    WHERE lower(wallet) LIKE lower('${PROBLEM_WALLET}%')
  `;

  const coverageResult = await client.query({ query: coverage, format: 'JSONEachRow' });
  const coverageData = await coverageResult.json();

  if (coverageData.length > 0) {
    const totalConditions = parseInt(coverageData[0].unique_conditions);
    const resolvedViaRedemptions = matches.length;
    const coveragePct = (resolvedViaRedemptions / totalConditions * 100).toFixed(2);

    console.log(`Total conditions for wallet: ${totalConditions}`);
    console.log(`Resolved via redemptions: ${resolvedViaRedemptions}`);
    console.log(`Coverage: ${coveragePct}%`);

    if (parseFloat(coveragePct) < 5) {
      console.log('\n⚠️  Low coverage detected.');
      console.log('Recommendation: Use additional resolution sources (API, price data, blockchain backfill)');
    } else if (parseFloat(coveragePct) >= 20) {
      console.log('\n✅ Good coverage! Redemption data is valuable for this wallet.');
    }
  }

  await client.close();
}

testOnProblemWallet().catch(console.error);
