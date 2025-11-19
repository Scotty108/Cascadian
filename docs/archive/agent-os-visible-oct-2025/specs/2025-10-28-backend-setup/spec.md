# Specification: Backend Infrastructure Setup & Production Stability

## ⚠️ PHASE 1 OF 3-PHASE ROLLOUT

**This spec covers Phase 1 only: Infrastructure & Stability**

- **Phase 1** (This Spec): Fix critical bugs, establish stable infrastructure, health monitoring, overnight processing - **10 days**
- **Phase 2** (Future Spec): All-Wallet Analytics - ingest all wallets, compute 102 metrics per wallet per category, resolution accuracy for all - **1 week**
- **Phase 3** (Future Spec): Real-Time Watchlist Signals - second-by-second price monitoring, momentum/acceleration triggers, auto-execute per strategy - **1 week**

**Total Timeline: ~4 weeks for complete backend system**

---

## Goal

Establish production-ready backend infrastructure with dual-database architecture (ClickHouse + Supabase), fix critical data processing bugs, implement comprehensive health monitoring, and enable automated overnight processing workflows to ensure stable, reliable data ingestion and analytics capabilities.

**Phase 1 Focus:** Foundation for analytics and real-time features to be built in subsequent phases.

## User Stories

- As a **platform operator**, I want critical data processing bugs fixed so that market resolutions are parsed correctly and watchlist services operate reliably
- As a **platform operator**, I want comprehensive health checks so that I can verify system readiness before demos and detect issues proactively
- As a **platform operator**, I want automated overnight processing so that new trade data is ingested and metrics are updated daily without manual intervention
- As a **developer**, I want documented data schemas so that I can understand file structures and implement data validation correctly
- As a **developer**, I want clear error handling with graceful degradation so that services continue operating even when non-critical components fail

## Core Requirements

### Bug Fixes (Critical - Blocking)

**Resolution Data Parsing (Bug #1):**
- Fix iteration logic to use `resolutionData.resolutions` array instead of top-level object
- Add validation function checking for required structure and data integrity
- Implement minimum threshold check (resolved_conditions >= 3000)
- Add TypeScript interfaces for type safety
- Log warnings for unexpected data formats

**Watchlist Service Reliability (Bug #2):**
- Add comprehensive error handling with try-catch blocks
- Implement graceful fallback mechanism when resolution data is unavailable
- Make default market/condition IDs configurable via environment variables
- Ensure service returns empty array instead of crashing on errors
- Log all errors with sufficient context for debugging

**API Streaming Endpoint (Bug #3):**
- Document endpoint as experimental with clear status
- Return HTTP 501 Not Implemented with helpful error message
- Provide alternative polling endpoint path in response
- Prevent confusion about feature availability

### Health Monitoring System

**7 Comprehensive Health Checks:**
1. Goldsky API connectivity and authentication
2. ClickHouse database connection and version check
3. ClickHouse table existence and row count validation
4. Postgres database connectivity
5. Resolution data file freshness (24h healthy, 24-48h warning, 48h+ critical)
6. Resolution data integrity (count >= 3000)
7. API endpoint responsiveness testing

**Health Check Requirements:**
- Complete within 30 seconds
- Return clear status for each check (healthy/warning/critical)
- Calculate overall status based on worst individual status
- Output formatted results with icons and details
- Return proper exit codes (0 = healthy, 1 = issues)
- Can be run manually or programmatically

### Overnight Processing Orchestration

**Automated Pipeline:**
- Run health check before processing (abort on critical failures)
- Execute steps sequentially: health → ingest → compute → update
- Track timing and status for each step
- Continue to next step on non-critical failures
- Generate summary report with overall status

**Cron Scheduling:**
- Use node-cron within Next.js application (no separate daemon)
- Schedule for 3:00 AM ET daily (7:00 AM UTC)
- Implement mutex/flag to prevent concurrent runs
- Log all execution events with timestamps
- Handle errors without crashing application

**Processing Steps:**
1. Health check validation
2. Ingest new trades from Goldsky
3. Compute resolution outcomes
4. Update wallet category PnL and metrics

### Data Schema Documentation

**Required Documentation:**
- TypeScript interface definitions
- JSON Schema specifications
- Example data with real-world values
- Update frequency and maintenance procedures
- Validation rules and integrity checks
- Usage examples showing how to load and process data
- Related file references

**Files to Document:**
- `expanded_resolution_map.json` - Market resolution outcomes
- `backfilled_market_ids.json` - Market ID reference data
- `market_id_lookup_results.jsonl` - Market lookup cache

## Visual Design

No visual mockups required - this is backend infrastructure work.

## Reusable Components

### Existing Code to Leverage

**ClickHouse Connection Patterns:**
- Reference: `/scripts/create-tables-direct.ts`
- Pattern: ClickHouse client initialization and query execution
- Reuse: Connection setup, table validation logic

**Goldsky API Integration:**
- Reference: `/scripts/goldsky-full-historical-load.ts`
- Pattern: GraphQL query construction, authentication headers
- Reuse: API connection logic, error handling patterns

**Resolution Processing:**
- Reference: `/scripts/compute-resolution-outcomes.ts`
- Pattern: Data transformation and outcome calculation
- Reuse: Processing patterns, aggregation logic

**Metric Calculation:**
- Reference: `/scripts/compute-wallet-category-pnl.ts`
- Pattern: Aggregation queries and metric computation
- Reuse: Calculation logic, batch processing patterns

**Next.js API Routes:**
- Reference: `/app/api/strategies/[id]/watchlist/route.ts`
- Pattern: Request handling, response formatting
- Reuse: API route structure, error responses

**Error Handling:**
- Reference: `/lib/services/watchlist-auto-populate.ts`
- Pattern: Try-catch blocks, fallback mechanisms
- Reuse: Service-level error handling approach

### New Components Required

**Cron Scheduler Service:**
- Location: `/lib/cron/scheduler.ts`
- Reason: No existing cron infrastructure in Next.js app
- Dependencies: node-cron package
- Features: Job scheduling, timezone handling, mutex locking

**Cron Init API Endpoint:**
- Location: `/app/api/cron/init/route.ts`
- Reason: Need endpoint to initialize cron jobs on app startup
- Purpose: Allow manual triggering and status checking

**Comprehensive Health Check Script:**
- Location: `/scripts/system-healthcheck.ts` (already exists but needs updates)
- Reason: Existing script incomplete, missing several required checks
- Updates: Add API endpoint checks, resolution integrity validation, formatted output

**Enhanced Orchestrator:**
- Location: `/scripts/overnight-orchestrator.ts` (already exists but needs updates)
- Reason: Existing orchestrator needs health check integration and better error handling
- Updates: Add pre-flight health check, improve step tracking, enhance summary reporting

## Technical Approach

### Bug Fix Implementation Strategy

**Resolution Data Parsing (Priority 1):**
1. Add validation function at top of `/lib/services/watchlist-auto-populate.ts`
2. Create TypeScript interfaces for ResolutionEntry and ResolutionData
3. Replace Object.entries() iteration with array forEach on resolutions property
4. Add null checks and field validation for each resolution
5. Log warnings for missing fields or low resolution counts
6. Write unit tests covering valid data, missing array, and invalid entries

**Watchlist Service Hardening (Priority 2):**
1. Create environment variables in .env.local for DEFAULT_MARKET_ID, DEFAULT_CONDITION_IDS
2. Add loadResolutionData() function with try-catch and null return on error
3. Implement getFallbackWatchlist() returning empty array
4. Wrap autoPopulateWatchlist() in comprehensive try-catch
5. Test with missing file, malformed JSON, and invalid condition IDs

**API Streaming Endpoint (Priority 3):**
1. Update route file to return 501 status code
2. Add JSDoc comments marking as experimental
3. Include alternative endpoint in error response
4. Document status in API reference

### Health Check Architecture

**Module Organization:**
- Single runHealthCheck() function orchestrating all checks
- Individual check functions returning HealthCheckResult interface
- Summary calculation determining overall status
- Formatted output function for console display
- Export types and functions for programmatic use

**Check Execution Pattern:**
```typescript
async function checkComponent(): Promise<HealthCheckResult> {
  try {
    // Attempt connection/validation
    // Return { check: 'name', status: 'healthy', message: '...', details: {...} }
  } catch (error) {
    // Return { check: 'name', status: 'critical', message: error.message }
  }
}
```

**Thresholds and Status Logic:**
- Critical: Component completely unavailable or data severely compromised
- Warning: Component operational but suboptimal (stale data, empty tables)
- Healthy: All checks pass within acceptable parameters

### Overnight Orchestration Design

**Execution Flow:**
1. Initialize orchestrator with timestamp tracking
2. Run health check first - abort if critical failures
3. Execute each processing step with try-catch wrapper
4. Track duration and status for each step
5. Continue to next step even if non-critical step fails
6. Calculate overall status (success/partial/failed)
7. Generate summary report with formatted output

**Mutex Implementation:**
- Module-level isRunning flag
- Check flag at cron trigger, skip if true
- Set flag before execution, clear in finally block
- Prevents overlapping runs if previous execution takes too long

**Error Recovery:**
- Log all errors with full context
- Return step status with error message
- Continue pipeline unless health check fails critically
- Generate summary even if some steps fail

### Cron Scheduling Integration

**Node-Cron Setup:**
- Install node-cron package (add to package.json)
- Create scheduler.ts with startCronJobs() and stopCronJobs()
- Use cron expression: '0 7 * * *' (7 AM UTC = 3 AM ET)
- Set timezone: 'America/New_York'
- Wrap orchestrator call in mutex check

**Initialization Strategy:**
- Create /api/cron/init endpoint
- Call on first API request or via startup script
- Track initialization state to prevent duplicates
- Return schedule information for verification

### Data Schema Documentation Approach

**Documentation Structure:**
```markdown
# [Schema Name]

## File Location
[Path and description]

## Update Frequency
[When and how file is updated]

## Schema Definition
### TypeScript Interface
[Complete interface with field types]

### JSON Schema
[Formal JSON Schema for validation]

## Example Data
[Real-world example]

## Data Integrity Checks
[Thresholds and validation rules]

## Usage in Code
[Code examples for loading and processing]

## Related Files
[Links to related schemas]
```

**Schema Validation Integration:**
- Use documented interfaces in TypeScript code
- Reference validation rules in health checks
- Include examples in unit tests
- Link from main README for discoverability

### Environment Configuration

**New Variables:**
```bash
# Watchlist Configuration
DEFAULT_MARKET_ID=0x...
DEFAULT_CONDITION_IDS=0x...,0x...,0x...
FALLBACK_WATCHLIST_SIZE=10

# Application URL
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Goldsky API
GOLDSKY_API_KEY=your_api_key

# ClickHouse
CLICKHOUSE_HOST=http://localhost:8123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=

# Postgres
DATABASE_URL=postgresql://...
```

**Configuration Management:**
- Document all variables in .env.example
- Provide sensible defaults where possible
- Validate required variables at startup
- Log warnings for missing optional variables

## Out of Scope (Phase 1)

**Not Included in This Phase:**
- Email or Slack notifications for failures (future iteration)
- Real-time monitoring dashboards
- Performance optimization (unless blocking)
- Historical data backfilling (already completed)
- Streaming API implementation (documented as future work)

**Deferred to Phase 2 (All-Wallet Analytics):**
- Complete ingestion of ALL wallets (not just 548 signal wallets)
- Computation of 102 metrics for all wallets × 4 time windows
- Per-category P&L, Sharpe, Omega for every wallet
- Resolution accuracy (conviction) by category for all wallets
- Populate wallet_metrics_complete and wallet_metrics_by_category tables
- Top performers by category/tag leaderboards
- Smart score calculation by category

**Deferred to Phase 3 (Real-Time Signals):**
- Second-by-second price monitoring (currently 10s intervals)
- Real-time momentum and acceleration calculations
- Strategy workflow trigger system for auto-buy/sell
- Watchlist live signal monitoring
- Event-driven execution (vs current batch processing)

## Success Criteria

### Bug Fixes Validation
- Resolution data processes 3,673+ resolutions without errors
- Watchlist service handles missing file gracefully (returns empty array)
- Watchlist service handles malformed JSON without crashing
- Environment variables successfully configure defaults
- Streaming endpoint returns proper 501 response with helpful message
- All unit tests pass with 80%+ coverage for fixed code
- No TypeScript compilation errors

### Health Check Validation
- All 7 checks execute successfully
- Script completes in under 30 seconds
- Output is readable with status icons (✓/⚠/✗)
- Exit code 0 for healthy/warning, 1 for critical
- Can be run manually via npx tsx scripts/system-healthcheck.ts
- Returns structured data for programmatic use

### Overnight Orchestrator Validation
- Health check runs before processing
- Aborts on critical health failures with clear message
- Executes all processing steps in correct order
- Tracks timing and status for each step
- Continues processing on non-critical errors
- Generates comprehensive summary report
- Returns proper exit codes based on overall status

### Cron Scheduling Validation
- Cron jobs initialize on application startup
- Schedule set correctly for 3:00 AM ET (7:00 AM UTC)
- Timezone handling works correctly (America/New_York)
- Mutex prevents concurrent runs
- Can be initialized via /api/cron/init endpoint
- Errors logged but don't crash application

### Schema Documentation Validation
- All 3 data schemas documented with complete sections
- TypeScript interfaces match actual data structures
- JSON Schema definitions provided for validation
- Examples include real-world data
- Validation rules clearly stated
- Usage examples demonstrate loading and processing
- Related files cross-referenced

### Integration Testing
- End-to-end test: Fresh data processing completes successfully
- End-to-end test: Stale data triggers warning status
- End-to-end test: Missing file handled gracefully
- End-to-end test: Database connection failure detected
- End-to-end test: Concurrent orchestrator runs prevented
- Manual test: Run healthcheck script and verify all checks
- Manual test: Run orchestrator script and verify all steps
- Manual test: Initialize cron and verify schedule

### Performance Requirements
- Health check completes in < 30 seconds
- Overnight orchestrator completes in < 30 minutes
- Resolution data parsing processes 3,673 records in < 5 seconds
- Watchlist auto-populate returns in < 2 seconds
- No memory leaks during repeated runs
- Database connection pool does not exhaust

### Production Readiness
- All code files created/modified as specified
- All tests written and passing
- All documentation complete and reviewed
- Environment variables configured
- Database connections verified
- Cron schedule active
- No errors in production logs after deployment
- 3-day monitoring period shows stable operation

---

## Implementation Plan

### Phase 1: Bug Fixes (Days 1-2)

**Day 1 Morning:**
- Fix resolution data parsing logic in watchlist-auto-populate.ts
- Add validateResolutionData() function
- Create TypeScript interfaces
- Write unit tests for parsing logic

**Day 1 Afternoon:**
- Fix watchlist service error handling
- Add environment variable configuration
- Implement fallback mechanism
- Write unit tests for error scenarios

**Day 2 Morning:**
- Document streaming endpoint as experimental
- Update API route to return 501
- Add JSDoc comments and alternative endpoint info
- Test all bug fixes manually

**Day 2 Afternoon:**
- Run full unit test suite
- Verify no TypeScript errors
- Integration test with actual data files
- Code review and refinement

### Phase 2: Health Check System (Day 3)

**Morning:**
- Update system-healthcheck.ts structure
- Implement all 7 check functions
- Add formatted output with icons
- Test each check individually

**Afternoon:**
- Add summary calculation logic
- Test with various failure scenarios
- Verify execution time < 30 seconds
- Add exit code handling

### Phase 3: Overnight Orchestration (Day 4)

**Morning:**
- Update overnight-orchestrator.ts
- Add health check integration
- Implement step tracking with timing
- Add error handling for each step

**Afternoon:**
- Create cron scheduler module
- Implement mutex locking
- Create cron init API endpoint
- Test manual execution

### Phase 4: Documentation (Day 5)

**Morning:**
- Document expanded_resolution_map.json schema
- Document backfilled_market_ids.json schema
- Document market_id_lookup_results.jsonl schema

**Afternoon:**
- Update .env.example with new variables
- Create environment setup guide
- Update package.json scripts
- Write deployment checklist

### Phase 5: Testing & Validation (Day 6)

**Morning:**
- Run all unit tests
- Run integration tests
- Manual end-to-end testing
- Performance validation

**Afternoon:**
- Test error scenarios
- Test concurrent run prevention
- Verify health check thresholds
- Final code review

### Phase 6: Deployment (Day 7)

**Morning:**
- Deploy to production
- Configure environment variables
- Initialize cron jobs
- Verify health checks pass

**Afternoon:**
- Monitor first overnight run
- Check logs for errors
- Verify data processing
- Document any issues

### Phase 7: Monitoring (Days 8-10)

**Daily:**
- Check overnight run completion
- Verify health check results
- Monitor resource usage
- Track performance metrics
- Document observations

---

## Acceptance Testing

### Test 1: Resolution Data Processing
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
**Expected:** Processes 3,673+ resolutions with no errors

### Test 2: Graceful Error Handling
```bash
# Test with missing file
mv data/expanded_resolution_map.json data/expanded_resolution_map.json.bak
npx tsx -e "
import { autoPopulateWatchlist } from './lib/services/watchlist-auto-populate';
const result = await autoPopulateWatchlist('test-strategy-id');
console.log('Fallback result:', result);
"
mv data/expanded_resolution_map.json.bak data/expanded_resolution_map.json
```
**Expected:** Returns empty array, logs warning, does not crash

### Test 3: Health Check Execution
```bash
time npx tsx scripts/system-healthcheck.ts
echo "Exit code: $?"
```
**Expected:** < 30 seconds, all checks complete, exit code 0

### Test 4: Overnight Orchestrator
```bash
npx tsx scripts/overnight-orchestrator.ts
echo "Exit code: $?"
```
**Expected:** All steps execute, summary generated, exit code 0 or 1 based on status

### Test 5: Cron Initialization
```bash
curl http://localhost:3000/api/cron/init
```
**Expected:** JSON response with schedule information

### Test 6: Streaming Endpoint Status
```bash
curl -i http://localhost:3000/api/strategies/test-id/watchlist/stream
```
**Expected:** HTTP 501 with helpful error message and alternative endpoint

---

## Risk Assessment

### High Risk Items

**Risk:** Resolution data file structure changes
- **Impact:** Parsing fails, metrics not updated
- **Mitigation:** Validation function checks structure, unit tests cover format
- **Contingency:** Fallback to previous known-good data file

**Risk:** ClickHouse connection issues during overnight run
- **Impact:** Data not ingested, metrics stale
- **Mitigation:** Health check validates connection before processing
- **Contingency:** Manual run during business hours, alert operators

**Risk:** Cron schedule drift or missed runs
- **Impact:** Data not updated daily, metrics become stale
- **Mitigation:** Logging tracks all executions, mutex prevents overlaps
- **Contingency:** Manual orchestrator execution, review logs for patterns

### Medium Risk Items

**Risk:** Environment variable misconfiguration
- **Impact:** Services use wrong defaults, connections fail
- **Mitigation:** Document all variables, validate at startup
- **Contingency:** Clear error messages guide operators to fix

**Risk:** Memory leaks during long-running orchestrator
- **Impact:** Process crashes before completion
- **Mitigation:** Proper resource cleanup, connection pooling
- **Contingency:** Restart orchestrator, process data in smaller batches

**Risk:** Health check false positives/negatives
- **Impact:** Miss real issues or alert unnecessarily
- **Mitigation:** Tune thresholds based on real-world data
- **Contingency:** Adjust thresholds, add additional checks

### Low Risk Items

**Risk:** Timezone handling errors in cron
- **Impact:** Jobs run at wrong time
- **Mitigation:** Explicit timezone configuration, test across DST changes
- **Contingency:** Adjust cron expression, manual runs at correct time

**Risk:** Schema documentation becomes outdated
- **Impact:** Developers use incorrect data structures
- **Mitigation:** Link schemas to code interfaces, version control
- **Contingency:** Review and update schemas when changes detected

---

## Dependencies and Prerequisites

### Required Software
- Node.js 18+ with TypeScript support
- ClickHouse database accessible from application
- Postgres database with Supabase credentials
- Goldsky API key and credentials

### Required Data Files
- `/data/expanded_resolution_map.json`
- `/data/backfilled_market_ids.json`
- `/data/market_id_lookup_results.jsonl`

### Environment Setup
- Next.js application running in production or staging
- Database connections configured and tested
- API credentials set in environment variables
- File system access to data directory

### Permissions
- Read access to data files
- Write access to database tables
- API credentials for external services
- Cron scheduling capability within application

---

## Deliverables Checklist

### Code Files (8 total)
- [ ] `/lib/services/watchlist-auto-populate.ts` (modified)
- [ ] `/app/api/strategies/[id]/watchlist/stream/route.ts` (modified)
- [ ] `/scripts/system-healthcheck.ts` (modified)
- [ ] `/scripts/overnight-orchestrator.ts` (modified)
- [ ] `/lib/cron/scheduler.ts` (new)
- [ ] `/app/api/cron/init/route.ts` (new)
- [ ] `/tests/unit/watchlist-auto-populate.test.ts` (new)
- [ ] `/tests/integration/overnight-orchestrator.test.ts` (new)

### Documentation Files (15 total)
- [ ] `/docs/schemas/expanded-resolution-map.md` (new)
- [ ] `/docs/schemas/backfilled-market-ids.md` (new)
- [ ] `/docs/schemas/market-id-lookup-results.md` (new)
- [ ] `/docs/setup/environment-variables.md` (new)
- [ ] `/docs/setup/backend-setup.md` (new)
- [ ] `/docs/operations/overnight-processing.md` (new)
- [ ] `/docs/deployment/backend-setup-deployment.md` (new)
- [ ] `/docs/deployment/rollback-plan.md` (new)
- [ ] `/docs/monitoring/backend-monitoring.md` (new)
- [ ] `/docs/logging/log-format.md` (new)
- [ ] `/docs/api/endpoints.md` (modified)
- [ ] `README.md` (modified if needed)

### Configuration Files (3 total)
- [ ] `package.json` (modified - add node-cron, scripts)
- [ ] `.env.example` (modified - add new variables)
- [ ] `.gitignore` (modified - add log files)

---

## Alignment with Standards

This specification aligns with the following standards:

**Error Handling (`global/error-handling.md`):**
- User-friendly messages without exposing technical details
- Fail fast with clear validation errors
- Specific error types for targeted handling
- Centralized error handling at service boundaries
- Graceful degradation when non-critical services fail
- Resource cleanup in finally blocks

**Database Migrations (`backend/migrations.md`):**
- ClickHouse table changes through migration scripts
- Reversible schema changes
- Small, focused updates
- Clear naming conventions

**Tech Stack (`global/tech-stack.md`):**
- Next.js application framework
- TypeScript with strict typing
- Node-cron for scheduling
- ClickHouse and Postgres databases
- Supabase for operational data

---

## Monitoring and Observability

**Key Metrics to Track:**
- Overnight orchestrator execution time
- Health check pass/fail rates by component
- Resolution data processing throughput
- Error rates and types
- Database connection pool usage

**Log Locations:**
- Application logs: `.next/server/app.log`
- Orchestrator logs: `runtime/overnight-orchestrator.log`
- Healthcheck results: Console output and exit codes
- Watchlist events: `runtime/watchlist_events.log`

**Alert Thresholds:**
- Health check critical failures: Immediate attention
- Overnight orchestrator failures: Review within 24h
- Stale data (>48h): Investigate cause
- Processing time >30min: Performance review

---

## Timeline Summary

**Phase 1 Duration:** 10 days (8 implementation + 2 monitoring buffer)

**Critical Path:**
1. Bug fixes (Days 1-2) - Blocking all other work
2. Health check system (Day 3) - Required for orchestrator
3. Overnight orchestration (Day 4) - Core functionality
4. Documentation (Day 5) - Parallel with testing
5. Testing & validation (Day 6) - Quality gate
6. Deployment (Day 7) - Go-live
7. Monitoring (Days 8-10) - Stability verification

**Milestones:**
- Day 2 EOD: All bugs fixed and tested
- Day 4 EOD: Core infrastructure complete
- Day 6 EOD: All tests passing, ready to deploy
- Day 7 EOD: Production deployment complete
- Day 10 EOD: Stable operation confirmed, **READY FOR PHASE 2**

---

## Future Phases Overview

### Phase 2: All-Wallet Analytics (Estimated 1 week)

**Objective:** Scale analytics from 548 signal wallets to ALL wallets with complete metrics.

**Key Deliverables:**
- Ingest ALL wallets from Goldsky (2,839+ wallets)
- Compute 102 metrics × 4 time windows for every wallet
- Populate `wallet_metrics_complete` table fully
- Calculate per-category metrics (P&L, Sharpe, Omega, resolution accuracy)
- Populate `wallet_metrics_by_category` table
- Build category leaderboards (top performers by category/tag)
- Implement smart score calculation by category
- Enable "find top wallet in category X" queries

**Prerequisites:** Phase 1 complete with stable overnight processing

**Success Criteria:**
- All 2,839 wallets have metrics in wallet_metrics_complete
- Resolution accuracy computed for all wallets by category
- Query: "Top 10 Politics traders by Omega" returns results
- Query: "Wallet X's Sharpe ratio in Crypto" returns value

---

### Phase 3: Real-Time Watchlist Signals (Estimated 1 week)

**Objective:** Enable second-by-second monitoring with auto-execution triggers.

**Key Deliverables:**
- Upgrade price monitoring from 10s intervals to 1s intervals
- Calculate momentum and acceleration in real-time
- Build strategy workflow trigger engine
- Implement watchlist signal monitoring service
- Enable auto-buy/sell based on momentum thresholds
- Event-driven architecture for immediate execution
- WebSocket price feed integration (replace polling)

**Prerequisites:** Phase 1 & 2 complete with stable analytics

**Success Criteria:**
- Watchlist items monitored every 1 second
- Momentum spikes trigger strategy evaluation within 2s
- Auto-execution of buys/sells per strategy rules
- Historical signal log shows sub-second latency
- No missed signals during high-volume periods

---

## Phase Dependencies

```
Phase 1: Infrastructure & Stability (10 days)
    ↓ (Must be stable before proceeding)
Phase 2: All-Wallet Analytics (7 days)
    ↓ (Requires complete wallet data)
Phase 3: Real-Time Signals (7 days)

Total: ~4 weeks for complete backend system
```

**Why This Order:**
1. **Phase 1 first:** Can't build analytics on broken infrastructure
2. **Phase 2 before 3:** Need complete wallet data before real-time signals make sense
3. **Sequential execution:** Each phase builds on previous stability

---

## Notes for Developers

**Before Starting:**
- Review all planning documents in `/agent-os/specs/2025-10-28-backend-setup/planning/`
- Set up local environment with required databases
- Verify access to all external APIs
- Read existing code in referenced files

**During Implementation:**
- Follow error handling standards for all try-catch blocks
- Add comprehensive logging with context
- Write tests before considering feature complete
- Update documentation as you implement
- Commit frequently with clear messages

**Testing Strategy:**
- Unit test each bug fix independently
- Integration test the complete pipeline
- Manual test with production-like data
- Test failure scenarios and error paths
- Verify performance meets requirements

**Code Review Focus:**
- TypeScript types are specific and accurate
- Error handling is comprehensive
- Logging provides sufficient debugging context
- Tests cover edge cases and error paths
- Documentation matches implementation

**Deployment Preparation:**
- Verify all environment variables documented
- Test in staging environment first
- Have rollback plan ready
- Monitor logs during first production run
- Document any unexpected behavior
