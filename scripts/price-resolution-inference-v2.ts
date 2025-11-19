/**
 * PRICE-BASED RESOLUTION INFERENCE V2
 * Theory: Resolved markets show clear price signals (winner→$1, loser→$0)
 * Uses correct tables: market_resolutions_final + condition_market_map + market_candles_5m
 */

import { createClient } from '@clickhouse/client';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function main() {
  console.log('=== PHASE 1: VALIDATE THEORY ON KNOWN RESOLUTIONS ===\n');

  // Step 1: Get markets with both resolution data AND price history
  console.log('Finding markets with resolution + price data...');

  const knownResolved = await client.query({
    query: `
      SELECT
        '0x' || r.condition_id_norm as condition_id,
        r.winning_index,
        r.payout_numerators,
        cm.market_id as market_id,
        COUNT(DISTINCT c.bucket) as candle_count,
        MAX(c.bucket) as last_candle_time
      FROM market_resolutions_final r
      JOIN condition_market_map cm
        ON r.condition_id_norm = lower(replaceAll(cm.condition_id, '0x', ''))
      JOIN market_candles_5m c
        ON cm.market_id = c.market_id
      WHERE r.winning_index >= 0
        AND length(r.payout_numerators) > 0
        AND c.bucket > now() - INTERVAL 90 DAY
      GROUP BY r.condition_id_norm, r.winning_index, r.payout_numerators, cm.market_id
      HAVING candle_count > 100
      ORDER BY candle_count DESC
      LIMIT 50
    `,
    format: 'JSONEachRow',
  });

  const markets = await knownResolved.json();
  console.log(`✓ Found ${markets.length} markets with resolution + price data\n`);

  if (markets.length > 0) {
    console.log('Sample market structure:');
    console.log(JSON.stringify(markets[0], null, 2));
  }

  if (markets.length === 0) {
    console.log('❌ No markets found with both resolutions and price data');
    console.log('This could mean:');
    console.log('1. market_id in condition_market_map does not match market_id in market_candles_5m');
    console.log('2. No recent price data (last 90 days)');
    console.log('3. Join conditions are incorrect\n');

    // Debug: Check a sample resolution and see if we can find its price data
    console.log('=== DEBUG: Checking sample resolution ===\n');
    const sampleResolution = await client.query({
      query: `
        SELECT
          '0x' || condition_id_norm as condition_id,
          winning_index
        FROM market_resolutions_final
        WHERE winning_index >= 0
        LIMIT 1
      `,
      format: 'JSONEachRow',
    });

    const sample = await sampleResolution.json();
    if (sample.length > 0) {
      const condId = sample[0].condition_id;
      console.log(`Sample condition_id: ${condId}`);

      // Check if it's in the mapping
      const mapping = await client.query({
        query: `
          SELECT market_id
          FROM condition_market_map
          WHERE condition_id = '${condId}'
        `,
        format: 'JSONEachRow',
      });

      const mappingData = await mapping.json();
      console.log('Mapping:', mappingData);

      if (mappingData.length > 0) {
        const marketId = mappingData[0].market_id;

        // Check if this market_id has price data
        const priceCheck = await client.query({
          query: `
            SELECT count() as candle_count
            FROM market_candles_5m
            WHERE market_id = '${marketId}'
          `,
          format: 'JSONEachRow',
        });

        const priceData = await priceCheck.json();
        console.log(`Price data for market_id ${marketId}:`, priceData);
      }
    }

    return;
  }

  // Step 2: For each market, check if final prices match the winner
  console.log('Analyzing final price patterns...\n');

  let correctPredictions = 0;
  let totalChecked = 0;
  const results = [];

  for (const market of markets.slice(0, 20)) {
    const marketId = market.market_id;
    const winnerIdx = market.winning_index;

    // Get final 24 hours of prices
    // Note: market_candles_5m does NOT have token_id, only market-level aggregated prices
    const priceData = await client.query({
      query: `
        SELECT
          avg(toFloat64OrDefault(close, 0.0)) as close_price,
          count() as sample_count
        FROM market_candles_5m
        WHERE market_id = '${marketId}'
          AND bucket > (
            SELECT max(bucket) - INTERVAL 24 HOUR
            FROM market_candles_5m
            WHERE market_id = '${marketId}'
          )
      `,
      format: 'JSONEachRow',
    });

    const prices = await priceData.json();

    if (prices.length > 0) {
      totalChecked++;
      const avgPrice = prices[0].close_price;

      // For binary markets:
      // - If winning_index = 0 (YES won), price should be near 1.0
      // - If winning_index = 1 (NO won), price should be near 0.0
      let expectedPrice = winnerIdx === 0 ? 1.0 : 0.0;
      let deviation = Math.abs(avgPrice - expectedPrice);
      let correct = deviation < 0.10; // Within 10 cents

      if (correct) correctPredictions++;

      results.push({
        market_id: marketId.slice(0, 10) + '...',
        winner_index: winnerIdx,
        final_price: avgPrice.toFixed(4),
        expected: expectedPrice.toFixed(1),
        deviation: deviation.toFixed(4),
        correct: correct ? '✓' : '✗',
      });
    }
  }

  console.log('Sample Results:');
  console.table(results.slice(0, 10));

  const accuracy = totalChecked > 0 ? (correctPredictions / totalChecked * 100) : 0;
  console.log(`\n📊 VALIDATION RESULTS:`);
  console.log(`   Correct predictions: ${correctPredictions}/${totalChecked}`);
  console.log(`   Accuracy: ${accuracy.toFixed(1)}%`);
  console.log(`   Theory ${accuracy > 80 ? '✓ VALIDATED' : '✗ NEEDS REFINEMENT'}\n`);

  // Step 3: Check coverage potential
  console.log('\n=== PHASE 2: COVERAGE POTENTIAL ===\n');

  const coverage = await client.query({
    query: `
      WITH
      -- Markets with resolutions
      resolved_markets AS (
        SELECT DISTINCT
          lower(replaceAll(cm.market_id, '0x', '')) as market_id_norm
        FROM market_resolutions_final r
        JOIN condition_market_map cm
          ON r.condition_id_norm = lower(replaceAll(cm.condition_id, '0x', ''))
        WHERE r.winning_index >= 0
      ),
      -- Markets with price data
      priced_markets AS (
        SELECT DISTINCT
          lower(replaceAll(market_id, '0x', '')) as market_id_norm
        FROM market_candles_5m
        WHERE market_id != ''
      ),
      -- Markets with clear price signals (near 0 or 1)
      clear_signals AS (
        SELECT DISTINCT
          lower(replaceAll(market_id, '0x', '')) as market_id_norm
        FROM market_candles_5m
        WHERE toFloat64OrDefault(close, 0.5) > 0.95
           OR toFloat64OrDefault(close, 0.5) < 0.05
      )
      SELECT
        (SELECT count() FROM resolved_markets) as resolved_count,
        (SELECT count() FROM priced_markets) as priced_count,
        (SELECT count() FROM clear_signals) as clear_signal_count,
        round((SELECT count() FROM clear_signals) * 100.0 / (SELECT count() FROM priced_markets), 2) as pct_with_clear_signals
    `,
    format: 'JSONEachRow',
  });

  const coverageData = await coverage.json();
  console.log('Coverage Analysis:');
  console.table(coverageData);

  // Step 4: Test on problem wallet
  console.log('\n=== PHASE 3: PROBLEM WALLET TEST ===\n');

  const problemWallet = '0x4ce75b601de81ce6551abfeb00e5df45755dfd8c';

  const walletMarkets = await client.query({
    query: `
      WITH wallet_conditions AS (
        SELECT DISTINCT
          lower(replaceAll(condition_id, '0x', '')) as cid_norm
        FROM erc1155_transfers_unique
        WHERE lower(wallet_address) = lower('${problemWallet}')
      ),
      unresolved AS (
        SELECT wc.cid_norm
        FROM wallet_conditions wc
        LEFT JOIN market_resolutions_final r
          ON wc.cid_norm = r.condition_id_norm
        WHERE r.condition_id_norm IS NULL
        LIMIT 30
      )
      SELECT
        '0x' || u.cid_norm as condition_id,
        cm.market_id,
        count(DISTINCT c.bucket) as candle_count
      FROM unresolved u
      JOIN condition_market_map cm
        ON u.cid_norm = lower(replaceAll(cm.condition_id, '0x', ''))
      JOIN market_candles_5m c
        ON cm.market_id = c.market_id
      GROUP BY u.cid_norm, cm.market_id
      HAVING candle_count > 20
      ORDER BY candle_count DESC
    `,
    format: 'JSONEachRow',
  });

  const walletMarketsData = await walletMarkets.json();
  console.log(`Found ${walletMarketsData.length} unresolved markets with price data for wallet\n`);

  const walletInferences = [];
  for (const market of walletMarketsData.slice(0, 10)) {
    const priceData = await client.query({
      query: `
        SELECT
          avg(toFloat64OrDefault(close, 0.0)) as avg_price
        FROM market_candles_5m
        WHERE market_id = '${market.market_id}'
          AND bucket > (
            SELECT max(bucket) - INTERVAL 24 HOUR
            FROM market_candles_5m
            WHERE market_id = '${market.market_id}'
          )
      `,
      format: 'JSONEachRow',
    });

    const prices = await priceData.json();

    if (prices.length > 0) {
      const price = prices[0].avg_price;
      let inferredWinner = -1;
      let confidence = 0;
      let signal_quality = 'UNCLEAR';

      if (price > 0.95) {
        inferredWinner = 0; // YES won
        confidence = price;
        signal_quality = 'CLEAR';
      } else if (price < 0.05) {
        inferredWinner = 1; // NO won
        confidence = 1.0 - price;
        signal_quality = 'CLEAR';
      } else if (price > 0.90) {
        inferredWinner = 0;
        confidence = price;
        signal_quality = 'MODERATE';
      } else if (price < 0.10) {
        inferredWinner = 1;
        confidence = 1.0 - price;
        signal_quality = 'MODERATE';
      }

      walletInferences.push({
        condition_id: market.condition_id.slice(0, 12) + '...',
        inferred_outcome: inferredWinner,
        confidence: confidence.toFixed(4),
        signal: signal_quality,
        final_price: price.toFixed(4),
      });
    }
  }

  console.log('Wallet Resolution Inferences:');
  console.table(walletInferences);

  const clearSignals = walletInferences.filter(w => w.signal === 'CLEAR').length;
  console.log(`\n📈 Results: ${clearSignals}/${walletInferences.length} markets have clear resolution signals\n`);

  console.log('\n=== SUMMARY ===\n');
  console.log(`1. Theory Validation: ${accuracy.toFixed(1)}% accuracy on known resolutions`);
  console.log(`2. Coverage Potential: ${coverageData[0]?.pct_with_clear_signals || 0}% of markets have clear signals`);
  console.log(`3. Problem Wallet: ${clearSignals}/${walletInferences.length} markets recoverable`);

  console.log('\n🎯 NEXT STEPS:');
  console.log('   - If accuracy > 80%, proceed with price-based inference');
  console.log('   - Build view to infer resolutions from final prices');
  console.log('   - Insert high-confidence inferences (>95%) into resolution tables\n');
}

main()
  .catch(console.error)
  .finally(() => client.close());
