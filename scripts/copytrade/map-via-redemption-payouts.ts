/**
 * Map tokens via REDEMPTION PAYOUTS
 *
 * Key insight: When a market resolves, winners can redeem for $1/share.
 * By looking at actual redemption events, we can determine:
 * - Which token got paid out = the WINNING outcome
 * - Match with payout_numerators to determine outcome_index
 *
 * This works even for deleted markets!
 */
import { config } from 'dotenv';
config({ path: '.env.local' });
import { clickhouse } from '@/lib/clickhouse/client';
import * as fs from 'fs';

async function main() {
  console.log('=== MAP TOKENS VIA REDEMPTION PAYOUTS ===\n');

  // Step 1: Get unmapped tokens with their conditions
  console.log('Step 1: Finding unmapped tokens with conditions...');

  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_redemption_unmapped` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_redemption_txhash` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_redemption_conditions` });

  await clickhouse.command({ query: `
    CREATE TABLE tmp_redemption_unmapped ENGINE = MergeTree() ORDER BY token_id AS
    WITH all_tokens AS (
      SELECT DISTINCT token_id FROM pm_trader_events_v2
      WHERE is_deleted = 0
        AND trade_time >= now() - INTERVAL 60 DAY
    ),
    mapped AS (
      SELECT token_id_dec as token_id FROM pm_token_to_condition_map_v5
      UNION ALL
      SELECT token_id_dec as token_id FROM pm_token_to_condition_patch
    )
    SELECT a.token_id
    FROM all_tokens a
    LEFT JOIN mapped m ON a.token_id = m.token_id
    WHERE m.token_id IS NULL OR m.token_id = ''
  `});

  const unmappedCountQ = `SELECT count() as cnt FROM tmp_redemption_unmapped`;
  const unmappedCountR = await clickhouse.query({ query: unmappedCountQ, format: 'JSONEachRow' });
  const { cnt: unmappedCount } = (await unmappedCountR.json() as any[])[0];
  console.log(`  Found ${unmappedCount} unmapped tokens\n`);

  // Step 2: Get tx_hashes
  console.log('Step 2: Finding tx_hashes...');

  await clickhouse.command({ query: `
    CREATE TABLE tmp_redemption_txhash ENGINE = MergeTree() ORDER BY token_id AS
    SELECT token_id, any(lower(concat('0x', hex(transaction_hash)))) as tx_hash
    FROM pm_trader_events_v2
    WHERE token_id IN (SELECT token_id FROM tmp_redemption_unmapped) AND is_deleted = 0
    GROUP BY token_id
  `});

  // Step 3: Get conditions via CTF splits
  console.log('Step 3: Finding conditions via tx_hash...');

  await clickhouse.command({ query: `
    CREATE TABLE tmp_redemption_conditions ENGINE = MergeTree() ORDER BY condition_id AS
    SELECT DISTINCT lower(tx_hash) as tx_hash, condition_id
    FROM pm_ctf_events
    WHERE event_type = 'PositionSplit' AND is_deleted = 0
    AND lower(tx_hash) IN (SELECT tx_hash FROM tmp_redemption_txhash)
  `});

  const condCountQ = `SELECT countDistinct(condition_id) as cnt FROM tmp_redemption_conditions`;
  const condCountR = await clickhouse.query({ query: condCountQ, format: 'JSONEachRow' });
  const { cnt: condCount } = (await condCountR.json() as any[])[0];
  console.log(`  Found ${condCount} unique conditions\n`);

  // Step 4: Get token → condition pairs
  console.log('Step 4: Loading token → condition pairs...');

  const pairsQ = `
    SELECT t.token_id, c.condition_id
    FROM tmp_redemption_txhash t
    JOIN tmp_redemption_conditions c ON t.tx_hash = c.tx_hash
  `;
  const pairsR = await clickhouse.query({ query: pairsQ, format: 'JSONEachRow' });
  const pairs = await pairsR.json() as any[];

  // Group by condition
  const conditionToTokens = new Map<string, Set<string>>();
  for (const p of pairs) {
    if (!conditionToTokens.has(p.condition_id)) {
      conditionToTokens.set(p.condition_id, new Set());
    }
    conditionToTokens.get(p.condition_id)!.add(p.token_id);
  }

  console.log(`  ${pairs.length} token-condition pairs`);
  console.log(`  ${conditionToTokens.size} unique conditions\n`);

  // Step 5: Get redemption events with payouts
  console.log('Step 5: Getting redemption payout data...');

  // PayoutRedemption events show which tokens were redeemed and how much was paid
  // The amount paid divided by shares = payout per share
  // Winner tokens pay ~$1/share, loser tokens pay $0
  const redemptionQ = `
    SELECT
      condition_id,
      -- Extract token IDs from the redemption event
      -- CTF events have index_sets which correspond to tokens
      index_sets,
      amounts,
      payout
    FROM pm_ctf_events
    WHERE event_type = 'PayoutRedemption'
      AND is_deleted = 0
      AND condition_id IN (SELECT DISTINCT condition_id FROM tmp_redemption_conditions)
    LIMIT 1000
  `;

  const redemptionR = await clickhouse.query({ query: redemptionQ, format: 'JSONEachRow' });
  const redemptions = await redemptionR.json() as any[];
  console.log(`  Found ${redemptions.length} redemption events\n`);

  // Step 6: Check pm_resolutions for payout info
  console.log('Step 6: Getting resolution payout numerators...');

  const resQ = `
    SELECT
      condition_id,
      payout_numerators,
      resolution_timestamp
    FROM pm_resolutions
    WHERE is_deleted = 0
      AND condition_id IN (SELECT DISTINCT condition_id FROM tmp_redemption_conditions)
  `;
  const resR = await clickhouse.query({ query: resQ, format: 'JSONEachRow' });
  const resolutions = await resR.json() as any[];

  const resolutionMap = new Map<string, { payouts: number[], timestamp: any }>();
  for (const r of resolutions) {
    try {
      // Parse payout_numerators like "[1000000000000000000,0]"
      const payouts = JSON.parse(r.payout_numerators);
      resolutionMap.set(r.condition_id, {
        payouts: payouts.map((p: string) => BigInt(p)),
        timestamp: r.resolution_timestamp
      });
    } catch {}
  }

  console.log(`  Found ${resolutions.length} resolved conditions\n`);

  // Step 7: Infer token → outcome using CTF token ID formula
  // In Polymarket/CTF, for binary markets:
  // - outcome 0 token uses indexSet = 1 (binary 01)
  // - outcome 1 token uses indexSet = 2 (binary 10)
  // The tokenId for outcome i = positionId(collateral, condition, indexSet)

  // Alternative approach: Look at which token was TRADED when the winner outcome happened
  // Actually, let's try checking the ERC1155 transfer data for redemptions

  console.log('Step 7: Checking ERC1155 redemption transfers...');

  // Get ERC1155 transfers that are redemptions (to address 0 = burn)
  const burnQ = `
    SELECT
      lower(token_id) as token_id,
      sum(value) / 1e6 as total_burned,
      count() as burn_count
    FROM pm_erc1155_transfers
    WHERE is_deleted = 0
      AND to_address = '0x0000000000000000000000000000000000000000'
      AND token_id IN (SELECT token_id FROM tmp_redemption_unmapped)
    GROUP BY token_id
    HAVING total_burned > 0
  `;

  const burnR = await clickhouse.query({ query: burnQ, format: 'JSONEachRow' });
  const burns = await burnR.json() as any[];
  console.log(`  Found ${burns.length} tokens with burn (redemption) data\n`);

  // Create a map of tokens that were burned (redeemed)
  const burnedTokens = new Map<string, number>();
  for (const b of burns) {
    burnedTokens.set(b.token_id, parseFloat(b.total_burned));
  }

  // Step 8: Derive mappings using burn data
  console.log('Step 8: Deriving outcome mappings...');

  const derivedMappings: Array<{
    token_id_dec: string;
    condition_id: string;
    outcome_index: number;
    confidence: string;
  }> = [];

  let binaryResolved = 0;
  let binaryUnresolved = 0;
  let singleToken = 0;
  let multiOutcome = 0;
  let burnBased = 0;
  let sortBased = 0;

  for (const [conditionId, tokens] of conditionToTokens.entries()) {
    const tokenArray = Array.from(tokens);

    if (tokenArray.length !== 2) {
      if (tokenArray.length === 1) singleToken++;
      else multiOutcome++;
      continue;
    }

    const resolution = resolutionMap.get(conditionId);

    if (!resolution) {
      binaryUnresolved++;
      continue;
    }

    binaryResolved++;

    // Check if we have burn data for these tokens
    const burn0 = burnedTokens.get(tokenArray[0]) || 0;
    const burn1 = burnedTokens.get(tokenArray[1]) || 0;

    // Determine which outcome won
    const payouts = resolution.payouts;
    const outcome0Wins = payouts[0] > payouts[1];

    let token0Outcome: number;
    let token1Outcome: number;
    let confidence: string;

    if (burn0 > 0 && burn1 === 0) {
      // Token 0 was burned (redeemed) but not token 1
      // Token 0 is the winner
      if (outcome0Wins) {
        // Outcome 0 won, token 0 = outcome 0
        token0Outcome = 0;
        token1Outcome = 1;
      } else {
        // Outcome 1 won, token 0 = outcome 1
        token0Outcome = 1;
        token1Outcome = 0;
      }
      confidence = 'burn_verified';
      burnBased++;
    } else if (burn1 > 0 && burn0 === 0) {
      // Token 1 was burned but not token 0
      // Token 1 is the winner
      if (outcome0Wins) {
        token0Outcome = 1;
        token1Outcome = 0;
      } else {
        token0Outcome = 0;
        token1Outcome = 1;
      }
      confidence = 'burn_verified';
      burnBased++;
    } else {
      // Both or neither were burned - fall back to sorted order
      const sorted = tokenArray.sort((a, b) => {
        const aBig = BigInt(a);
        const bBig = BigInt(b);
        return aBig < bBig ? -1 : aBig > bBig ? 1 : 0;
      });
      // Assume smaller token = outcome 0 (35% accurate, but better than nothing)
      token0Outcome = tokenArray[0] === sorted[0] ? 0 : 1;
      token1Outcome = tokenArray[0] === sorted[0] ? 1 : 0;
      confidence = 'sorted_fallback';
      sortBased++;
    }

    derivedMappings.push({
      token_id_dec: tokenArray[0],
      condition_id: conditionId,
      outcome_index: token0Outcome,
      confidence
    });
    derivedMappings.push({
      token_id_dec: tokenArray[1],
      condition_id: conditionId,
      outcome_index: token1Outcome,
      confidence
    });
  }

  console.log(`  Binary resolved: ${binaryResolved}`);
  console.log(`  Binary unresolved: ${binaryUnresolved}`);
  console.log(`  Single-token: ${singleToken}`);
  console.log(`  Multi-outcome: ${multiOutcome}`);
  console.log(`  Burn-verified mappings: ${burnBased * 2}`);
  console.log(`  Sort-fallback mappings: ${sortBased * 2}`);
  console.log(`  Total mappings: ${derivedMappings.length}\n`);

  // Step 9: Export
  console.log('Step 9: Exporting...');

  // Create exports directory if needed
  if (!fs.existsSync('exports')) {
    fs.mkdirSync('exports');
  }

  // CSV
  let csv = 'token_id_dec,condition_id,outcome_index,confidence\n';
  for (const m of derivedMappings) {
    csv += `${m.token_id_dec},${m.condition_id},${m.outcome_index},${m.confidence}\n`;
  }
  fs.writeFileSync('exports/redemption_derived_mappings.csv', csv);

  // SQL insert (for review before applying) - ONLY burn_verified
  const verifiedMappings = derivedMappings.filter(m => m.confidence === 'burn_verified');
  if (verifiedMappings.length > 0) {
    const BATCH_SIZE = 10000;
    for (let i = 0; i < verifiedMappings.length; i += BATCH_SIZE) {
      const batch = verifiedMappings.slice(i, i + BATCH_SIZE);
      const values = batch.map(m =>
        `('${m.token_id_dec}', '${m.condition_id}', ${m.outcome_index}, 'redemption_verified')`
      ).join(',\n');

      const sql = `INSERT INTO pm_token_to_condition_patch (token_id_dec, condition_id, outcome_index, source) VALUES\n${values};`;
      fs.writeFileSync(`exports/redemption_verified_batch_${Math.floor(i / BATCH_SIZE)}.sql`, sql);
    }
    console.log(`  Exported ${verifiedMappings.length} VERIFIED mappings`);
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Unmapped tokens: ${unmappedCount}`);
  console.log(`Conditions found: ${conditionToTokens.size}`);
  console.log(`Resolved conditions: ${resolutions.length}`);
  console.log(`Total mappings derived: ${derivedMappings.length}`);
  console.log(`  - Burn-verified (HIGH confidence): ${burnBased * 2}`);
  console.log(`  - Sort-fallback (LOW confidence): ${sortBased * 2}`);

  const verifiedCoverage = ((burnBased * 2 / parseInt(unmappedCount)) * 100).toFixed(1);
  console.log(`\nVerified coverage: ${verifiedCoverage}%`);

  // Cleanup
  console.log('\nCleaning up...');
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_redemption_unmapped` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_redemption_txhash` });
  await clickhouse.command({ query: `DROP TABLE IF EXISTS tmp_redemption_conditions` });
  console.log('Done');
}

main().catch(console.error);
