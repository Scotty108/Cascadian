# Acceptance Criteria

## Overview
This document defines the specific success metrics and validation requirements for the backend setup implementation.

---

## Critical Success Metrics

### 1. Bug Fixes

#### Bug #1: Resolution Data Parsing
- [ ] Code correctly iterates over `resolutionData.resolutions` array
- [ ] Validation function checks for array existence
- [ ] Validation function checks for minimum resolution count (>= 3000)
- [ ] Invalid data structures log appropriate errors
- [ ] TypeScript interfaces defined for type safety
- [ ] Unit tests pass with 100% coverage for parsing logic
- [ ] Integration test confirms resolutions are processed from actual file
- [ ] No runtime errors when processing production data file

**Acceptance Test:**
```bash
# Should process all resolutions without errors
npx tsx -e "
import { processResolutions } from './lib/services/watchlist-auto-populate';
import fs from 'fs/promises';
const data = JSON.parse(await fs.readFile('data/expanded_resolution_map.json', 'utf8'));
const outcomes = await processResolutions(data);
console.log('Success: Processed', outcomes.length, 'resolutions');
"
```

**Expected Output:** Processes 3,673+ resolutions with no errors

---

#### Bug #2: Watchlist Service Error Handling
- [ ] Environment variables control default market/condition IDs
- [ ] Missing environment variables use sensible fallback values
- [ ] Service handles missing resolution file gracefully
- [ ] Service handles malformed JSON gracefully
- [ ] Service handles network failures without crashing
- [ ] Fallback mechanism returns empty array or cached data
- [ ] All errors are logged with context and stack traces
- [ ] No unhandled promise rejections
- [ ] Unit tests cover all error scenarios
- [ ] Integration test confirms graceful degradation

**Acceptance Test:**
```bash
# Test with missing file
mv data/expanded_resolution_map.json data/expanded_resolution_map.json.bak
npx tsx -e "
import { autoPopulateWatchlist } from './lib/services/watchlist-auto-populate';
const result = await autoPopulateWatchlist('test-strategy-id');
console.log('Fallback result:', result);
" || echo "Should handle gracefully"
mv data/expanded_resolution_map.json.bak data/expanded_resolution_map.json
```

**Expected Output:** Returns empty array or fallback data, logs warning, does not crash

---

#### Bug #3: API Streaming Endpoint
- [ ] Endpoint returns HTTP 501 status code
- [ ] Response includes helpful error message
- [ ] Response includes alternative endpoint path
- [ ] Documentation clearly marks as experimental
- [ ] No memory leaks or hanging connections
- [ ] Alternative polling endpoint works correctly

**Acceptance Test:**
```bash
# Test streaming endpoint
curl -i http://localhost:3000/api/strategies/test-id/watchlist/stream
```

**Expected Output:**
```
HTTP/1.1 501 Not Implemented
Content-Type: application/json

{
  "error": "Streaming endpoint not yet implemented",
  "status": "experimental",
  "alternative": "/api/strategies/test-id/watchlist",
  "message": "Please use the standard polling endpoint for now"
}
```

---

### 2. Healthcheck Script

#### Functional Requirements
- [ ] Validates Goldsky API connectivity
- [ ] Validates ClickHouse connectivity
- [ ] Checks existence and row counts of required ClickHouse tables
- [ ] Validates Postgres connectivity
- [ ] Checks resolution data file freshness (<24h = healthy, 24-48h = warning, >48h = critical)
- [ ] Validates resolution data integrity (count >= 3000)
- [ ] Tests API endpoint responsiveness
- [ ] Completes within 30 seconds
- [ ] Returns exit code 0 for healthy, 1 for issues
- [ ] Outputs clear, formatted results
- [ ] Logs all check details
- [ ] Can be run manually or programmatically

**Acceptance Test:**
```bash
time npx tsx scripts/system-healthcheck.ts
echo "Exit code: $?"
```

**Expected Output:**
- Execution time < 30 seconds
- All 7 checks complete
- Clear status for each check (healthy/warning/critical)
- Exit code 0 if all healthy or warnings only
- Exit code 1 if any critical failures

**Minimum Passing Criteria:**
- At least 5 of 7 checks must pass (healthy)
- No more than 2 warnings
- 0 critical failures

---

### 3. Overnight Orchestrator

#### Functional Requirements
- [ ] Runs healthcheck before processing
- [ ] Aborts if healthcheck shows critical failures
- [ ] Executes steps in correct order: health → ingest → compute → update
- [ ] Logs start time, end time, and duration
- [ ] Logs status of each step (success/failed/skipped)
- [ ] Continues to next step even if non-critical step fails
- [ ] Calculates and reports overall status (success/partial/failed)
- [ ] Returns exit code 0 for success, 1 for failure
- [ ] Can be run manually for testing
- [ ] Handles errors gracefully without crashing

**Acceptance Test:**
```bash
npx tsx scripts/overnight-orchestrator.ts
echo "Exit code: $?"
```

**Expected Output:**
```
================================================================================
OVERNIGHT ORCHESTRATOR STARTED: 2025-01-28T07:00:00.000Z
================================================================================

Step 1: Running system health check...
[health check output]

Step 2: Ingesting new trades from Goldsky...
[ingestion output]

Step 3: Computing resolution outcomes...
[computation output]

Step 4: Updating wallet category PnL...
[update output]

================================================================================
OVERNIGHT ORCHESTRATOR COMPLETED: 2025-01-28T07:15:23.000Z
Duration: 923.45s
Status: SUCCESS
================================================================================

Step Summary:
  ✓ Health Check: SUCCESS 12.3s
  ✓ Ingest Trades: SUCCESS 450.2s
  ✓ Compute Resolution Outcomes: SUCCESS 230.5s
  ✓ Update Wallet Metrics: SUCCESS 230.45s
```

**Minimum Passing Criteria:**
- All steps execute (no crashes)
- Health check passes
- Overall status is SUCCESS or PARTIAL (not FAILED)
- Duration < 30 minutes for typical data volume

---

### 4. Cron Scheduling

#### Functional Requirements
- [ ] Cron jobs initialize when application starts
- [ ] Overnight orchestrator scheduled for 3:00 AM ET (7:00 AM UTC)
- [ ] Timezone handling is correct (America/New_York)
- [ ] Only one instance runs at a time (mutex/flag prevents overlap)
- [ ] Schedule is visible/queryable via API endpoint
- [ ] Can be initialized via `/api/cron/init` endpoint
- [ ] Errors during cron execution are logged
- [ ] Application continues running if cron job fails

**Acceptance Test:**
```bash
# Initialize cron
curl http://localhost:3000/api/cron/init

# Check response
```

**Expected Output:**
```json
{
  "message": "Cron jobs initialized successfully",
  "schedule": {
    "overnight": "Daily at 3:00 AM ET"
  }
}
```

**Manual Verification:**
- [ ] Check application logs show "Cron jobs scheduled successfully"
- [ ] Verify cron expression: `0 7 * * *` with timezone `America/New_York`
- [ ] Test mutex by attempting to run orchestrator while it's already running

---

### 5. Data Schema Documentation

#### Documentation Requirements
- [ ] Schema file exists for `expanded_resolution_map.json`
- [ ] Schema includes TypeScript interface
- [ ] Schema includes JSON Schema definition
- [ ] Schema includes example data
- [ ] Schema documents update frequency
- [ ] Schema documents validation rules
- [ ] Schema includes usage examples
- [ ] Related files are cross-referenced

**Acceptance Test:**
```bash
# Check schema file exists and is complete
cat docs/schemas/expanded-resolution-map.md
```

**Required Sections:**
- File location
- Description
- Update frequency
- TypeScript interface
- JSON Schema
- Example data
- Data integrity checks
- Validation rules
- Usage in code
- Related files

---

## Integration Testing

### End-to-End Test Scenarios

#### Scenario 1: Fresh Data Processing
**Given:** New resolution data file with 3,673 resolutions
**When:** Overnight orchestrator runs
**Then:**
- [ ] Health check passes
- [ ] Resolution data loads and validates
- [ ] All resolutions are processed
- [ ] No errors in logs
- [ ] Metrics are updated in ClickHouse
- [ ] Orchestrator completes with SUCCESS status

#### Scenario 2: Stale Data Warning
**Given:** Resolution data file last updated 36 hours ago
**When:** Health check runs
**Then:**
- [ ] Freshness check returns WARNING status
- [ ] Warning message indicates "24-48h threshold"
- [ ] Other checks still pass
- [ ] Overall status is WARNING (not CRITICAL)

#### Scenario 3: Missing Data File
**Given:** Resolution data file is missing
**When:** Watchlist service attempts to auto-populate
**Then:**
- [ ] Service logs error about missing file
- [ ] Service returns fallback watchlist (empty array)
- [ ] Service does not crash
- [ ] API endpoint returns valid response

#### Scenario 4: Database Connection Failure
**Given:** ClickHouse is unreachable
**When:** Health check runs
**Then:**
- [ ] ClickHouse connection check fails with CRITICAL status
- [ ] Error message includes connection details
- [ ] Health check completes other checks
- [ ] Overall status is CRITICAL
- [ ] Exit code is 1

#### Scenario 5: Concurrent Orchestrator Runs
**Given:** Overnight orchestrator is already running
**When:** Cron triggers another run at scheduled time
**Then:**
- [ ] Second run detects first is still running
- [ ] Second run logs "already running, skipping"
- [ ] Second run exits gracefully
- [ ] First run continues uninterrupted

---

## Performance Requirements

### Execution Times
- [ ] Health check completes in < 30 seconds
- [ ] Overnight orchestrator completes in < 30 minutes
- [ ] Resolution data parsing processes 3,673 records in < 5 seconds
- [ ] Watchlist auto-populate returns in < 2 seconds

### Resource Usage
- [ ] Memory usage does not exceed 1GB during overnight processing
- [ ] No memory leaks during repeated runs
- [ ] Database connection pool does not exhaust
- [ ] File handles are properly closed

---

## Code Quality Requirements

### TypeScript
- [ ] No TypeScript compilation errors
- [ ] All functions have proper type signatures
- [ ] Interfaces defined for all data structures
- [ ] No usage of `any` type without justification

### Error Handling
- [ ] All async functions have try-catch blocks
- [ ] All errors are logged with context
- [ ] No unhandled promise rejections
- [ ] Errors include stack traces where appropriate

### Testing
- [ ] Unit test coverage >= 80% for bug fixes
- [ ] All critical paths have integration tests
- [ ] Edge cases are tested (missing data, malformed data, network failures)
- [ ] Tests run successfully in CI/CD pipeline

### Documentation
- [ ] All functions have JSDoc comments
- [ ] Environment variables are documented
- [ ] README includes setup instructions
- [ ] Runbook is clear and actionable

---

## Deployment Validation

### Pre-Production Checklist
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Manual end-to-end test successful
- [ ] Environment variables configured
- [ ] Database migrations applied
- [ ] Cron schedule verified
- [ ] Health check passes

### Post-Deployment Checklist
- [ ] Application starts successfully
- [ ] Cron jobs initialize
- [ ] Health check passes in production environment
- [ ] First overnight run completes successfully
- [ ] No errors in production logs
- [ ] Metrics are being updated in ClickHouse

### 3-Day Monitoring Period
After deployment, monitor for 3 consecutive days:

**Day 1:**
- [ ] Overnight orchestrator runs at 3 AM ET
- [ ] All steps complete successfully
- [ ] No errors in logs
- [ ] Health check shows healthy status in morning

**Day 2:**
- [ ] Overnight orchestrator runs at 3 AM ET
- [ ] All steps complete successfully
- [ ] Data freshness check passes
- [ ] Resolution count >= 3000

**Day 3:**
- [ ] Overnight orchestrator runs at 3 AM ET
- [ ] All steps complete successfully
- [ ] Performance remains consistent
- [ ] No resource leaks detected

---

## Success Criteria Summary

### Must Have (Blocking)
- All 3 bugs fixed and tested
- Health check validates all 7 components
- Overnight orchestrator runs successfully
- Cron scheduling works correctly
- Zero critical errors in production

### Should Have (High Priority)
- All unit tests pass
- Integration tests pass
- Schema documentation complete
- Performance meets targets
- 3-day monitoring successful

### Nice to Have (Low Priority)
- Additional monitoring metrics
- Performance optimizations
- Enhanced logging
- Notification system (future iteration)

---

## Acceptance Sign-Off

Once all acceptance criteria are met:

1. **Technical Validation:**
   - [ ] All automated tests pass
   - [ ] Manual testing completed
   - [ ] Code review approved
   - [ ] Documentation reviewed

2. **Operational Validation:**
   - [ ] Deployed to production
   - [ ] 3-day monitoring successful
   - [ ] No rollback required
   - [ ] Stakeholders informed

3. **Final Checklist:**
   - [ ] All deliverables completed
   - [ ] Requirements fully met
   - [ ] Known issues documented
   - [ ] Support team briefed

**Sign-off Date:** _________________

**Approved By:** _________________
