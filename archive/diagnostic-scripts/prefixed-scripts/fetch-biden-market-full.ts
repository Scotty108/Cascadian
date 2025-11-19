import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const slug = "will-joe-biden-get-coronavirus-before-the-election";

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('FETCH BIDEN-COVID MARKET FULL DATA');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1. Fetch from Gamma (market metadata)
  console.log('1. Fetching from Gamma API...\n');
  const gammaUrl = `${GAMMA}/markets/${slug}`;
  console.log(`   URL: ${gammaUrl}`);

  const gammaResp = await fetch(gammaUrl);
  if (!gammaResp.ok) {
    throw new Error(`Gamma API failed: ${gammaResp.status} ${gammaResp.statusText}`);
  }

  const gammaData: any = await gammaResp.json();
  console.log(`   ✅ Fetched from Gamma\n`);

  console.log('   Market details:');
  console.log(`      Question: ${gammaData.question}`);
  console.log(`      Condition ID: ${gammaData.conditionId}`);
  console.log(`      Closed: ${gammaData.closed}`);
  console.log(`      Resolved: ${gammaData.resolved}`);
  console.log(`      End date: ${gammaData.endDate || gammaData.end_date || 'N/A'}`);
  console.log(`      Outcomes: ${gammaData.outcomes?.length || 0}\n`);

  if (gammaData.outcomes) {
    console.log('   Outcomes:');
    gammaData.outcomes.forEach((outcome: string, i: number) => {
      console.log(`      ${i}. ${outcome}`);
    });
    console.log();
  }

  // 2. Fetch from CLOB (resolution data if available)
  console.log('2. Fetching resolution from CLOB...\n');
  const clobUrl = `${CLOB}/markets/${gammaData.conditionId}`;
  console.log(`   URL: ${clobUrl}`);

  let clobData: any = null;
  try {
    const clobResp = await fetch(clobUrl);
    if (clobResp.ok) {
      clobData = await clobResp.json();
      console.log(`   ✅ Fetched from CLOB\n`);

      if (clobData.payoutNumerators) {
        console.log('   Resolution data:');
        console.log(`      Payout numerators: [${clobData.payoutNumerators.join(', ')}]`);
        console.log(`      Payout denominator: ${clobData.payout_denominator || 'N/A'}`);
        console.log(`      Winning outcome: ${clobData.outcome || 'N/A'}\n`);
      }
    } else {
      console.log(`   ⚠️  CLOB returned ${clobResp.status}, trying alternate format\n`);
    }
  } catch (error: any) {
    console.log(`   ⚠️  CLOB fetch failed: ${error.message}\n`);
  }

  // 3. Get tokens for each outcome
  console.log('3. Fetching token IDs...\n');

  if (gammaData.tokens) {
    console.log('   Token IDs:');
    gammaData.tokens.forEach((token: any, i: number) => {
      console.log(`      Outcome ${i}: ${token.token_id || token.tokenId}`);
      console.log(`         Outcome: ${token.outcome}`);
      console.log(`         Winner: ${token.winner !== undefined ? token.winner : 'N/A'}\n`);
    });
  }

  // 4. Try to find winning outcome
  console.log('4. Determining winner...\n');

  let winningIndex: number | null = null;
  let winningOutcome: string | null = null;

  if (gammaData.tokens) {
    const winnerToken = gammaData.tokens.find((t: any) => t.winner === true);
    if (winnerToken) {
      winningIndex = gammaData.tokens.indexOf(winnerToken);
      winningOutcome = winnerToken.outcome;
      console.log(`   ✅ Winner found: "${winningOutcome}" (index ${winningIndex})\n`);
    } else {
      console.log(`   ⚠️  No winner field set in tokens\n`);
    }
  }

  // If not in tokens, try outcome field
  if (winningOutcome === null && gammaData.outcome) {
    winningOutcome = gammaData.outcome;
    winningIndex = gammaData.outcomes?.indexOf(winningOutcome) ?? null;
    console.log(`   ✅ Winner from market.outcome: "${winningOutcome}" (index ${winningIndex})\n`);
  }

  // 5. Build insertion data
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('DATA FOR INSERTION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const insertData = {
    market_id: slug,
    condition_id: gammaData.conditionId,
    question: gammaData.question,
    outcomes: gammaData.outcomes || [],
    tokens: gammaData.tokens?.map((t: any) => ({
      token_id: t.token_id || t.tokenId,
      outcome: t.outcome,
      winner: t.winner,
    })) || [],
    closed: gammaData.closed,
    resolved: gammaData.resolved,
    end_date: gammaData.endDate || gammaData.end_date,
    winning_index: winningIndex,
    winning_outcome: winningOutcome,
    payout_numerators: clobData?.payoutNumerators || null,
    payout_denominator: clobData?.payout_denominator || null,
  };

  console.log('Market data:');
  console.log(JSON.stringify(insertData, null, 2));
  console.log();

  // Save to file
  const fs = require('fs');
  fs.writeFileSync('biden-market-full-data.json', JSON.stringify(insertData, null, 2));
  console.log('✅ Saved to biden-market-full-data.json\n');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('NEXT STEPS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (winningOutcome === null) {
    console.log('⚠️  WARNING: No winning outcome found');
    console.log('   Market may not be fully resolved yet');
    console.log('   Cannot calculate payout without resolution\n');
  }

  console.log('1. Insert into market_key_map');
  console.log('2. Insert into market_resolutions_by_market');
  console.log('3. Insert into market_resolutions_final (with payout vectors)');
  console.log('4. Update bridge to map CTFs to correct condition_id');
  console.log('5. Rebuild Phase 3 PPS');
  console.log('6. Rebuild Phase 4 burns valuation');
  console.log('7. Validate P&L\n');

  console.log('Run: npx tsx insert-biden-market.ts\n');

  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
