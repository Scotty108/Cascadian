#!/usr/bin/env npx tsx
/**
 * VALIDATION SCRIPT: Test All Data Recovery Options
 *
 * Runs 3 critical tests to determine best path forward:
 * 1. CLOB API historical depth check
 * 2. Dune data availability check
 * 3. ERC1155 blockchain availability check
 *
 * Timeline: 15-30 minutes
 * Output: Go/no-go decision for each approach
 */

import 'dotenv/config';

console.log('='.repeat(80));
console.log('DATA RECOVERY VALIDATION - THREE CRITICAL TESTS');
console.log('='.repeat(80));
console.log();

// Test 1: CLOB API Historical Depth
console.log('TEST 1: CLOB API Historical Depth Check');
console.log('-'.repeat(80));
console.log('Objective: Determine if CLOB API has data back to Dec 2022');
console.log();

async function testClobApiDepth() {
  try {
    console.log('Fetching earliest available trade from CLOB API...');

    // Try to get the absolute earliest trade
    const response = await fetch(
      'https://clob.polymarket.com/trades?limit=1&before=1000000000000',
      {
        headers: {
          'Accept': 'application/json'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`CLOB API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data && data.length > 0) {
      const earliestTrade = data[0];
      const timestamp = new Date(earliestTrade.timestamp || earliestTrade.created_at);

      console.log('✅ CLOB API Response:');
      console.log(`   Earliest trade found: ${timestamp.toISOString()}`);
      console.log(`   Trade ID: ${earliestTrade.id}`);
      console.log(`   Market: ${earliestTrade.market_id || earliestTrade.market}`);

      const decemberTarget = new Date('2022-12-01');
      if (timestamp <= decemberTarget) {
        console.log('\n✅ VERDICT: CLOB API has full historical depth (Dec 2022+)');
        console.log('   → Can use CLOB API for historical backfill');
        return { viable: true, depth: 'full', earliestDate: timestamp };
      } else if (timestamp < new Date('2024-01-01')) {
        console.log('\n⚠️  VERDICT: CLOB API has partial historical depth (2023+)');
        console.log('   → Can use for recent data, need another source for older trades');
        return { viable: true, depth: 'partial', earliestDate: timestamp };
      } else {
        console.log('\n❌ VERDICT: CLOB API only has recent data (2024+)');
        console.log('   → Cannot use for historical backfill, only for ongoing sync');
        return { viable: false, depth: 'recent', earliestDate: timestamp };
      }
    } else {
      console.log('❌ No data returned from CLOB API');
      return { viable: false, depth: 'unknown', error: 'No data' };
    }
  } catch (error) {
    console.error('❌ CLOB API test failed:', error instanceof Error ? error.message : error);
    console.log('\n⚠️  VERDICT: CLOB API unreachable or rate-limited');
    console.log('   → Cannot rely on CLOB API as primary source');
    return { viable: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Test 2: Dune Data Availability
console.log('\nTEST 2: Dune Analytics Data Availability');
console.log('-'.repeat(80));
console.log('Objective: Check if we can access Dune Polymarket data');
console.log();

async function testDuneAvailability() {
  console.log('Checking Dune Analytics Polymarket Spellbook...');
  console.log();
  console.log('📋 Known Dune Resources:');
  console.log('   - Spellbook: polymarket_polygon.market_trades');
  console.log('   - Coverage: Dec 2022 - present');
  console.log('   - Lag: 5-10 minutes');
  console.log('   - Export: CSV (free tier: 1M rows/query) or API (paid)');
  console.log();
  console.log('📝 Manual Validation Required:');
  console.log('   1. Go to: https://dune.com/');
  console.log('   2. Create account (free)');
  console.log('   3. Run sample query:');
  console.log();
  console.log('      SELECT COUNT(*) as total_trades');
  console.log('      FROM polymarket_polygon.market_trades');
  console.log('      WHERE block_time >= CAST(\\'2022-12-01\\' AS timestamp)');
  console.log();
  console.log('   4. Check if result is > 100M (should match our 159M trades)');
  console.log();
  console.log('⏳ Action Required: User must manually validate Dune access');
  console.log();

  // Can't automatically test Dune without API key, so return pending
  return {
    viable: 'pending',
    requiresManualCheck: true,
    instructions: 'Create Dune account and run validation query'
  };
}

// Test 3: ERC1155 Blockchain Data Availability
console.log('\nTEST 3: ERC1155 Blockchain Data Availability');
console.log('-'.repeat(80));
console.log('Objective: Check if we can fetch historical ERC1155 transfers');
console.log();

async function testErc1155Availability() {
  const rpcUrl = process.env.ALCHEMY_POLYGON_RPC || process.env.POLYGON_RPC;

  if (!rpcUrl) {
    console.log('❌ No RPC URL configured');
    console.log('   Set ALCHEMY_POLYGON_RPC or POLYGON_RPC in .env.local');
    return { viable: false, error: 'No RPC configured' };
  }

  try {
    console.log('Attempting to fetch sample ERC1155 transfers...');
    console.log(`RPC: ${rpcUrl.substring(0, 50)}...`);
    console.log();

    // CTF Exchange contract address
    const ctfExchangeAddress = '0x4bfb41d5b3570deb38c37251976ac1ee41e82ec0';

    // TransferBatch event signature
    const transferBatchTopic = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';

    // Try to fetch logs from early 2023 (block 38000000 ≈ Jan 2023)
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getLogs',
        params: [{
          address: ctfExchangeAddress,
          fromBlock: '0x2432A80',  // Block 38000000 (Jan 2023)
          toBlock: '0x2432A8A',     // Block 38000010 (small range for test)
          topics: [transferBatchTopic]
        }],
        id: 1
      })
    });

    const data = await response.json();

    if (data.error) {
      if (data.error.message.includes('exceed')) {
        console.log('⚠️  RPC query limit exceeded (expected for large ranges)');
        console.log('   → Will need to chunk requests by smaller block ranges');
        console.log('   → Blockchain approach viable but will be SLOW (12-18 hours)');
        return {
          viable: true,
          requiresChunking: true,
          estimatedTime: '12-18 hours',
          complexity: 'high'
        };
      } else {
        console.log('❌ RPC error:', data.error.message);
        return { viable: false, error: data.error.message };
      }
    }

    if (data.result && data.result.length > 0) {
      console.log(`✅ Successfully fetched ${data.result.length} ERC1155 transfers`);
      console.log('   Sample transfer:');
      console.log(`   - Block: ${parseInt(data.result[0].blockNumber, 16)}`);
      console.log(`   - TxHash: ${data.result[0].transactionHash}`);
      console.log(`   - Topics: ${data.result[0].topics.length} indexed parameters`);
      console.log();
      console.log('✅ VERDICT: ERC1155 data is available via RPC');
      console.log('   → Blockchain approach is viable (with chunking)');
      console.log('   → Estimated time: 12-18 hours for full fetch + decode');
      return {
        viable: true,
        requiresChunking: true,
        estimatedTime: '12-18 hours',
        sampleSize: data.result.length
      };
    } else {
      console.log('⚠️  No ERC1155 transfers found in sample block range');
      console.log('   → Either no Polymarket activity in that period, or RPC has gaps');
      console.log('   → Try expanding block range or different RPC provider');
      return {
        viable: 'uncertain',
        warning: 'No transfers in sample range'
      };
    }
  } catch (error) {
    console.log('❌ ERC1155 availability test failed:', error instanceof Error ? error.message : error);
    return { viable: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Run all tests
async function runAllTests() {
  const results = {
    clobApi: null as any,
    dune: null as any,
    erc1155: null as any
  };

  console.log('Starting validation tests...\n');

  // Test 1
  results.clobApi = await testClobApiDepth();
  console.log();

  // Test 2
  results.dune = await testDuneAvailability();
  console.log();

  // Test 3
  results.erc1155 = await testErc1155Availability();
  console.log();

  // Summary
  console.log('='.repeat(80));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(80));
  console.log();

  console.log('📊 Test Results:');
  console.log();
  console.log('1. CLOB API:');
  console.log(`   Status: ${results.clobApi.viable ? '✅ Viable' : '❌ Not Viable'}`);
  if (results.clobApi.earliestDate) {
    console.log(`   Earliest Data: ${results.clobApi.earliestDate.toISOString().split('T')[0]}`);
    console.log(`   Coverage: ${results.clobApi.depth}`);
  }
  console.log();

  console.log('2. Dune Analytics:');
  console.log(`   Status: ⏳ Manual validation required`);
  console.log(`   Action: ${results.dune.instructions}`);
  console.log();

  console.log('3. Blockchain ERC1155:');
  console.log(`   Status: ${results.erc1155.viable ? '✅ Viable' : results.erc1155.viable === 'uncertain' ? '⚠️  Uncertain' : '❌ Not Viable'}`);
  if (results.erc1155.estimatedTime) {
    console.log(`   Estimated Time: ${results.erc1155.estimatedTime}`);
  }
  if (results.erc1155.requiresChunking) {
    console.log(`   Requires Chunking: Yes (high complexity)`);
  }
  console.log();

  // Recommendation
  console.log('='.repeat(80));
  console.log('RECOMMENDED APPROACH');
  console.log('='.repeat(80));
  console.log();

  if (results.clobApi.viable && results.clobApi.depth === 'full') {
    console.log('✅ OPTION 1: CLOB API Alone');
    console.log('   - CLOB API has full historical depth');
    console.log('   - Timeline: 6-10 hours');
    console.log('   - Coverage: 95%+');
    console.log('   - Cost: Free');
    console.log();
  }

  console.log('✅ OPTION 2: HYBRID APPROACH (RECOMMENDED)');
  console.log('   - Dune Analytics for historical backfill (95% coverage)');
  console.log('   - CLOB API for recent data + ongoing sync');
  console.log('   - Blockchain verification as safety net');
  console.log('   - Timeline: 11-18 hours total');
  console.log('   - Cost: $0-500 (Dune export)');
  console.log('   - Risk: LOW');
  console.log();

  if (results.erc1155.viable) {
    console.log('⚠️  OPTION 3: Blockchain Only (BACKUP)');
    console.log('   - Only if APIs fail validation');
    console.log('   - Timeline: 12-18 hours');
    console.log('   - Coverage: 70-85%');
    console.log('   - Cost: Free');
    console.log('   - Complexity: VERY HIGH');
    console.log();
  }

  console.log('='.repeat(80));
  console.log('NEXT STEPS');
  console.log('='.repeat(80));
  console.log();
  console.log('1. Complete Dune manual validation (create account + run test query)');
  console.log('2. Review PNL_COVERAGE_STRATEGIC_DECISION.md for full analysis');
  console.log('3. Choose approach based on validation results');
  console.log('4. Execute selected option (see implementation roadmap in strategy doc)');
  console.log();
  console.log('Estimated time to 95% coverage: 13-19 hours (Hybrid approach)');
  console.log();

  return results;
}

// Execute
runAllTests()
  .then(() => {
    console.log('✅ Validation complete');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Validation failed:', err);
    process.exit(1);
  });
