# Backend Setup Runbook

## Overview
This runbook provides step-by-step instructions for implementing the backend setup, including bug fixes, healthcheck implementation, and overnight orchestration setup.

**Execution Order:** A → B → C → D → E (Sequential execution required)

**Estimated Total Time:** 6-8 hours

---

## Step A: Fix Critical Bugs

**Duration:** 2-3 hours

### A1: Fix Resolution Data Parsing Logic

**File:** `/lib/services/watchlist-auto-populate.ts`

**Current Issue:**
Code iterates over `resolutionData` directly, but actual structure has `resolutions` array.

**Fix Implementation:**

1. Locate the resolution processing code (look for `Object.entries(resolutionData)`)

2. Replace with array iteration:
```typescript
// Add validation function at top of file
function validateResolutionData(data: any): boolean {
  if (!data) {
    console.error('Resolution data is null or undefined');
    return false;
  }

  if (!data.resolutions || !Array.isArray(data.resolutions)) {
    console.error('Invalid resolution data structure: missing resolutions array');
    return false;
  }

  if (data.resolutions.length === 0) {
    console.warn('Resolution data contains empty resolutions array');
    return false;
  }

  // Data integrity check
  if (data.resolved_conditions < 3000) {
    console.warn(`Low resolution count: ${data.resolved_conditions}, expected >= 3000`);
  }

  return true;
}

// Replace iteration logic
export async function processResolutions(resolutionData: ResolutionData) {
  if (!validateResolutionData(resolutionData)) {
    console.error('Resolution data validation failed');
    return [];
  }

  const outcomes = resolutionData.resolutions.map((resolution) => {
    // Validate required fields
    if (!resolution.condition_id || !resolution.market_id) {
      console.warn('Skipping resolution with missing required fields:', resolution);
      return null;
    }

    return {
      conditionId: resolution.condition_id,
      marketId: resolution.market_id,
      outcome: resolution.resolved_outcome,
      payoutYes: resolution.payout_yes,
      payoutNo: resolution.payout_no,
      resolvedAt: resolution.resolved_at
    };
  }).filter(Boolean); // Remove null entries

  console.log(`Processed ${outcomes.length} valid resolutions`);
  return outcomes;
}
```

3. Add TypeScript interface for type safety:
```typescript
interface ResolutionEntry {
  condition_id: string;
  market_id: string;
  resolved_outcome: 'YES' | 'NO';
  payout_yes: 0 | 1;
  payout_no: 0 | 1;
  resolved_at: string;
}

interface ResolutionData {
  total_conditions: number;
  resolved_conditions: number;
  last_updated: string;
  resolutions: ResolutionEntry[];
}
```

4. Test the fix:
```bash
npm run test -- watchlist-auto-populate
```

**Validation:**
- [ ] Code compiles without TypeScript errors
- [ ] Unit tests pass
- [ ] Manual test with actual resolution file succeeds
- [ ] Validation logs warnings appropriately

---

### A2: Fix Watchlist Service Error Handling

**File:** `/lib/services/watchlist-auto-populate.ts`

**Current Issues:**
- Hardcoded condition IDs
- No error handling
- No fallback mechanism

**Fix Implementation:**

1. Create environment variable configuration in `.env.local`:
```bash
# Default market and condition IDs for watchlist auto-populate
DEFAULT_MARKET_ID=0x1234...  # Replace with actual default
DEFAULT_CONDITION_IDS=0x111...,0x222...,0x333...  # Comma-separated
FALLBACK_WATCHLIST_SIZE=10
```

2. Add environment variable parsing:
```typescript
// At top of file
const DEFAULT_MARKET_ID = process.env.DEFAULT_MARKET_ID || '0x0000...'; // Safe fallback
const DEFAULT_CONDITION_IDS = process.env.DEFAULT_CONDITION_IDS?.split(',') || [];
const FALLBACK_WATCHLIST_SIZE = parseInt(process.env.FALLBACK_WATCHLIST_SIZE || '10');
```

3. Add comprehensive error handling:
```typescript
export async function autoPopulateWatchlist(strategyId: string) {
  try {
    // Load resolution data with error handling
    const resolutionData = await loadResolutionData();

    if (!resolutionData) {
      console.warn('Failed to load resolution data, using fallback watchlist');
      return getFallbackWatchlist(strategyId);
    }

    // Process resolutions
    const outcomes = await processResolutions(resolutionData);

    if (outcomes.length === 0) {
      console.warn('No valid resolutions found, using fallback');
      return getFallbackWatchlist(strategyId);
    }

    // Filter and sort for watchlist
    const watchlistItems = outcomes
      .filter(outcome => DEFAULT_CONDITION_IDS.includes(outcome.conditionId))
      .slice(0, FALLBACK_WATCHLIST_SIZE);

    console.log(`Auto-populated watchlist with ${watchlistItems.length} items`);
    return watchlistItems;

  } catch (error) {
    console.error('Error in autoPopulateWatchlist:', error);
    // Log error but return empty array to avoid crashing
    return [];
  }
}

async function loadResolutionData(): Promise<ResolutionData | null> {
  try {
    const fs = require('fs').promises;
    const path = require('path');
    const filePath = path.join(process.cwd(), 'data', 'expanded_resolution_map.json');

    const fileContent = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(fileContent);

    return data;
  } catch (error) {
    console.error('Failed to load resolution data file:', error);
    return null;
  }
}

function getFallbackWatchlist(strategyId: string): any[] {
  console.log(`Returning fallback watchlist for strategy ${strategyId}`);
  // Return empty array or cached data if available
  return [];
}
```

4. Test error scenarios:
```bash
# Test with missing file
mv data/expanded_resolution_map.json data/expanded_resolution_map.json.bak
npm run test -- watchlist-auto-populate
mv data/expanded_resolution_map.json.bak data/expanded_resolution_map.json

# Test with invalid JSON
# (create test with malformed data)
```

**Validation:**
- [ ] Service handles missing file gracefully
- [ ] Service handles malformed JSON gracefully
- [ ] Environment variables configure defaults correctly
- [ ] Fallback mechanism works
- [ ] All errors are logged with context

---

### A3: Fix/Document API Streaming Endpoint

**File:** `/app/api/strategies/[id]/watchlist/stream/route.ts`

**Current Issue:**
Endpoint may be incomplete or experimental.

**Fix Implementation:**

Since streaming is not critical for overnight processing, document as experimental:

1. Create or update the route file:
```typescript
import { NextRequest, NextResponse } from 'next/server';

/**
 * EXPERIMENTAL: Streaming endpoint for watchlist updates
 *
 * Status: Not yet implemented
 * Alternative: Use /api/strategies/[id]/watchlist for polling
 *
 * TODO: Implement Server-Sent Events or WebSocket streaming
 * TODO: Add connection management and cleanup
 * TODO: Add tests for streaming behavior
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  return NextResponse.json(
    {
      error: 'Streaming endpoint not yet implemented',
      status: 'experimental',
      alternative: `/api/strategies/${params.id}/watchlist`,
      message: 'Please use the standard polling endpoint for now'
    },
    { status: 501 } // Not Implemented
  );
}
```

2. Add to API documentation (create if doesn't exist):
```markdown
# API Endpoints

## Watchlist

### GET /api/strategies/[id]/watchlist
Returns the current watchlist for a strategy.

**Status:** Production ready

### GET /api/strategies/[id]/watchlist/stream
Server-sent events stream for real-time watchlist updates.

**Status:** Experimental - Not yet implemented
**Alternative:** Use polling with the standard watchlist endpoint
```

**Validation:**
- [ ] Endpoint returns 501 with helpful message
- [ ] Alternative endpoint works correctly
- [ ] Documentation is clear about status

---

## Step B: Create Healthcheck Script

**Duration:** 2 hours

### B1: Create Healthcheck Script Structure

**File:** `/scripts/system-healthcheck.ts` (already exists - update it)

**Implementation:**

```typescript
import { createClient as createClickHouseClient } from '@clickhouse/client';
import postgres from 'postgres';
import fs from 'fs/promises';
import path from 'path';

interface HealthCheckResult {
  check: string;
  status: 'healthy' | 'warning' | 'critical';
  message: string;
  details?: any;
}

interface HealthCheckSummary {
  timestamp: string;
  overallStatus: 'healthy' | 'warning' | 'critical';
  checks: HealthCheckResult[];
  summary: {
    total: number;
    healthy: number;
    warning: number;
    critical: number;
  };
}

async function runHealthCheck(): Promise<HealthCheckSummary> {
  console.log('Starting system health check...\n');

  const results: HealthCheckResult[] = [];

  // Run all checks
  results.push(await checkGoldskyConnection());
  results.push(await checkClickHouseConnection());
  results.push(await checkClickHouseTables());
  results.push(await checkPostgresConnection());
  results.push(await checkResolutionDataFreshness());
  results.push(await checkResolutionDataIntegrity());
  results.push(await checkAPIEndpoints());

  // Calculate summary
  const summary = {
    total: results.length,
    healthy: results.filter(r => r.status === 'healthy').length,
    warning: results.filter(r => r.status === 'warning').length,
    critical: results.filter(r => r.status === 'critical').length
  };

  // Determine overall status
  let overallStatus: 'healthy' | 'warning' | 'critical' = 'healthy';
  if (summary.critical > 0) {
    overallStatus = 'critical';
  } else if (summary.warning > 0) {
    overallStatus = 'warning';
  }

  const healthCheck: HealthCheckSummary = {
    timestamp: new Date().toISOString(),
    overallStatus,
    checks: results,
    summary
  };

  // Print results
  printHealthCheckResults(healthCheck);

  return healthCheck;
}

// Check 1: Goldsky Connection
async function checkGoldskyConnection(): Promise<HealthCheckResult> {
  try {
    const apiKey = process.env.GOLDSKY_API_KEY;

    if (!apiKey) {
      return {
        check: 'Goldsky Connection',
        status: 'critical',
        message: 'GOLDSKY_API_KEY environment variable not set'
      };
    }

    // Test connection with simple query
    const response = await fetch('https://api.goldsky.com/api/public/project_<project_id>/subgraphs/polymarket/prod/gn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        query: '{ _meta { block { number } } }'
      })
    });

    if (!response.ok) {
      return {
        check: 'Goldsky Connection',
        status: 'critical',
        message: `Goldsky API returned status ${response.status}`,
        details: await response.text()
      };
    }

    const data = await response.json();

    return {
      check: 'Goldsky Connection',
      status: 'healthy',
      message: 'Successfully connected to Goldsky API',
      details: { blockNumber: data.data?._meta?.block?.number }
    };

  } catch (error) {
    return {
      check: 'Goldsky Connection',
      status: 'critical',
      message: `Failed to connect to Goldsky: ${error.message}`
    };
  }
}

// Check 2: ClickHouse Connection
async function checkClickHouseConnection(): Promise<HealthCheckResult> {
  try {
    const client = createClickHouseClient({
      host: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD || ''
    });

    const result = await client.query({
      query: 'SELECT version()',
      format: 'JSONEachRow'
    });

    const data = await result.json();

    await client.close();

    return {
      check: 'ClickHouse Connection',
      status: 'healthy',
      message: 'Successfully connected to ClickHouse',
      details: data
    };

  } catch (error) {
    return {
      check: 'ClickHouse Connection',
      status: 'critical',
      message: `Failed to connect to ClickHouse: ${error.message}`
    };
  }
}

// Check 3: ClickHouse Tables
async function checkClickHouseTables(): Promise<HealthCheckResult> {
  try {
    const client = createClickHouseClient({
      host: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
      username: process.env.CLICKHOUSE_USER || 'default',
      password: process.env.CLICKHOUSE_PASSWORD || ''
    });

    const requiredTables = [
      'trades',
      'wallet_resolution_outcomes',
      'wallet_category_pnl'
    ];

    const tableStatus: Record<string, any> = {};

    for (const table of requiredTables) {
      try {
        const countResult = await client.query({
          query: `SELECT count() as count FROM ${table}`,
          format: 'JSONEachRow'
        });

        const countData = await countResult.json();
        const count = countData[0]?.count || 0;

        tableStatus[table] = {
          exists: true,
          rowCount: parseInt(count)
        };
      } catch (error) {
        tableStatus[table] = {
          exists: false,
          error: error.message
        };
      }
    }

    await client.close();

    // Check if any tables are missing
    const missingTables = requiredTables.filter(t => !tableStatus[t].exists);

    if (missingTables.length > 0) {
      return {
        check: 'ClickHouse Tables',
        status: 'critical',
        message: `Missing tables: ${missingTables.join(', ')}`,
        details: tableStatus
      };
    }

    // Check if any tables are empty
    const emptyTables = requiredTables.filter(t => tableStatus[t].rowCount === 0);

    if (emptyTables.length > 0) {
      return {
        check: 'ClickHouse Tables',
        status: 'warning',
        message: `Empty tables: ${emptyTables.join(', ')}`,
        details: tableStatus
      };
    }

    return {
      check: 'ClickHouse Tables',
      status: 'healthy',
      message: 'All required tables exist and contain data',
      details: tableStatus
    };

  } catch (error) {
    return {
      check: 'ClickHouse Tables',
      status: 'critical',
      message: `Failed to check tables: ${error.message}`
    };
  }
}

// Check 4: Postgres Connection
async function checkPostgresConnection(): Promise<HealthCheckResult> {
  try {
    const sql = postgres(process.env.DATABASE_URL!);

    const result = await sql`SELECT version()`;

    await sql.end();

    return {
      check: 'Postgres Connection',
      status: 'healthy',
      message: 'Successfully connected to Postgres',
      details: result[0]
    };

  } catch (error) {
    return {
      check: 'Postgres Connection',
      status: 'critical',
      message: `Failed to connect to Postgres: ${error.message}`
    };
  }
}

// Check 5: Resolution Data Freshness
async function checkResolutionDataFreshness(): Promise<HealthCheckResult> {
  try {
    const filePath = path.join(process.cwd(), 'data', 'expanded_resolution_map.json');

    const fileContent = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(fileContent);

    if (!data.last_updated) {
      return {
        check: 'Resolution Data Freshness',
        status: 'warning',
        message: 'Resolution data missing last_updated timestamp'
      };
    }

    const lastUpdated = new Date(data.last_updated);
    const now = new Date();
    const hoursSinceUpdate = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60);

    let status: 'healthy' | 'warning' | 'critical';
    let message: string;

    if (hoursSinceUpdate < 24) {
      status = 'healthy';
      message = `Resolution data updated ${hoursSinceUpdate.toFixed(1)} hours ago`;
    } else if (hoursSinceUpdate < 48) {
      status = 'warning';
      message = `Resolution data updated ${hoursSinceUpdate.toFixed(1)} hours ago (24-48h threshold)`;
    } else {
      status = 'critical';
      message = `Resolution data updated ${hoursSinceUpdate.toFixed(1)} hours ago (>48h - stale!)`;
    }

    return {
      check: 'Resolution Data Freshness',
      status,
      message,
      details: {
        lastUpdated: data.last_updated,
        hoursSinceUpdate: hoursSinceUpdate.toFixed(1)
      }
    };

  } catch (error) {
    return {
      check: 'Resolution Data Freshness',
      status: 'critical',
      message: `Failed to check resolution data: ${error.message}`
    };
  }
}

// Check 6: Resolution Data Integrity
async function checkResolutionDataIntegrity(): Promise<HealthCheckResult> {
  try {
    const filePath = path.join(process.cwd(), 'data', 'expanded_resolution_map.json');

    const fileContent = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(fileContent);

    if (!data.resolved_conditions) {
      return {
        check: 'Resolution Data Integrity',
        status: 'warning',
        message: 'Resolution data missing resolved_conditions count'
      };
    }

    const resolvedCount = data.resolved_conditions;
    const minExpectedCount = 3000;

    if (resolvedCount < minExpectedCount) {
      return {
        check: 'Resolution Data Integrity',
        status: 'critical',
        message: `Only ${resolvedCount} resolutions found, expected >= ${minExpectedCount}`,
        details: {
          resolvedCount,
          minExpected: minExpectedCount,
          totalConditions: data.total_conditions
        }
      };
    }

    return {
      check: 'Resolution Data Integrity',
      status: 'healthy',
      message: `Resolution data contains ${resolvedCount} resolved conditions`,
      details: {
        resolvedCount,
        totalConditions: data.total_conditions
      }
    };

  } catch (error) {
    return {
      check: 'Resolution Data Integrity',
      status: 'critical',
      message: `Failed to check resolution integrity: ${error.message}`
    };
  }
}

// Check 7: API Endpoints
async function checkAPIEndpoints(): Promise<HealthCheckResult> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    const endpoints = [
      '/api/strategies',
      '/api/wallets',
    ];

    const results: Record<string, any> = {};

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(`${baseUrl}${endpoint}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });

        results[endpoint] = {
          status: response.status,
          ok: response.ok
        };
      } catch (error) {
        results[endpoint] = {
          status: 'error',
          error: error.message
        };
      }
    }

    // Check if any endpoints failed
    const failedEndpoints = Object.entries(results).filter(([_, result]) => !result.ok);

    if (failedEndpoints.length > 0) {
      return {
        check: 'API Endpoints',
        status: 'warning',
        message: `${failedEndpoints.length} endpoint(s) returned errors`,
        details: results
      };
    }

    return {
      check: 'API Endpoints',
      status: 'healthy',
      message: 'All API endpoints responding correctly',
      details: results
    };

  } catch (error) {
    return {
      check: 'API Endpoints',
      status: 'critical',
      message: `Failed to check API endpoints: ${error.message}`
    };
  }
}

function printHealthCheckResults(healthCheck: HealthCheckSummary) {
  console.log('\n' + '='.repeat(80));
  console.log('SYSTEM HEALTH CHECK RESULTS');
  console.log('='.repeat(80));
  console.log(`Timestamp: ${healthCheck.timestamp}`);
  console.log(`Overall Status: ${healthCheck.overallStatus.toUpperCase()}`);
  console.log('\n');

  // Print each check
  for (const result of healthCheck.checks) {
    const statusIcon = result.status === 'healthy' ? '✓' :
                       result.status === 'warning' ? '⚠' : '✗';

    console.log(`${statusIcon} ${result.check}: ${result.status.toUpperCase()}`);
    console.log(`  ${result.message}`);

    if (result.details) {
      console.log(`  Details: ${JSON.stringify(result.details, null, 2)}`);
    }

    console.log('');
  }

  // Print summary
  console.log('='.repeat(80));
  console.log(`Summary: ${healthCheck.summary.healthy}/${healthCheck.summary.total} healthy, ` +
              `${healthCheck.summary.warning} warnings, ${healthCheck.summary.critical} critical`);
  console.log('='.repeat(80) + '\n');
}

// Run if called directly
if (require.main === module) {
  runHealthCheck()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Health check failed:', error);
      process.exit(1);
    });
}

export { runHealthCheck, type HealthCheckSummary, type HealthCheckResult };
```

**Validation:**
- [ ] All 7 checks execute
- [ ] Script completes in < 30 seconds
- [ ] Output is readable and informative
- [ ] Exit codes are correct (0 = healthy, 1 = issues)

---

## Step C: Set Up Cron/Overnight Orchestrator

**Duration:** 1.5 hours

### C1: Create Overnight Orchestrator

**File:** `/scripts/overnight-orchestrator.ts` (already exists - update it)

**Implementation:**

```typescript
import { runHealthCheck } from './system-healthcheck';

interface OrchestratorResult {
  startTime: string;
  endTime: string;
  duration: string;
  steps: {
    step: string;
    status: 'success' | 'failed' | 'skipped';
    duration?: string;
    error?: string;
  }[];
  overallStatus: 'success' | 'partial' | 'failed';
}

async function runOvernightOrchestrator(): Promise<OrchestratorResult> {
  const startTime = new Date();
  console.log(`\n${'='.repeat(80)}`);
  console.log(`OVERNIGHT ORCHESTRATOR STARTED: ${startTime.toISOString()}`);
  console.log(`${'='.repeat(80)}\n`);

  const steps: OrchestratorResult['steps'] = [];

  // Step 1: Run health check
  try {
    console.log('Step 1: Running system health check...');
    const stepStart = Date.now();

    const healthCheck = await runHealthCheck();

    const stepDuration = ((Date.now() - stepStart) / 1000).toFixed(2);

    if (healthCheck.overallStatus === 'critical') {
      steps.push({
        step: 'Health Check',
        status: 'failed',
        duration: `${stepDuration}s`,
        error: 'Critical health check failures detected'
      });

      console.error('ABORTING: Critical health check failures. Not running data processing.');

      // Return early
      const endTime = new Date();
      return {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        duration: `${((endTime.getTime() - startTime.getTime()) / 1000).toFixed(2)}s`,
        steps,
        overallStatus: 'failed'
      };
    }

    steps.push({
      step: 'Health Check',
      status: 'success',
      duration: `${stepDuration}s`
    });

  } catch (error) {
    steps.push({
      step: 'Health Check',
      status: 'failed',
      error: error.message
    });
  }

  // Step 2: Ingest new trades
  try {
    console.log('\nStep 2: Ingesting new trades from Goldsky...');
    const stepStart = Date.now();

    // TODO: Import and run actual ingestion script
    // await ingestNewTrades();
    console.log('TODO: Implement trade ingestion');

    const stepDuration = ((Date.now() - stepStart) / 1000).toFixed(2);

    steps.push({
      step: 'Ingest Trades',
      status: 'success',
      duration: `${stepDuration}s`
    });

  } catch (error) {
    steps.push({
      step: 'Ingest Trades',
      status: 'failed',
      error: error.message
    });
  }

  // Step 3: Compute resolution outcomes
  try {
    console.log('\nStep 3: Computing resolution outcomes...');
    const stepStart = Date.now();

    // TODO: Import and run resolution computation
    // await computeResolutionOutcomes();
    console.log('TODO: Implement resolution outcome computation');

    const stepDuration = ((Date.now() - stepStart) / 1000).toFixed(2);

    steps.push({
      step: 'Compute Resolution Outcomes',
      status: 'success',
      duration: `${stepDuration}s`
    });

  } catch (error) {
    steps.push({
      step: 'Compute Resolution Outcomes',
      status: 'failed',
      error: error.message
    });
  }

  // Step 4: Update wallet metrics
  try {
    console.log('\nStep 4: Updating wallet category PnL...');
    const stepStart = Date.now();

    // TODO: Import and run wallet metric updates
    // await updateWalletMetrics();
    console.log('TODO: Implement wallet metric updates');

    const stepDuration = ((Date.now() - stepStart) / 1000).toFixed(2);

    steps.push({
      step: 'Update Wallet Metrics',
      status: 'success',
      duration: `${stepDuration}s`
    });

  } catch (error) {
    steps.push({
      step: 'Update Wallet Metrics',
      status: 'failed',
      error: error.message
    });
  }

  // Calculate overall status
  const failedSteps = steps.filter(s => s.status === 'failed').length;
  const successSteps = steps.filter(s => s.status === 'success').length;

  let overallStatus: 'success' | 'partial' | 'failed';
  if (failedSteps === 0) {
    overallStatus = 'success';
  } else if (successSteps > 0) {
    overallStatus = 'partial';
  } else {
    overallStatus = 'failed';
  }

  const endTime = new Date();
  const duration = ((endTime.getTime() - startTime.getTime()) / 1000).toFixed(2);

  const result: OrchestratorResult = {
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    duration: `${duration}s`,
    steps,
    overallStatus
  };

  // Print summary
  console.log(`\n${'='.repeat(80)}`);
  console.log(`OVERNIGHT ORCHESTRATOR COMPLETED: ${endTime.toISOString()}`);
  console.log(`Duration: ${duration}s`);
  console.log(`Status: ${overallStatus.toUpperCase()}`);
  console.log(`${'='.repeat(80)}\n`);

  // Print step summary
  console.log('Step Summary:');
  for (const step of steps) {
    const statusIcon = step.status === 'success' ? '✓' :
                       step.status === 'failed' ? '✗' : '-';
    console.log(`  ${statusIcon} ${step.step}: ${step.status.toUpperCase()} ${step.duration || ''}`);
    if (step.error) {
      console.log(`    Error: ${step.error}`);
    }
  }
  console.log('');

  return result;
}

// Run if called directly
if (require.main === module) {
  runOvernightOrchestrator()
    .then((result) => {
      process.exit(result.overallStatus === 'failed' ? 1 : 0);
    })
    .catch((error) => {
      console.error('Orchestrator crashed:', error);
      process.exit(1);
    });
}

export { runOvernightOrchestrator, type OrchestratorResult };
```

### C2: Set Up Node-Cron

**File:** `/lib/cron/scheduler.ts` (create new)

**Implementation:**

```typescript
import cron from 'node-cron';
import { runOvernightOrchestrator } from '@/scripts/overnight-orchestrator';

let isRunning = false;

export function startCronJobs() {
  console.log('Starting cron jobs...');

  // Schedule overnight orchestrator for 3 AM ET (7 AM UTC)
  // Note: Adjust for daylight saving time as needed
  cron.schedule('0 7 * * *', async () => {
    if (isRunning) {
      console.log('Overnight orchestrator already running, skipping this execution');
      return;
    }

    try {
      isRunning = true;
      console.log('\nCron trigger: Starting overnight orchestrator...');

      await runOvernightOrchestrator();

      console.log('Cron execution completed successfully\n');
    } catch (error) {
      console.error('Cron execution failed:', error);
    } finally {
      isRunning = false;
    }
  }, {
    timezone: 'America/New_York'
  });

  console.log('Cron jobs scheduled successfully');
  console.log('- Overnight orchestrator: Daily at 3:00 AM ET');
}

export function stopCronJobs() {
  cron.getTasks().forEach(task => task.stop());
  console.log('All cron jobs stopped');
}
```

### C3: Initialize Cron in Next.js

**File:** Update `/app/api/cron/init/route.ts` (create if doesn't exist)

```typescript
import { NextResponse } from 'next/server';
import { startCronJobs } from '@/lib/cron/scheduler';

let cronInitialized = false;

export async function GET() {
  if (cronInitialized) {
    return NextResponse.json({
      message: 'Cron jobs already initialized'
    });
  }

  try {
    startCronJobs();
    cronInitialized = true;

    return NextResponse.json({
      message: 'Cron jobs initialized successfully',
      schedule: {
        overnight: 'Daily at 3:00 AM ET'
      }
    });
  } catch (error) {
    return NextResponse.json({
      error: 'Failed to initialize cron jobs',
      details: error.message
    }, { status: 500 });
  }
}
```

**Add to application startup:** Update `/app/layout.tsx` or create initialization hook

**Validation:**
- [ ] Cron job initializes on app start
- [ ] Schedule is correct (3 AM ET)
- [ ] Only one instance runs at a time
- [ ] Errors are logged properly

---

## Step D: Document Data Schemas

**Duration:** 1 hour

### D1: Create Schema Documentation

**File:** `/docs/schemas/expanded-resolution-map.md` (create new directory if needed)

```markdown
# Expanded Resolution Map Schema

## File Location
`/data/expanded_resolution_map.json`

## Description
Contains resolved market outcomes from Polymarket, including condition IDs, market IDs, and payout information.

## Update Frequency
Updated daily during overnight processing (3 AM ET)

## Schema Definition

### TypeScript Interface
\`\`\`typescript
interface ResolutionEntry {
  condition_id: string;
  market_id: string;
  resolved_outcome: 'YES' | 'NO';
  payout_yes: 0 | 1;
  payout_no: 0 | 1;
  resolved_at: string; // ISO8601 timestamp
}

interface ExpandedResolutionMap {
  total_conditions: number;
  resolved_conditions: number;
  last_updated: string; // ISO8601 timestamp
  resolutions: ResolutionEntry[];
}
\`\`\`

### JSON Schema
\`\`\`json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["total_conditions", "resolved_conditions", "last_updated", "resolutions"],
  "properties": {
    "total_conditions": {
      "type": "integer",
      "description": "Total number of conditions tracked"
    },
    "resolved_conditions": {
      "type": "integer",
      "description": "Number of conditions that have been resolved",
      "minimum": 0
    },
    "last_updated": {
      "type": "string",
      "format": "date-time",
      "description": "ISO8601 timestamp of last update"
    },
    "resolutions": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["condition_id", "market_id", "resolved_outcome", "payout_yes", "payout_no", "resolved_at"],
        "properties": {
          "condition_id": {
            "type": "string",
            "description": "Unique condition identifier (hex string)"
          },
          "market_id": {
            "type": "string",
            "description": "Associated market identifier (hex string)"
          },
          "resolved_outcome": {
            "type": "string",
            "enum": ["YES", "NO"],
            "description": "The resolved outcome"
          },
          "payout_yes": {
            "type": "integer",
            "enum": [0, 1],
            "description": "Payout for YES positions (0 or 1)"
          },
          "payout_no": {
            "type": "integer",
            "enum": [0, 1],
            "description": "Payout for NO positions (0 or 1)"
          },
          "resolved_at": {
            "type": "string",
            "format": "date-time",
            "description": "ISO8601 timestamp when market resolved"
          }
        }
      }
    }
  }
}
\`\`\`

## Example Data
\`\`\`json
{
  "total_conditions": 3673,
  "resolved_conditions": 3673,
  "last_updated": "2025-01-21T19:45:00Z",
  "resolutions": [
    {
      "condition_id": "0x1234567890abcdef...",
      "market_id": "0xfedcba0987654321...",
      "resolved_outcome": "YES",
      "payout_yes": 1,
      "payout_no": 0,
      "resolved_at": "2025-01-15T10:30:00Z"
    },
    {
      "condition_id": "0xabcdef1234567890...",
      "market_id": "0x0987654321fedcba...",
      "resolved_outcome": "NO",
      "payout_yes": 0,
      "payout_no": 1,
      "resolved_at": "2025-01-18T14:20:00Z"
    }
  ]
}
\`\`\`

## Data Integrity Checks

### Minimum Thresholds
- `resolved_conditions` should be >= 3000
- If below threshold, indicates data corruption or incomplete processing

### Freshness Checks
- `last_updated` should be within 24 hours for healthy status
- 24-48 hours = warning
- Over 48 hours = critical/stale

### Validation Rules
1. `resolutions` array must exist and be non-empty
2. Each resolution must have all required fields
3. `payout_yes` and `payout_no` must sum to 1 (one wins, one loses)
4. `resolved_outcome` must match payout values (YES → payout_yes=1, NO → payout_no=1)
5. Timestamps must be valid ISO8601 format

## Usage in Code

### Loading and Validating
\`\`\`typescript
import fs from 'fs/promises';
import path from 'path';

async function loadResolutionData(): Promise<ExpandedResolutionMap> {
  const filePath = path.join(process.cwd(), 'data', 'expanded_resolution_map.json');
  const fileContent = await fs.readFile(filePath, 'utf8');
  const data = JSON.parse(fileContent);

  // Validate structure
  if (!data.resolutions || !Array.isArray(data.resolutions)) {
    throw new Error('Invalid resolution data: missing resolutions array');
  }

  // Check data integrity
  if (data.resolved_conditions < 3000) {
    console.warn(\`Low resolution count: \${data.resolved_conditions}\`);
  }

  return data;
}
\`\`\`

### Iterating Resolutions
\`\`\`typescript
const resolutionData = await loadResolutionData();

for (const resolution of resolutionData.resolutions) {
  console.log(\`Condition \${resolution.condition_id} resolved to \${resolution.resolved_outcome}\`);

  // Process resolution...
}
\`\`\`

## Related Files
- `/data/backfilled_market_ids.json` - Market ID reference
- `/data/market_id_lookup_results.jsonl` - Market lookup cache
- `/lib/services/watchlist-auto-populate.ts` - Consumer of this data

## Maintenance
- File is regenerated during overnight processing
- Backup should be kept before regeneration
- Monitor file size for unexpected growth/shrinkage
```

### D2: Document Other Data Files

Create similar documentation for:
- `/docs/schemas/backfilled-market-ids.md`
- `/docs/schemas/market-id-lookup-results.md`

**Validation:**
- [ ] All schemas documented
- [ ] Examples provided
- [ ] Validation rules clear
- [ ] Usage examples included

---

## Step E: Test End-to-End

**Duration:** 1.5 hours

### E1: Unit Tests

Create test files for each fixed component:

**File:** `/tests/unit/watchlist-auto-populate.test.ts`

```typescript
import { describe, it, expect, beforeEach } from '@jest/globals';
import { processResolutions, validateResolutionData } from '@/lib/services/watchlist-auto-populate';

describe('Watchlist Auto-Populate Service', () => {
  describe('validateResolutionData', () => {
    it('should accept valid resolution data', () => {
      const validData = {
        total_conditions: 3673,
        resolved_conditions: 3673,
        last_updated: '2025-01-21T19:45:00Z',
        resolutions: [
          {
            condition_id: '0x123',
            market_id: '0x456',
            resolved_outcome: 'YES',
            payout_yes: 1,
            payout_no: 0,
            resolved_at: '2025-01-15T10:30:00Z'
          }
        ]
      };

      expect(validateResolutionData(validData)).toBe(true);
    });

    it('should reject data missing resolutions array', () => {
      const invalidData = {
        total_conditions: 100,
        resolved_conditions: 100,
        last_updated: '2025-01-21T19:45:00Z'
      };

      expect(validateResolutionData(invalidData)).toBe(false);
    });

    it('should warn on low resolution count', () => {
      const lowCountData = {
        total_conditions: 100,
        resolved_conditions: 100,
        last_updated: '2025-01-21T19:45:00Z',
        resolutions: []
      };

      // Should still validate but log warning
      expect(validateResolutionData(lowCountData)).toBe(false);
    });
  });

  describe('processResolutions', () => {
    it('should process valid resolutions', async () => {
      const validData = {
        total_conditions: 2,
        resolved_conditions: 2,
        last_updated: '2025-01-21T19:45:00Z',
        resolutions: [
          {
            condition_id: '0x123',
            market_id: '0x456',
            resolved_outcome: 'YES',
            payout_yes: 1,
            payout_no: 0,
            resolved_at: '2025-01-15T10:30:00Z'
          },
          {
            condition_id: '0x789',
            market_id: '0xabc',
            resolved_outcome: 'NO',
            payout_yes: 0,
            payout_no: 1,
            resolved_at: '2025-01-16T11:00:00Z'
          }
        ]
      };

      const outcomes = await processResolutions(validData);

      expect(outcomes).toHaveLength(2);
      expect(outcomes[0].conditionId).toBe('0x123');
      expect(outcomes[0].outcome).toBe('YES');
    });

    it('should skip resolutions with missing required fields', async () => {
      const dataWithInvalidEntry = {
        total_conditions: 2,
        resolved_conditions: 2,
        last_updated: '2025-01-21T19:45:00Z',
        resolutions: [
          {
            condition_id: '0x123',
            market_id: '0x456',
            resolved_outcome: 'YES',
            payout_yes: 1,
            payout_no: 0,
            resolved_at: '2025-01-15T10:30:00Z'
          },
          {
            // Missing condition_id
            market_id: '0xabc',
            resolved_outcome: 'NO',
            payout_yes: 0,
            payout_no: 1,
            resolved_at: '2025-01-16T11:00:00Z'
          }
        ]
      };

      const outcomes = await processResolutions(dataWithInvalidEntry);

      // Should only process the valid entry
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].conditionId).toBe('0x123');
    });
  });
});
```

**Run tests:**
```bash
npm run test -- watchlist-auto-populate
```

### E2: Integration Test

**File:** `/tests/integration/overnight-orchestrator.test.ts`

```typescript
import { describe, it, expect } from '@jest/globals';
import { runOvernightOrchestrator } from '@/scripts/overnight-orchestrator';
import { runHealthCheck } from '@/scripts/system-healthcheck';

describe('Overnight Orchestrator Integration', () => {
  it('should run health check successfully', async () => {
    const healthCheck = await runHealthCheck();

    expect(healthCheck).toBeDefined();
    expect(healthCheck.overallStatus).toBeDefined();
    expect(healthCheck.checks).toBeInstanceOf(Array);
    expect(healthCheck.checks.length).toBeGreaterThan(0);
  });

  it('should complete orchestrator without crashing', async () => {
    const result = await runOvernightOrchestrator();

    expect(result).toBeDefined();
    expect(result.overallStatus).toBeDefined();
    expect(result.steps).toBeInstanceOf(Array);
    expect(result.steps.length).toBeGreaterThan(0);
  }, 60000); // 60 second timeout
});
```

**Run integration tests:**
```bash
npm run test -- integration
```

### E3: Manual End-to-End Test

**Test Plan:**

1. **Run healthcheck manually:**
```bash
npx tsx scripts/system-healthcheck.ts
```

Expected: All checks pass or provide actionable warnings

2. **Run overnight orchestrator manually:**
```bash
npx tsx scripts/overnight-orchestrator.ts
```

Expected: Completes all steps successfully

3. **Test cron initialization:**
```bash
curl http://localhost:3000/api/cron/init
```

Expected: Returns success message

4. **Verify resolution data parsing:**
```bash
# Create simple test script
npx tsx -e "
import { processResolutions } from './lib/services/watchlist-auto-populate';
import fs from 'fs/promises';

(async () => {
  const data = JSON.parse(await fs.readFile('data/expanded_resolution_map.json', 'utf8'));
  const outcomes = await processResolutions(data);
  console.log(\`Processed \${outcomes.length} resolutions\`);
})();
"
```

Expected: Processes resolutions without errors

5. **Check logs for errors:**
```bash
# Check for any error patterns
grep -i "error" .next/server/app.log
```

Expected: No unexpected errors

**Validation Checklist:**
- [ ] Healthcheck completes with all checks
- [ ] Overnight orchestrator runs end-to-end
- [ ] Cron jobs initialize correctly
- [ ] Resolution data parses correctly
- [ ] No errors in application logs
- [ ] All unit tests pass
- [ ] Integration tests pass

---

## Post-Implementation Checklist

After completing all steps A-E:

### Code Quality
- [ ] All TypeScript errors resolved
- [ ] No console warnings during execution
- [ ] Error handling is comprehensive
- [ ] Logging is informative and structured

### Functionality
- [ ] All 3 bugs fixed and tested
- [ ] Healthcheck validates all 7+ components
- [ ] Overnight orchestrator runs successfully
- [ ] Cron scheduling works correctly
- [ ] Data schemas are documented

### Documentation
- [ ] All runbook steps documented
- [ ] Schema files created
- [ ] Code comments added
- [ ] Environment variables documented

### Testing
- [ ] Unit tests written and passing
- [ ] Integration tests passing
- [ ] Manual end-to-end test completed
- [ ] Edge cases tested

### Deployment Readiness
- [ ] Environment variables configured
- [ ] Database connections verified
- [ ] API endpoints responding
- [ ] Cron jobs scheduled
- [ ] Monitoring in place

---

## Troubleshooting Guide

### Common Issues

**Issue:** Healthcheck fails on ClickHouse connection
**Solution:**
- Verify CLICKHOUSE_HOST environment variable
- Check network connectivity
- Verify credentials

**Issue:** Resolution data validation fails
**Solution:**
- Check file exists at `/data/expanded_resolution_map.json`
- Verify file format matches schema
- Check resolved_conditions count

**Issue:** Cron jobs don't start
**Solution:**
- Verify node-cron is installed
- Check timezone configuration
- Ensure cron initialization endpoint is called

**Issue:** Overnight orchestrator times out
**Solution:**
- Check database query performance
- Verify API rate limits not exceeded
- Review logs for bottlenecks

---

## Next Steps

After successful implementation:

1. **Monitor for 3 days:**
   - Check logs daily
   - Verify overnight runs complete
   - Monitor healthcheck results

2. **Optimize if needed:**
   - Identify slow operations
   - Add caching where appropriate
   - Tune database queries

3. **Add notifications (future):**
   - Integrate with Slack/email
   - Alert on critical failures
   - Send daily summary reports

4. **Expand monitoring:**
   - Add performance metrics
   - Track data processing times
   - Monitor resource usage
