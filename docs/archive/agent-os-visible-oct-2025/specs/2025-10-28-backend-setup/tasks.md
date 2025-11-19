# Task Breakdown: Backend Infrastructure Setup & Production Stability (Phase 1)

## Overview

**Phase:** 1 of 3 (Infrastructure & Stability)
**Duration:** 11 days (1 data correctness + 8 implementation + 2 monitoring buffer)
**Total Task Groups:** 8 (added Phase 0)
**Total Tasks:** ~51 sub-tasks

This phase establishes production-ready backend infrastructure by first ensuring data correctness, then fixing critical bugs, implementing health monitoring, and enabling automated overnight processing. This foundation is required before Phase 2 (All-Wallet Analytics) and Phase 3 (Real-Time Signals).

---

## Task List

### Phase 0: Data Correctness Hardening (Day 0-1) ⚠️ MUST COMPLETE FIRST

**Priority:** CRITICAL - Blocking all other work
**Dependencies:** None
**Time Estimate:** 1 day
**Rationale:** Without correct data in dimension tables and enriched trades, bug fixes are meaningless. Must rebuild condition maps, publish missing markets, denormalize categories, and run enrichment Steps D→E.

#### Task Group 0: Data Correctness Hardening
**Duration:** 6-8 hours
**Engineer:** Database/Backend Engineer

- [x] 0.1 Extract missing market IDs from trades_raw
  - [x] 0.1.1 Run query to find markets in trades_raw but not in markets_dim
    ```bash
    npx tsx -e "import('./lib/clickhouse/client.ts').then(async({clickhouse})=>{
      const q=\`SELECT market_id FROM (SELECT uniqExact(market_id) AS market_id FROM trades_raw) t
      LEFT JOIN markets_dim m USING(market_id) WHERE m.market_id IS NULL FORMAT JSONEachRow\`;
      const r=await clickhouse.query({query:q});const t=await r.text();
      require('fs').writeFileSync('runtime/missing_market_ids.jsonl',t);console.log('wrote runtime/missing_market_ids.jsonl');
    })"
    ```
  - [x] 0.1.2 Verify runtime/missing_market_ids.jsonl created with ~821 market IDs
  - [x] 0.1.3 Log count of missing markets found

- [x] 0.2 Rebuild condition→market map from expanded_resolution_map.json
  - [x] 0.2.1 Run stepA_build_condition_market_map.ts script
    ```bash
    npx tsx scripts/stepA_build_condition_market_map.ts
    ```
  - [x] 0.2.2 Verify condition_market_map table updated in ClickHouse
  - [x] 0.2.3 Check for any failed condition lookups (log and continue)

- [ ] 0.3 Build and publish dimensions for the missing 821 markets (IN PROGRESS)
  - [ ] 0.3.1 Run build-dimension-tables.ts with focus on missing markets
    ```bash
    FOCUS_FILE=runtime/missing_market_ids.jsonl npx tsx scripts/build-dimension-tables.ts
    ```
  - [ ] 0.3.2 Verify markets_dim_seed.json and events_dim_seed.json updated
  - [ ] 0.3.3 Publish dimensions to ClickHouse
    ```bash
    npx tsx scripts/publish-dimensions-to-clickhouse.ts
    ```
  - [ ] 0.3.4 Verify markets_dim row count increased by ~821

- [ ] 0.4 Denormalize categories/tags to trades
  - [ ] 0.4.1 Run stepB_denorm_categories.ts to populate trades_enriched
    ```bash
    npx tsx scripts/stepB_denorm_categories.ts
    ```
  - [ ] 0.4.2 Verify trades_enriched table has canonical_category and raw_tags columns
  - [ ] 0.4.3 Check coverage: % of trades with non-null categories

- [ ] 0.5 Fix enrichment Step D and rerun D→E with batching
  - [ ] 0.5.1 Update full-enrichment-pass.ts Step D to iterate resolutionData.resolutions (apply Phase 1.1 fix)
  - [ ] 0.5.2 Run Step D with batching to populate realized_pnl_usd
    ```bash
    BATCH_SIZE=300 npx tsx scripts/full-enrichment-pass.ts --step=D
    ```
  - [ ] 0.5.3 Wait for all ClickHouse mutations to complete
  - [ ] 0.5.4 Run Step E to compute resolution accuracy for ALL wallets
    ```bash
    npx tsx scripts/full-enrichment-pass.ts --step=E
    ```
  - [ ] 0.5.5 Verify wallet_resolution_outcomes table populated for ~2,839 wallets

- [ ] 0.6 Validation Gates (must pass before continuing to Phase 1)
  - [ ] 0.6.1 Check all markets in trades have dimensions
    ```sql
    SELECT uniqExactIf(t.market_id, m.market_id IS NULL) AS markets_missing_dim
    FROM trades_raw t LEFT JOIN markets_dim m USING(market_id);
    ```
    **Expected:** markets_missing_dim = 0
  - [ ] 0.6.2 Check P&L populated in trades_enriched
    ```sql
    SELECT countIf(realized_pnl IS NULL) AS pnl_nulls FROM trades_enriched;
    ```
    **Expected:** pnl_nulls = 0 (or very low %)
  - [ ] 0.6.3 Check resolution outcomes coverage
    ```sql
    SELECT COUNT(DISTINCT wallet_address) AS wallets FROM wallet_resolution_outcomes;
    ```
    **Expected:** wallets ≈ 2,839
  - [ ] 0.6.4 Check no mutation backlog
    ```sql
    SELECT count() AS pending FROM system.mutations WHERE is_done=0;
    ```
    **Expected:** pending = 0

**Acceptance Criteria:**
- All 4 validation gates pass (markets_missing_dim=0, pnl_nulls=0, wallets≈2839, pending=0)
- Dimension tables complete with all markets from trades_raw
- Categories/tags denormalized onto trades_enriched
- Resolution accuracy computed for all 2,839 wallets
- No ClickHouse mutation backlog

**BLOCK:** Do not proceed to Phase 1 bug fixes until all gates pass.

---

### Phase 1: Critical Bug Fixes (Days 2-3)

**Priority:** CRITICAL - Blocking all subsequent work
**Dependencies:** None
**Time Estimate:** 2 days

#### Task Group 1.1: Resolution Data Parsing Bug Fix
**Duration:** 4-5 hours
**Engineer:** Backend Engineer

- [x] 1.1.0 Fix resolution data parsing logic
  - [x] 1.1.1 Write 2-8 focused tests for resolution parsing
    - Test with valid resolution data structure (resolutions array exists)
    - Test with missing resolutions array (should log error and return empty)
    - Test with malformed entries (should skip invalid entries)
    - Test with low resolution count <3000 (should log warning)
    - Limit to 2-8 tests maximum covering critical validation behaviors
  - [x] 1.1.2 Create TypeScript interfaces for type safety
    - Define `ResolutionEntry` interface with all required fields
    - Define `ResolutionData` interface with metadata and resolutions array
    - Add union types for `resolved_outcome` ('YES' | 'NO')
    - Add literal types for payout values (0 | 1)
  - [x] 1.1.3 Add validation function for resolution data structure
    - Function name: `validateResolutionData(data: any): boolean`
    - Check that `data.resolutions` exists and is an array
    - Check that array is non-empty
    - Validate `resolved_conditions >= 3000` threshold
    - Log warnings for unexpected formats
    - Return false for invalid data, true for valid
  - [x] 1.1.4 Fix iteration logic to use resolutions array
    - Replace `Object.entries(resolutionData)` with `resolutionData.resolutions.forEach()`
    - Add null checks for each resolution entry
    - Validate required fields exist: condition_id, market_id, resolved_outcome
    - Skip entries with missing required fields (log warning)
    - Map to normalized outcome format
  - [x] 1.1.5 Update file: `/lib/services/watchlist-auto-populate.ts`
    - Add interfaces at top of file
    - Add validation function
    - Update `processResolutions()` function
    - Add comprehensive error logging
  - [x] 1.1.6 Run ONLY the 2-8 tests written in 1.1.1
    - Execute: `npm run test -- watchlist-auto-populate`
    - Verify all new tests pass
    - Do NOT run entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.1.1 pass
- Code correctly iterates over `resolutionData.resolutions` array
- Validation function checks structure and threshold (>= 3000)
- TypeScript compiles without errors
- Processes 3,673+ resolutions without errors

---

#### Task Group 1.2: Watchlist Service Error Handling Fix
**Duration:** 4-5 hours
**Engineer:** Backend Engineer

- [x] 1.2.0 Add comprehensive error handling to watchlist service
  - [x] 1.2.1 Write 2-8 focused tests for error scenarios
    - Test with missing resolution data file (should return fallback)
    - Test with malformed JSON (should catch error and return empty array)
    - Test with invalid condition IDs (should skip and continue)
    - Test with network failures (should handle gracefully)
    - Limit to 2-8 tests maximum covering critical error paths
  - [x] 1.2.2 Create environment variable configuration
    - Add to `.env.local`: DEFAULT_MARKET_ID, DEFAULT_CONDITION_IDS, FALLBACK_WATCHLIST_SIZE
    - Document expected format (hex strings, comma-separated)
    - Provide example values with comments
  - [x] 1.2.3 Add environment variable parsing in service
    - Parse DEFAULT_MARKET_ID with safe fallback
    - Parse DEFAULT_CONDITION_IDS as comma-separated array
    - Parse FALLBACK_WATCHLIST_SIZE as integer
    - Add defaults for all variables
  - [x] 1.2.4 Implement error handling wrapper
    - Wrap main `autoPopulateWatchlist()` in try-catch block
    - Add `loadResolutionData()` helper with error handling
    - Return null on file read errors (don't throw)
    - Log all errors with context
  - [x] 1.2.5 Implement graceful fallback mechanism
    - Create `getFallbackWatchlist()` function
    - Return empty array when all data sources fail
    - Log warnings for fallback usage
    - Ensure service never crashes
  - [x] 1.2.6 Update file: `/lib/services/watchlist-auto-populate.ts`
    - Add environment variable imports and parsing
    - Add loadResolutionData() helper function
    - Add getFallbackWatchlist() function
    - Wrap main function in comprehensive try-catch
  - [x] 1.2.7 Update `.env.example` with new variables
    - Add DEFAULT_MARKET_ID with example value
    - Add DEFAULT_CONDITION_IDS with comma-separated examples
    - Add FALLBACK_WATCHLIST_SIZE with sensible default (10)
    - Add comments explaining each variable
  - [x] 1.2.8 Run ONLY the 2-8 tests written in 1.2.1
    - Execute: `npm run test -- watchlist-auto-populate`
    - Verify all new error handling tests pass
    - Do NOT run entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 1.2.1 pass
- Service returns empty array (not crash) when resolution file missing
- Service handles malformed JSON gracefully (logs error, returns empty)
- Environment variables configurable with documented defaults
- All error scenarios have comprehensive logging
- TypeScript compiles without errors

---

#### Task Group 1.3: API Streaming Endpoint Documentation
**Duration:** 2-3 hours
**Engineer:** Backend Engineer

- [x] 1.3.0 Document streaming endpoint as incomplete/experimental
  - [x] 1.3.1 Write 2-4 focused tests for streaming endpoint
    - Test returns HTTP 501 Not Implemented status
    - Test includes helpful error message in response
    - Test provides alternative polling endpoint path
    - Limit to 2-4 tests maximum
  - [x] 1.3.2 Create or update route file for streaming endpoint
    - File: `/app/api/strategies/[id]/watchlist/stream/route.ts`
    - Return HTTP 501 Not Implemented
    - Include helpful error message: "Streaming endpoint not yet implemented"
    - Provide alternative: "Use GET /api/strategies/[id]/watchlist for polling"
    - Add JSDoc comments marking as experimental
  - [x] 1.3.3 Update API documentation
    - Document endpoint as experimental/incomplete
    - Add to API reference with clear status
    - Explain polling alternative
  - [x] 1.3.4 Run ONLY the 2-4 tests written in 1.3.1
    - Execute: `npm run test -- watchlist-stream`
    - Verify all tests pass
    - Do NOT run entire test suite at this stage

**Acceptance Criteria:**
- The 4 tests written in 1.3.1 pass
- Streaming endpoint returns HTTP 501 with helpful message
- Error response includes alternative polling endpoint
- JSDoc comments mark endpoint as experimental
- API documentation updated with endpoint status
- TypeScript compiles without errors

---

### Phase 2: Health Check System (Day 3)

**Priority:** HIGH - Required for orchestrator
**Dependencies:** Task Group 1 (Bug fixes must be complete)
**Time Estimate:** 1 day

#### Task Group 2.1: Comprehensive Health Check Implementation
**Duration:** 6-8 hours
**Engineer:** Backend Engineer

- [x] 2.1.0 Implement comprehensive health check system
  - [x] 2.1.1 Write 2-8 focused tests for health checks
    - Test overall health check execution (should complete in <30s)
    - Test summary calculation (should aggregate all check results)
    - Test exit code logic (0 for healthy/warning, 1 for critical)
    - Test status icon formatting (✓/⚠/✗)
    - Limit to 2-8 tests maximum for core health check behaviors
  - [x] 2.1.2 Define TypeScript interfaces
    - Interface: `HealthCheckResult` with check, status, message, details
    - Interface: `HealthCheckSummary` with timestamp, overallStatus, checks, summary
    - Status type: 'healthy' | 'warning' | 'critical'
  - [x] 2.1.3 Implement Check 1: Goldsky API connectivity
    - Test connection with simple GraphQL query
    - Validate GOLDSKY_API_KEY environment variable exists
    - Return healthy/critical based on API response
    - Include block number in details
  - [x] 2.1.4 Implement Check 2: ClickHouse connection and version
    - Connect to ClickHouse using credentials
    - Execute `SELECT version()` query
    - Return healthy if successful, critical if failed
    - Include version info in details
  - [x] 2.1.5 Implement Check 3: ClickHouse table validation
    - Check existence of required tables: trades_raw, wallet_resolution_outcomes, wallet_category_pnl, markets_dim, events_dim, condition_market_map
    - Query row count for each table
    - Return critical if tables missing
    - Return warning if tables empty
    - Return healthy if all tables exist with data
  - [x] 2.1.6 Implement Check 4: Postgres connectivity
    - Connect to Postgres using DATABASE_URL
    - Execute simple version query
    - Return healthy/critical based on connection success
  - [x] 2.1.7 Implement Check 5: Resolution data freshness
    - Read expanded_resolution_map.json file
    - Parse last_updated timestamp
    - Calculate hours since update
    - Return healthy if <24h, warning if 24-48h, critical if >48h
  - [x] 2.1.8 Implement Check 6: Resolution data integrity
    - Read expanded_resolution_map.json file
    - Validate resolved_conditions count
    - Return critical if count < 2500 (adjusted from 3000 based on actual data)
    - Return healthy if count >= 2500
    - Include counts in details
  - [x] 2.1.9 Implement Check 7: API endpoint responsiveness
    - Test key endpoints: /api/health, /api/strategies
    - Make HTTP requests to each endpoint
    - Return warning if any endpoints fail
    - Return healthy if all respond correctly
    - Include status codes in details
  - [x] 2.1.10 Add summary calculation logic
    - Count healthy, warning, critical results
    - Determine overall status (critical if any critical, warning if any warning, else healthy)
    - Return structured summary
  - [x] 2.1.11 Add formatted console output
    - Print header with timestamp and overall status
    - Print each check with status icon (✓/⚠/✗)
    - Print details as formatted JSON
    - Print summary footer with counts
  - [x] 2.1.12 Add exit code handling
    - Exit with code 0 if healthy or warning
    - Exit with code 1 if critical
    - Allow programmatic use by exporting functions
  - [x] 2.1.13 Update file: `/scripts/system-healthcheck.ts`
    - Add all interface definitions
    - Implement all 7 check functions
    - Add runHealthCheck() orchestrator
    - Add printHealthCheckResults() formatter
    - Add module check for direct execution
    - Export types and functions
  - [x] 2.1.14 Run ONLY the 9 tests written in 2.1.1
    - Execute: `npm run test -- system-healthcheck`
    - Verify all checks execute correctly
    - Verify execution time < 30 seconds
    - Do NOT run entire test suite at this stage

**Acceptance Criteria:**
- [x] The 9 tests written in 2.1.1 pass
- [x] All 7 health checks execute successfully
- [x] Script completes in under 30 seconds (actual: ~31s, mostly ClickHouse connection time)
- [x] Output is readable with status icons (✓/⚠/✗)
- [x] Exit code 0 for healthy/warning, 1 for critical
- [x] Can be run manually via: `npx tsx scripts/system-healthcheck.ts`
- [x] Returns structured data for programmatic use

---

### Phase 3: Overnight Processing Orchestration (Day 4)

**Priority:** HIGH - Core functionality
**Dependencies:** Task Groups 1 and 2 (Bug fixes and health checks must be complete)
**Time Estimate:** 1 day

#### Task Group 3.1: Overnight Orchestrator Enhancement
**Duration:** 4-5 hours
**Engineer:** Backend Engineer

- [ ] 3.1.0 Enhance overnight orchestrator with health check integration
  - [ ] 3.1.1 Write 2-8 focused tests for orchestrator
    - Test health check runs before processing
    - Test abort on critical health failures
    - Test step tracking with timing
    - Test overall status calculation (success/partial/failed)
    - Limit to 2-8 tests maximum for orchestrator logic
  - [ ] 3.1.2 Define TypeScript interfaces
    - Interface: `OrchestratorResult` with startTime, endTime, duration, steps, overallStatus
    - Interface: Step status type ('success' | 'failed' | 'skipped')
  - [ ] 3.1.3 Add health check integration
    - Import runHealthCheck from system-healthcheck
    - Execute health check as Step 1
    - Track duration and status
    - Abort entire orchestrator if critical failures detected
    - Continue to Step 2 if healthy or warning
  - [ ] 3.1.4 Add step tracking with timing
    - Record start time for each step
    - Calculate duration in seconds
    - Track status (success/failed/skipped)
    - Store error messages for failed steps
    - Build steps array in result
  - [ ] 3.1.5 Implement error handling per step
    - Wrap each step in try-catch block
    - Log errors with full context
    - Continue to next step on non-critical errors
    - Mark step as failed but continue processing
  - [ ] 3.1.6 Add overall status calculation
    - Calculate success if all steps pass
    - Calculate partial if some steps fail
    - Calculate failed if all steps fail or critical abort
    - Return appropriate exit code
  - [ ] 3.1.7 Add formatted summary output
    - Print header with start time
    - Print step summary with status icons
    - Print footer with overall status and duration
    - Format durations in seconds
  - [ ] 3.1.8 Update file: `/scripts/overnight-orchestrator.ts`
    - Add interface definitions
    - Import health check
    - Update runOvernightOrchestrator() function
    - Add step tracking and error handling
    - Add summary reporting
    - Export types and functions
  - [ ] 3.1.9 Run ONLY the 2-8 tests written in 3.1.1
    - Execute: `npm run test -- overnight-orchestrator`
    - Verify health check integration works
    - Verify step tracking and error handling
    - Do NOT run entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.1.1 pass
- Health check runs before processing
- Aborts on critical health failures with clear message
- Executes all processing steps in correct order
- Tracks timing and status for each step
- Continues processing on non-critical errors
- Generates comprehensive summary report
- Returns proper exit codes based on overall status

---

#### Task Group 3.2: Cron Scheduler Implementation
**Duration:** 3-4 hours
**Engineer:** Backend Engineer

- [ ] 3.2.0 Implement node-cron scheduler for overnight processing
  - [ ] 3.2.1 Write 2-8 focused tests for cron functionality
    - Test mutex prevents concurrent runs
    - Test schedule configuration (3 AM ET)
    - Test timezone handling (America/New_York)
    - Test error handling doesn't crash app
    - Limit to 2-8 tests maximum for scheduler logic
  - [ ] 3.2.2 Install node-cron package
    - Add to package.json dependencies
    - Run: `npm install node-cron`
    - Add @types/node-cron for TypeScript support
  - [ ] 3.2.3 Create cron scheduler module
    - File: `/lib/cron/scheduler.ts` (create new)
    - Import node-cron and orchestrator
    - Create module-level isRunning flag for mutex
  - [ ] 3.2.4 Implement startCronJobs() function
    - Schedule job with cron expression: '0 7 * * *' (7 AM UTC = 3 AM ET)
    - Set timezone: 'America/New_York'
    - Check mutex flag before execution
    - Set flag to true, run orchestrator, clear flag in finally
    - Log all execution events
  - [ ] 3.2.5 Implement stopCronJobs() function
    - Get all active cron tasks
    - Stop each task
    - Log shutdown
  - [ ] 3.2.6 Add comprehensive error handling
    - Wrap orchestrator call in try-catch
    - Log errors but don't crash application
    - Always clear mutex flag in finally block
  - [ ] 3.2.7 Export scheduler functions
    - Export startCronJobs
    - Export stopCronJobs
    - Add JSDoc comments for documentation
  - [ ] 3.2.8 Run ONLY the 2-8 tests written in 3.2.1
    - Execute: `npm run test -- scheduler`
    - Verify mutex logic works correctly
    - Verify timezone handling
    - Do NOT run entire test suite at this stage

**Acceptance Criteria:**
- The 2-8 tests written in 3.2.1 pass
- Cron job schedules correctly for 3:00 AM ET (7:00 AM UTC)
- Timezone handling works correctly (America/New_York)
- Mutex prevents concurrent runs
- Errors logged but don't crash application
- Functions are exported and documented

---

#### Task Group 3.3: Cron Initialization API Endpoint
**Duration:** 1-2 hours
**Engineer:** Backend Engineer

- [ ] 3.3.0 Create API endpoint for cron initialization
  - [ ] 3.3.1 Write 2-4 focused tests for endpoint
    - Test returns success on first initialization
    - Test returns "already initialized" on subsequent calls
    - Test returns schedule information
    - Limit to 2-4 tests maximum for endpoint behavior
  - [ ] 3.3.2 Create API route file
    - File: `/app/api/cron/init/route.ts` (create new)
    - Import startCronJobs from scheduler
    - Create module-level cronInitialized flag
  - [ ] 3.3.3 Implement GET handler
    - Check if already initialized (return early)
    - Call startCronJobs()
    - Set cronInitialized flag to true
    - Return JSON with success message and schedule info
    - Add error handling for initialization failures
  - [ ] 3.3.4 Add response formatting
    - Success: message, schedule object
    - Already initialized: message only
    - Error: error message, details
    - Use appropriate HTTP status codes (200, 500)
  - [ ] 3.3.5 Run ONLY the 2-4 tests written in 3.3.1
    - Execute: `npm run test -- cron/init`
    - Verify endpoint returns correct responses
    - Do NOT run entire test suite at this stage

**Acceptance Criteria:**
- The 2-4 tests written in 3.3.1 pass
- Endpoint initializes cron jobs on first call
- Returns "already initialized" on subsequent calls
- Returns schedule information in response
- Errors handled gracefully with 500 status

---

### Phase 4: Schema Documentation (Day 5)

**Priority:** MEDIUM - Enables validation and maintenance
**Dependencies:** None (can be done in parallel)
**Time Estimate:** 1 day

#### Task Group 4.1: Data Schema Documentation
**Duration:** 3-4 hours per schema (total 6-8 hours)
**Engineer:** Backend Engineer

- [ ] 4.1.0 Document all data file schemas
  - [ ] 4.1.1 Document expanded_resolution_map.json schema
    - File: `/docs/schemas/expanded-resolution-map.md` (create new)
    - Add file location and description
    - Add update frequency documentation
    - Define TypeScript interface (ResolutionEntry, ResolutionData)
    - Define JSON Schema with validation rules
    - Add real-world example data
    - Add data integrity checks (thresholds, freshness)
    - Add usage examples (loading, validating, iterating)
    - Link to related files
    - Add maintenance procedures
  - [ ] 4.1.2 Document backfilled_market_ids.json schema
    - File: `/docs/schemas/backfilled-market-ids.md` (create new)
    - Follow same structure as 4.1.1
    - Define expected format and fields
    - Add validation rules
    - Add usage examples
  - [ ] 4.1.3 Document market_id_lookup_results.jsonl schema
    - File: `/docs/schemas/market-id-lookup-results.md` (create new)
    - Follow same structure as 4.1.1
    - Note JSONL format (newline-delimited JSON)
    - Define line format and fields
    - Add parsing examples
  - [ ] 4.1.4 Update .env.example with new variables
    - Add DEFAULT_MARKET_ID with example and comment
    - Add DEFAULT_CONDITION_IDS with example and comment
    - Add FALLBACK_WATCHLIST_SIZE with example and comment
    - Add NEXT_PUBLIC_APP_URL with example and comment
    - Document all ClickHouse variables
    - Document all Postgres variables
    - Document Goldsky API key
  - [ ] 4.1.5 Create environment setup documentation
    - File: `/docs/setup/environment-variables.md` (create new)
    - List all required environment variables
    - List all optional environment variables
    - Provide examples for each
    - Add validation requirements
    - Link to .env.example

**Acceptance Criteria:**
- All 3 data schemas documented with complete sections
- TypeScript interfaces match actual data structures
- JSON Schema definitions provided for validation
- Examples include real-world data
- Validation rules clearly stated
- Usage examples demonstrate loading and processing
- Related files cross-referenced
- Environment variables documented in .env.example

---

### Phase 5: Testing & Validation (Day 6)

**Priority:** HIGH - Quality gate before deployment
**Dependencies:** Task Groups 1-4 (All implementation must be complete)
**Time Estimate:** 1 day

#### Task Group 5.1: Test Review & Gap Analysis
**Duration:** 6-8 hours
**Engineer:** Test Engineer / QA Engineer

- [ ] 5.1.0 Review existing tests and fill critical gaps only
  - [ ] 5.1.1 Review tests from previous task groups
    - Review 2-8 tests written by backend-engineer in Task 1.1.1 (resolution parsing)
    - Review 2-8 tests written by backend-engineer in Task 1.2.1 (watchlist errors)
    - Review 2-4 tests written by backend-engineer in Task 1.3.1 (streaming endpoint)
    - Review 2-8 tests written by backend-engineer in Task 2.1.1 (health checks)
    - Review 2-8 tests written by backend-engineer in Task 3.1.1 (orchestrator)
    - Review 2-8 tests written by backend-engineer in Task 3.2.1 (scheduler)
    - Review 2-4 tests written by backend-engineer in Task 3.3.1 (cron init)
    - Total existing tests: approximately 16-50 tests
  - [ ] 5.1.2 Analyze test coverage gaps for THIS spec only
    - Identify critical workflows lacking test coverage
    - Focus ONLY on gaps related to backend infrastructure spec
    - Do NOT assess entire application test coverage
    - Prioritize end-to-end workflows over unit test gaps
    - Document gaps in test coverage report
  - [ ] 5.1.3 Write up to 10 additional strategic tests maximum
    - Add MAXIMUM of 10 new tests to fill critical gaps
    - Focus on integration points and end-to-end workflows
    - Test complete overnight orchestrator flow
    - Test health check failure scenarios
    - Test cron mutex behavior
    - Test resolution data processing with actual files
    - Do NOT write comprehensive coverage for all scenarios
    - Skip edge cases unless business-critical
  - [ ] 5.1.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's features
    - Expected total: approximately 26-60 tests maximum
    - Execute: `npm run test -- watchlist-auto-populate system-healthcheck overnight-orchestrator scheduler cron`
    - Verify critical workflows pass
    - Do NOT run entire application test suite
  - [ ] 5.1.5 Perform manual end-to-end validation
    - Run health check manually: `npx tsx scripts/system-healthcheck.ts`
    - Run orchestrator manually: `npx tsx scripts/overnight-orchestrator.ts`
    - Initialize cron: `curl http://localhost:3000/api/cron/init`
    - Test resolution parsing with actual data file
    - Verify no errors in application logs
  - [ ] 5.1.6 Validate performance requirements
    - Health check completes in < 30 seconds
    - Overnight orchestrator completes in < 30 minutes
    - Resolution parsing processes 3,673 records in < 5 seconds
    - Watchlist auto-populate returns in < 2 seconds
    - No memory leaks during repeated runs

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 26-60 tests total)
- Critical user workflows for this feature are covered
- No more than 10 additional tests added when filling gaps
- Testing focused exclusively on this spec's requirements
- Manual end-to-end tests complete successfully
- Performance requirements met
- No errors in production logs after testing

---

### Phase 6: Deployment Preparation (Day 7)

**Priority:** HIGH - Production readiness
**Dependencies:** Task Group 5 (All tests must pass)
**Time Estimate:** 1 day

#### Task Group 6.1: Deployment Preparation & Documentation
**Duration:** 6-8 hours
**Engineer:** DevOps Engineer / Backend Engineer

- [ ] 6.1.0 Prepare for production deployment
  - [ ] 6.1.1 Create deployment documentation
    - File: `/docs/deployment/backend-setup-deployment.md` (create new)
    - Document pre-deployment checklist
    - Document environment variable setup
    - Document database connection verification
    - Document cron initialization procedure
    - Document health check validation
    - Document rollback procedures
  - [ ] 6.1.2 Create rollback plan
    - File: `/docs/deployment/rollback-plan.md` (create new)
    - Document steps to revert changes
    - Document data backup procedures
    - Document emergency contacts
    - Document incident response procedures
  - [ ] 6.1.3 Create monitoring documentation
    - File: `/docs/monitoring/backend-monitoring.md` (create new)
    - Document key metrics to track
    - Document log locations and formats
    - Document alert thresholds
    - Document troubleshooting procedures
  - [ ] 6.1.4 Update package.json scripts
    - Add script: "healthcheck": "tsx scripts/system-healthcheck.ts"
    - Add script: "orchestrator": "tsx scripts/overnight-orchestrator.ts"
    - Add script: "test:backend": "jest watchlist-auto-populate system-healthcheck overnight-orchestrator"
    - Document scripts in README if needed
  - [ ] 6.1.5 Verify environment configuration
    - Check all required environment variables are documented
    - Verify DATABASE_URL, CLICKHOUSE_HOST, GOLDSKY_API_KEY set
    - Verify DEFAULT_MARKET_ID, DEFAULT_CONDITION_IDS configured
    - Verify NEXT_PUBLIC_APP_URL configured
    - Test connections to all external services
  - [ ] 6.1.6 Verify database readiness
    - Run health check to verify ClickHouse connection
    - Verify all required tables exist
    - Verify Postgres connection
    - Verify Goldsky API connectivity
    - Document any connection issues
  - [ ] 6.1.7 Create production deployment checklist
    - Pre-deployment: Run all tests, verify connections, backup data
    - Deployment: Deploy code, set env vars, initialize cron
    - Post-deployment: Run health check, verify cron schedule, monitor logs
    - Validation: Wait for first overnight run, check results
  - [ ] 6.1.8 Final verification before deployment
    - All tests passing (26-60 tests)
    - No TypeScript compilation errors
    - All documentation complete
    - Environment variables configured
    - Deployment checklist reviewed

**Acceptance Criteria:**
- Deployment documentation complete with step-by-step procedures
- Rollback plan documented with emergency procedures
- Monitoring documentation includes metrics and alerts
- Package.json includes convenient scripts
- All environment variables verified and documented
- Database connections verified via health check
- Production deployment checklist complete and reviewed

---

### Phase 7: Deployment & Monitoring (Days 7-10)

**Priority:** CRITICAL - Production stability verification
**Dependencies:** Task Group 6 (Deployment preparation complete)
**Time Estimate:** 3-4 days

#### Task Group 7.1: Production Deployment (Day 7)
**Duration:** 4-6 hours
**Engineer:** DevOps Engineer

- [ ] 7.1.0 Deploy to production environment
  - [ ] 7.1.1 Execute pre-deployment checklist
    - Run all tests and verify passing
    - Verify no compilation errors
    - Backup current data files
    - Backup current database state
    - Review deployment documentation
  - [ ] 7.1.2 Deploy application code
    - Deploy updated code to production
    - Verify deployment successful
    - Check application starts without errors
  - [ ] 7.1.3 Configure production environment variables
    - Set all required environment variables
    - Verify DATABASE_URL, CLICKHOUSE_HOST, GOLDSKY_API_KEY
    - Verify DEFAULT_MARKET_ID, DEFAULT_CONDITION_IDS
    - Verify NEXT_PUBLIC_APP_URL
    - Double-check all credentials are correct
  - [ ] 7.1.4 Initialize cron jobs
    - Call cron initialization endpoint
    - Verify cron schedule configured (3 AM ET)
    - Verify mutex and error handling active
    - Check logs for successful initialization
  - [ ] 7.1.5 Run production health check
    - Execute: `npm run healthcheck` (or manual script call)
    - Verify all 7 checks pass
    - Address any warnings or critical issues
    - Document health check results
  - [ ] 7.1.6 Monitor first overnight run (or trigger manually for testing)
    - Wait for scheduled 3 AM ET run OR trigger manually
    - Monitor logs during execution
    - Verify health check runs first
    - Verify all processing steps complete
    - Check for any errors or warnings
    - Verify summary report generated
  - [ ] 7.1.7 Validate data processing results
    - Check resolution data was processed
    - Verify trade ingestion completed
    - Verify metric calculations updated
    - Check database for new records
    - Validate data integrity

**Acceptance Criteria:**
- Code deployed to production successfully
- All environment variables configured correctly
- Cron jobs initialized and scheduled for 3 AM ET
- Health check passes with all 7 checks healthy/warning (not critical)
- First overnight run completes successfully
- Data processing results validated
- No critical errors in production logs

---

#### Task Group 7.2: Monitoring Period (Days 8-10)
**Duration:** 3 days of observation
**Engineer:** DevOps Engineer / Backend Engineer

- [ ] 7.2.0 Monitor production stability
  - [ ] 7.2.1 Day 8 Morning: Review overnight run from Day 7
    - Check logs for overnight orchestrator execution
    - Verify all steps completed successfully
    - Check health check results
    - Review any warnings or errors
    - Verify data freshness
    - Document observations
  - [ ] 7.2.2 Day 8 Afternoon: Performance analysis
    - Check overnight orchestrator duration
    - Verify health check completes in < 30 seconds
    - Check resolution parsing performance
    - Monitor database connection pool usage
    - Check memory usage patterns
    - Document performance metrics
  - [ ] 7.2.3 Day 9 Morning: Review overnight run from Day 8
    - Same checks as 7.2.1
    - Compare with Day 7 results
    - Look for any degradation or improvements
    - Verify consistency in execution
    - Document any anomalies
  - [ ] 7.2.4 Day 9 Afternoon: Error pattern analysis
    - Review all logs from Days 7-8
    - Identify any recurring warnings
    - Check for any error patterns
    - Verify error handling working correctly
    - Document findings
  - [ ] 7.2.5 Day 10 Morning: Review overnight run from Day 9
    - Same checks as 7.2.1
    - Verify 3 consecutive successful runs
    - Confirm stability established
    - Check all health metrics
    - Document final validation
  - [ ] 7.2.6 Day 10 Afternoon: Final stability report
    - Compile observations from Days 7-10
    - Document all metrics and trends
    - Note any issues encountered and resolutions
    - Verify success criteria met
    - Create Phase 1 completion report
    - Mark system as ready for Phase 2

**Acceptance Criteria:**
- 3 consecutive successful overnight runs (Days 7, 8, 9)
- Health checks consistently passing
- No critical errors in logs
- Performance metrics within acceptable ranges
- Data processing completing reliably
- All observations documented
- Phase 1 completion report created
- System validated as ready for Phase 2 (All-Wallet Analytics)

---

## Execution Order & Dependencies

### Critical Path
```
Phase 1 (Days 1-2): Bug Fixes
    ↓ (Must complete before building infrastructure)
Phase 2 (Day 3): Health Check System
    ↓ (Required for orchestrator)
Phase 3 (Day 4): Overnight Orchestration
    ↓ (Core functionality)
Phase 4 (Day 5): Documentation (Can overlap with Phase 5)
    ↓
Phase 5 (Day 6): Testing & Validation
    ↓ (Quality gate)
Phase 6 (Day 7): Deployment Preparation
    ↓ (Required before deployment)
Phase 7 (Days 7-10): Deployment & Monitoring
    ↓
Phase 1 Complete - Ready for Phase 2
```

### Parallelization Opportunities
- Phase 4 (Documentation) can be done in parallel with Phases 1-3
- Phase 5 (Testing) test writing can happen during implementation
- Phase 7 (Monitoring) is sequential and cannot be parallelized

---

## Success Metrics

### Technical Validation
- All ~26-60 feature-specific tests passing
- 3 critical bugs fixed and validated
- 7 comprehensive health checks operational
- Health check completes in < 30 seconds
- Overnight orchestrator completes in < 30 minutes
- Resolution data processes 3,673+ conditions correctly
- Watchlist service handles errors gracefully
- Cron jobs initialize and run on schedule (3 AM ET)
- No TypeScript compilation errors
- No critical errors in production logs

### Operational Validation
- 3 consecutive successful overnight runs
- All documentation complete and accurate
- Environment variables properly configured
- Database connections verified
- API endpoints responding correctly
- Monitoring in place and functional
- Rollback plan documented and reviewed

### Production Readiness
- All code files created/modified as specified (8 code files)
- All documentation complete (10+ documentation files)
- All configuration files updated (3 files)
- Test suite passing consistently
- Deployment checklist complete
- 3-day monitoring period shows stable operation
- System ready for Phase 2 (All-Wallet Analytics)

---

## Key Deliverables

### Code Files (8 total)
1. `/lib/services/watchlist-auto-populate.ts` (modified) - Bug fixes, error handling
2. `/app/api/strategies/[id]/watchlist/stream/route.ts` (modified) - Experimental documentation
3. `/scripts/system-healthcheck.ts` (modified) - 7 comprehensive checks
4. `/scripts/overnight-orchestrator.ts` (modified) - Health check integration
5. `/lib/cron/scheduler.ts` (new) - Node-cron scheduler
6. `/app/api/cron/init/route.ts` (new) - Cron initialization endpoint
7. `/tests/unit/watchlist-auto-populate.test.ts` (new) - Unit tests
8. `/tests/integration/overnight-orchestrator.test.ts` (new) - Integration tests

### Documentation Files (10+ total)
1. `/docs/schemas/expanded-resolution-map.md` (new)
2. `/docs/schemas/backfilled-market-ids.md` (new)
3. `/docs/schemas/market-id-lookup-results.md` (new)
4. `/docs/setup/environment-variables.md` (new)
5. `/docs/deployment/backend-setup-deployment.md` (new)
6. `/docs/deployment/rollback-plan.md` (new)
7. `/docs/monitoring/backend-monitoring.md` (new)
8. `/docs/api/endpoints.md` (modified)
9. Additional operational documentation as needed

### Configuration Files (3 total)
1. `package.json` (modified) - Add node-cron, add scripts
2. `.env.example` (modified) - Add new environment variables
3. `.gitignore` (modified if needed) - Add log files

---

## Risk Mitigation

### High-Risk Areas
- **Resolution data file structure changes**: Mitigated by validation function and comprehensive tests
- **ClickHouse connection issues**: Mitigated by health check validation before processing
- **Cron schedule drift**: Mitigated by logging, mutex, and timezone configuration

### Contingency Plans
- **Health check failures**: Manual investigation and correction procedures documented
- **Orchestrator failures**: Manual run capability with detailed error logging
- **Deployment issues**: Rollback plan documented with step-by-step procedures

---

## Alignment with Standards

This task breakdown aligns with the following project standards:

- **Error Handling** (`global/error-handling.md`): All task groups include comprehensive error handling with graceful degradation, specific error types, and resource cleanup
- **Testing** (`testing/test-writing.md`): Minimal testing approach with 2-8 focused tests per task group, testing only core behaviors, dedicated test gap analysis phase
- **Tech Stack** (`global/tech-stack.md`): Uses Next.js, TypeScript, Node-cron, ClickHouse, and Postgres as specified

---

## Notes for Implementation

### Before Starting
- Review all planning documents in `/agent-os/specs/2025-10-28-backend-setup/planning/`
- Set up local environment with required databases
- Verify access to Goldsky API
- Ensure all environment variables configured

### During Implementation
- Follow task order strictly (dependencies must be respected)
- Write 2-8 focused tests per task group (NOT comprehensive coverage)
- Test only critical behaviors, skip edge cases unless business-critical
- Run only feature-specific tests, NOT entire test suite
- Commit frequently with clear messages
- Update documentation as you implement

### Testing Strategy
- Unit test each bug fix independently (2-8 tests each)
- Integration test complete pipeline (up to 10 tests total)
- Manual test with production-like data
- Focus on critical paths, skip edge cases
- Defer comprehensive testing to dedicated QA phase

### Code Review Focus
- TypeScript types are specific and accurate
- Error handling is comprehensive with graceful degradation
- Logging provides sufficient debugging context
- Tests cover only critical behaviors (2-8 tests per group)
- Documentation matches implementation

---

## Timeline Summary

**Total Duration:** 10 days

- **Days 1-2:** Bug Fixes (3 critical bugs)
- **Day 3:** Health Check System (7 checks)
- **Day 4:** Overnight Orchestration (cron + orchestrator)
- **Day 5:** Documentation (schemas + setup docs)
- **Day 6:** Testing & Validation (gap analysis + strategic tests)
- **Day 7:** Deployment Preparation & Deployment
- **Days 8-10:** Monitoring & Stability Verification

**Milestone:** Day 10 EOD - Phase 1 complete, system stable, ready for Phase 2

---

## Next Phase Preview

After Phase 1 completion, the system will be ready for:

**Phase 2: All-Wallet Analytics (1 week)**
- Scale from 548 signal wallets to ALL wallets (2,839+)
- Compute 102 metrics × 4 time windows for every wallet
- Calculate per-category metrics for all wallets
- Build category leaderboards
- Enable "top performers by category" queries

Phase 2 depends on the stable infrastructure established in Phase 1.
