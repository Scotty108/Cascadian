# Spec Requirements: Backend Setup for Production Stability

## Initial Description
Set up backend infrastructure for the Cascadian trading platform to ensure stable data ingestion, reliable overnight processing, and production-ready API endpoints. This includes fixing critical bugs in data processing pipelines, implementing health monitoring, and establishing automated maintenance routines.

## Requirements Discussion

### First Round Questions

**Q1:** The overnight orchestrator should run at 3 AM ET daily to process new trades, update wallet metrics, and refresh market resolutions. Is this timing acceptable for your production environment?
**Answer:** Yes, 3 AM ET is ideal as it's outside trading hours and gives time for data to settle.

**Q2:** For the healthcheck script, I'm assuming we should validate: (1) Goldsky connection, (2) ClickHouse table existence and row counts, (3) Postgres connectivity, (4) File-based data freshness (resolution maps, category definitions). Should we add any other checks?
**Answer:** Those are perfect. Also add check for API endpoint responsiveness (test a few key routes).

**Q3:** The cron setup should use node-cron within the Next.js app rather than system cron. This keeps everything in one deployment. Is that your preference, or would you prefer separate cron jobs?
**Answer:** Node-cron within Next.js is preferred for simplicity and single deployment.

**Q4:** For resolution data parsing, I notice the code expects to iterate over `resolutionData` directly, but the file structure has a `resolutions` array property. Should we fix the code to match the actual file format and document the expected schema?
**Answer:** Yes, fix the parsing logic to iterate over `resolutionData.resolutions` array and add validation. Also document the expected format as a schema.

**Q5:** The strategy watchlist auto-populate service currently has hardcoded condition IDs and missing resolution data. Should we: (a) Add proper error handling and fallbacks, (b) Make it configurable via environment variables, (c) Both?
**Answer:** Both. Add error handling with graceful degradation, and make the default market/condition configurable via env vars.

**Q6:** For data freshness thresholds in healthcheck, I'm thinking: resolutions updated within 24 hours = healthy, 24-48 hours = warning, over 48 hours = critical. Does this align with your data update frequency expectations?
**Answer:** Yes, those thresholds work well for our update cadence.

**Q7:** Should the overnight orchestrator send notifications (email, Slack, etc.) on failure, or just log errors for manual review?
**Answer:** Log errors for now. We'll add notifications in a future iteration once monitoring infrastructure is in place.

**Q8:** Are there any features or data processing steps that should NOT be included in this initial backend setup? For example, should we exclude any experimental analytics or specific wallet types?
**Answer:** Focus only on core ingestion and processing. Skip any experimental features like smart money flow analysis or advanced category breakdowns - those can come later.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Goldsky Trade Ingestion - Path: `/scripts/goldsky-full-historical-load.ts`
  - Shows pattern for connecting to Goldsky API
  - Demonstrates error handling and retry logic
  - Use as reference for connection patterns

- Feature: ClickHouse Table Creation - Path: `/scripts/create-tables-direct.ts`
  - Shows how to create and verify ClickHouse tables
  - Use for healthcheck table validation logic

- Feature: Resolution Outcome Computation - Path: `/scripts/compute-resolution-outcomes.ts`
  - Shows pattern for processing market resolutions
  - Reference for data transformation patterns

- Feature: Wallet Category PnL - Path: `/scripts/compute-wallet-category-pnl.ts`
  - Demonstrates aggregation and metric calculation
  - Use for overnight processing patterns

- Backend API Patterns - Path: `/app/api/strategies/[id]/watchlist/route.ts`
  - Shows Next.js API route structure
  - Use for healthcheck endpoint implementation

### Follow-up Questions

**Follow-up 1:** I found ground truth from exploration agents showing 3 critical bugs: (1) Resolution data parsing iterates wrong object, (2) Watchlist service has hardcoded values and missing error handling, (3) API streaming endpoint has incomplete implementation. Should all three be addressed in this backend setup spec?
**Answer:** Yes, all three are critical for production stability and should be fixed as part of this work.

**Follow-up 2:** The exploration findings show the resolution map has 3,673 conditions resolved with accurate structure. Should the healthcheck validate that the count is above a minimum threshold (e.g., 3,000) to catch data corruption?
**Answer:** Excellent idea. Check that resolved_conditions >= 3000 as a data integrity check.

**Follow-up 3:** For the runbook execution plan, should we follow this order: (A) Fix bugs first, (B) Create healthcheck, (C) Set up cron/overnight orchestrator, (D) Document schemas, (E) Test end-to-end?
**Answer:** Yes, that order makes sense. Fix bugs before building new infrastructure on top of broken code.

## Visual Assets

### Files Provided:
No visual assets provided (backend infrastructure work).

### Visual Insights:
Not applicable - this is backend system architecture and data processing.

## Requirements Summary

### Functional Requirements

**Core Functionality:**
- Automated overnight processing at 3 AM ET daily to ingest new trades and update metrics
- System healthcheck script that validates all critical infrastructure components
- Fixed data processing pipelines for resolution parsing and watchlist management
- API endpoint health monitoring
- Cron job orchestration within Next.js application using node-cron
- Documented data schemas for all file-based data sources
- Graceful error handling with detailed logging

**Data Processing:**
- Ingest new trades from Goldsky API
- Process market resolutions from expanded_resolution_map.json
- Compute wallet category PnL and metrics
- Update resolution outcomes in ClickHouse
- Validate data freshness and integrity

**Health Monitoring:**
- Goldsky API connectivity check
- ClickHouse table existence and row count validation
- Postgres connectivity verification
- File-based data freshness checks (24h healthy, 48h warning, 48h+ critical)
- API endpoint responsiveness testing
- Resolution data integrity check (minimum 3,000 resolved conditions)

**Critical Bug Fixes:**
1. Resolution data parsing: Fix iteration to use `resolutionData.resolutions` array instead of top-level object
2. Watchlist auto-populate service: Add error handling, fallbacks, and environment variable configuration
3. API streaming endpoint: Complete implementation or document as incomplete/experimental

### Reusability Opportunities

**Existing Patterns to Leverage:**
- Goldsky connection logic from `/scripts/goldsky-full-historical-load.ts`
- ClickHouse table validation from `/scripts/create-tables-direct.ts`
- Resolution processing patterns from `/scripts/compute-resolution-outcomes.ts`
- Metric calculation patterns from `/scripts/compute-wallet-category-pnl.ts`
- Next.js API route structure from `/app/api/strategies/[id]/watchlist/route.ts`

**Code to Reference:**
- Error handling and retry patterns from existing ingestion scripts
- Data transformation logic from resolution outcome computation
- Aggregation patterns from wallet PnL calculations

### Scope Boundaries

**In Scope:**
- Fixing 3 critical bugs identified in data processing
- Creating comprehensive healthcheck script with 7+ validation checks
- Setting up node-cron for overnight orchestration (3 AM ET daily)
- Documenting data schemas for resolution maps and category definitions
- Implementing graceful error handling with logging
- End-to-end testing of overnight processing pipeline
- Validation that resolution count >= 3000 for data integrity
- API endpoint health checks

**Out of Scope:**
- Email or Slack notifications for failures (future iteration)
- Smart money flow analysis features
- Advanced category breakdown analytics
- Experimental wallet analysis features
- Real-time monitoring dashboards
- Performance optimization (unless blocking)
- Historical data backfilling (already completed)

### Technical Considerations

**Infrastructure:**
- Next.js application with node-cron for scheduling
- ClickHouse for analytics data storage
- Postgres for application data
- Goldsky API for blockchain trade data
- File-based data sources (JSON/JSONL files in `/data` directory)

**Environment Configuration:**
- Default market/condition IDs configurable via environment variables
- Database connection strings from existing env vars
- Goldsky API credentials from env
- Timezone handling for 3 AM ET cron schedule

**Data Integrity:**
- Validation before processing (check expected structure)
- Defensive checks for missing data
- Fallback values for optional fields
- Logging warnings for unexpected formats

**Error Handling Strategy:**
- Log all errors with context
- Graceful degradation where possible
- Continue processing on non-critical errors
- Fail fast on critical infrastructure issues (DB connectivity, etc.)

**Performance Considerations:**
- Overnight processing window allows longer-running operations
- Healthcheck should complete within 30 seconds
- Batch processing for large datasets
- Connection pooling for database operations

**Deployment:**
- Single Next.js deployment contains all backend logic
- No separate cron daemon required
- Environment variables for configuration
- Logging output to standard application logs

### Schema Documentation Requirements

**Files Requiring Schema Documentation:**
1. `expanded_resolution_map.json` - Market resolution outcomes
2. `backfilled_market_ids.json` - Market ID reference data
3. `market_id_lookup_results.jsonl` - Market lookup cache
4. Category definition files (if any)

**Schema Format:**
- JSON Schema or TypeScript interface definitions
- Field descriptions and constraints
- Example data snippets
- Update frequency documentation

### Acceptance Criteria

**Success Metrics:**
- All 3 critical bugs fixed and tested
- Healthcheck script completes with all checks passing
- Overnight orchestrator runs successfully for 3 consecutive nights
- Resolution data validation confirms >= 3000 resolved conditions
- API endpoints respond within acceptable timeframes
- Zero data processing errors in production logs
- All schemas documented with examples

**Testing Requirements:**
- Unit tests for bug fixes
- Integration test for overnight orchestrator
- End-to-end test of full pipeline
- Healthcheck validates all 7+ checks
- Error handling verified with missing/malformed data

**Documentation Deliverables:**
- Complete runbook with step-by-step execution plan
- Data schema documentation for all file-based sources
- Critical bugs list with root cause analysis
- Acceptance criteria with specific thresholds
- Deliverables checklist
