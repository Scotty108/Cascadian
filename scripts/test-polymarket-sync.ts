/**
 * Test Script for Polymarket Integration
 *
 * Tests:
 * 1. Sync endpoint (triggers data sync)
 * 2. Database verification (markets inserted)
 * 3. Sync logs verification
 * 4. Markets API endpoint
 * 5. Error handling
 */

import { supabaseAdmin } from '../lib/supabase';

// ============================================================================
// Configuration
// ============================================================================

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';
const ADMIN_KEY = process.env.ADMIN_API_KEY || process.env.CRON_SECRET;

// ============================================================================
// Test Utilities
// ============================================================================

function logTest(name: string) {
  console.log('\n' + '='.repeat(60));
  console.log(`TEST: ${name}`);
  console.log('='.repeat(60));
}

function logSuccess(message: string) {
  console.log('✅', message);
}

function logError(message: string) {
  console.log('❌', message);
}

function logInfo(message: string) {
  console.log('ℹ️ ', message);
}

// ============================================================================
// Test 1: Trigger Sync
// ============================================================================

async function testSyncEndpoint(): Promise<boolean> {
  logTest('Trigger Sync Endpoint');

  try {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (ADMIN_KEY) {
      headers['Authorization'] = `Bearer ${ADMIN_KEY}`;
    }

    const response = await fetch(`${BASE_URL}/api/polymarket/sync`, {
      method: 'POST',
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      logError(`Sync failed: ${data.error}`);
      return false;
    }

    logSuccess(`Sync completed`);
    logInfo(`Markets synced: ${data.markets_synced}`);
    logInfo(`Duration: ${data.duration_ms}ms`);
    logInfo(`Errors: ${data.errors}`);

    if (data.errors > 0) {
      logError('Sync completed with errors:');
      data.error_details?.forEach((err: { error: string }) => {
        console.log(`  - ${err.error}`);
      });
      return false;
    }

    return true;

  } catch (error) {
    logError(`Exception: ${error}`);
    return false;
  }
}

// ============================================================================
// Test 2: Verify Database
// ============================================================================

async function testDatabaseVerification(): Promise<boolean> {
  logTest('Verify Markets in Database');

  try {
    // Count markets
    const { count: totalCount, error: countError } = await supabaseAdmin
      .from('markets')
      .select('*', { count: 'exact', head: true });

    if (countError) {
      logError(`Count query failed: ${countError.message}`);
      return false;
    }

    logSuccess(`Total markets in database: ${totalCount}`);

    if (totalCount === 0) {
      logError('No markets found in database');
      return false;
    }

    // Get sample markets
    const { data: sampleMarkets, error: sampleError } = await supabaseAdmin
      .from('markets')
      .select('market_id, title, category, volume_24h, active')
      .order('volume_24h', { ascending: false })
      .limit(5);

    if (sampleError) {
      logError(`Sample query failed: ${sampleError.message}`);
      return false;
    }

    logSuccess(`Sample markets (top 5 by volume):`);
    sampleMarkets?.forEach((market, i) => {
      console.log(`  ${i + 1}. [${market.category}] ${market.title}`);
      console.log(`     Volume: $${market.volume_24h?.toFixed(2)} | Active: ${market.active}`);
    });

    // Check for recent updates
    const { data: recentUpdate, error: updateError } = await supabaseAdmin
      .from('markets')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (updateError) {
      logError(`Update check failed: ${updateError.message}`);
      return false;
    }

    const updateAge = Date.now() - new Date(recentUpdate.updated_at).getTime();
    const ageMinutes = Math.floor(updateAge / 1000 / 60);

    logSuccess(`Latest update: ${ageMinutes} minutes ago`);

    return true;

  } catch (error) {
    logError(`Exception: ${error}`);
    return false;
  }
}

// ============================================================================
// Test 3: Verify Sync Logs
// ============================================================================

async function testSyncLogs(): Promise<boolean> {
  logTest('Verify Sync Logs');

  try {
    const { data: logs, error } = await supabaseAdmin
      .from('sync_logs')
      .select('*')
      .order('sync_started_at', { ascending: false })
      .limit(5);

    if (error) {
      logError(`Sync logs query failed: ${error.message}`);
      return false;
    }

    if (!logs || logs.length === 0) {
      logError('No sync logs found');
      return false;
    }

    logSuccess(`Found ${logs.length} recent sync logs`);

    logs.forEach((log, i) => {
      const duration = log.sync_completed_at
        ? new Date(log.sync_completed_at).getTime() - new Date(log.sync_started_at).getTime()
        : 0;

      console.log(`\n  Sync ${i + 1}:`);
      console.log(`    Status: ${log.status}`);
      console.log(`    Markets: ${log.markets_synced}`);
      console.log(`    Duration: ${duration}ms`);
      if (log.error_message) {
        console.log(`    Error: ${log.error_message}`);
      }
    });

    return true;

  } catch (error) {
    logError(`Exception: ${error}`);
    return false;
  }
}

// ============================================================================
// Test 4: Markets API Endpoint
// ============================================================================

async function testMarketsAPI(): Promise<boolean> {
  logTest('Markets API Endpoint');

  try {
    // Test 1: Get all markets
    logInfo('Test 1: Get all markets (limit 10)');
    const response1 = await fetch(`${BASE_URL}/api/polymarket/markets?limit=10`);
    const data1 = await response1.json();

    if (!response1.ok || !data1.success) {
      logError(`Failed to fetch markets: ${data1.error}`);
      return false;
    }

    logSuccess(`Fetched ${data1.data.length} markets (total: ${data1.total})`);
    logInfo(`Page: ${data1.page}, Limit: ${data1.limit}`);
    logInfo(`Stale: ${data1.stale}`);

    // Test 2: Filter by category
    logInfo('\nTest 2: Filter by category (Crypto)');
    const response2 = await fetch(`${BASE_URL}/api/polymarket/markets?category=Crypto&limit=5`);
    const data2 = await response2.json();

    if (!response2.ok || !data2.success) {
      logError(`Failed to fetch by category: ${data2.error}`);
      return false;
    }

    logSuccess(`Fetched ${data2.data.length} Crypto markets`);
    data2.data.forEach((market: { title: string; category: string }, i: number) => {
      console.log(`  ${i + 1}. [${market.category}] ${market.title}`);
    });

    // Test 3: Pagination
    logInfo('\nTest 3: Pagination (offset 10, limit 5)');
    const response3 = await fetch(`${BASE_URL}/api/polymarket/markets?offset=10&limit=5`);
    const data3 = await response3.json();

    if (!response3.ok || !data3.success) {
      logError(`Failed pagination test: ${data3.error}`);
      return false;
    }

    logSuccess(`Fetched page ${data3.page} with ${data3.data.length} markets`);

    // Test 4: Sync status
    logInfo('\nTest 4: Sync status');
    const response4 = await fetch(`${BASE_URL}/api/polymarket/sync`);
    const data4 = await response4.json();

    if (!response4.ok || !data4.success) {
      logError(`Failed to get sync status: ${data4.error}`);
      return false;
    }

    logSuccess('Sync status:');
    console.log(`  Last synced: ${data4.last_synced || 'Never'}`);
    console.log(`  Is stale: ${data4.is_stale}`);
    console.log(`  Sync in progress: ${data4.sync_in_progress}`);

    return true;

  } catch (error) {
    logError(`Exception: ${error}`);
    return false;
  }
}

// ============================================================================
// Test 5: Error Handling
// ============================================================================

async function testErrorHandling(): Promise<boolean> {
  logTest('Error Handling');

  try {
    // Test unauthorized sync (if admin key is set)
    if (ADMIN_KEY) {
      logInfo('Test 1: Unauthorized sync request');
      const response = await fetch(`${BASE_URL}/api/polymarket/sync`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer invalid-key',
        },
      });

      if (response.status === 401) {
        logSuccess('Unauthorized request properly rejected');
      } else {
        logError(`Expected 401, got ${response.status}`);
        return false;
      }
    }

    // Test invalid query params
    logInfo('Test 2: Invalid query parameters');
    const response2 = await fetch(`${BASE_URL}/api/polymarket/markets?limit=-1`);
    const data2 = await response2.json();

    // Should still work but sanitize params
    if (response2.ok && data2.success) {
      logSuccess('Invalid params handled gracefully');
    }

    return true;

  } catch (error) {
    logError(`Exception: ${error}`);
    return false;
  }
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runAllTests() {
  console.log('\n' + '█'.repeat(60));
  console.log('POLYMARKET INTEGRATION TEST SUITE');
  console.log('█'.repeat(60));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Admin Key: ${ADMIN_KEY ? 'Set' : 'Not set'}`);

  const results = {
    sync: false,
    database: false,
    logs: false,
    api: false,
    errors: false,
  };

  // Run tests
  results.sync = await testSyncEndpoint();
  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for sync to complete

  results.database = await testDatabaseVerification();
  results.logs = await testSyncLogs();
  results.api = await testMarketsAPI();
  results.errors = await testErrorHandling();

  // Summary
  console.log('\n' + '█'.repeat(60));
  console.log('TEST SUMMARY');
  console.log('█'.repeat(60));

  const tests = [
    { name: 'Sync Endpoint', result: results.sync },
    { name: 'Database Verification', result: results.database },
    { name: 'Sync Logs', result: results.logs },
    { name: 'Markets API', result: results.api },
    { name: 'Error Handling', result: results.errors },
  ];

  tests.forEach(test => {
    const icon = test.result ? '✅' : '❌';
    console.log(`${icon} ${test.name}`);
  });

  const passed = tests.filter(t => t.result).length;
  const total = tests.length;

  console.log('\n' + '='.repeat(60));
  console.log(`RESULT: ${passed}/${total} tests passed`);
  console.log('='.repeat(60) + '\n');

  // Exit code
  process.exit(passed === total ? 0 : 1);
}

// Run tests
runAllTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
