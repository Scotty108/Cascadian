# Critical Bugs Analysis

## Overview
This document details the 3 critical bugs discovered during exploration that must be fixed for production stability.

---

## Bug #1: Resolution Data Parsing Logic Error

### Severity
HIGH - Blocks all resolution outcome processing

### Location
`/lib/services/watchlist-auto-populate.ts` (lines around resolution data iteration)

### Root Cause
Code attempts to iterate over `resolutionData` object directly using `Object.entries()`, but the actual file structure has resolutions nested in a `resolutions` array property.

**Expected by code:**
```typescript
// Code expects this structure:
{
  "condition_id_1": { resolution data },
  "condition_id_2": { resolution data }
}
```

**Actual file structure:**
```json
{
  "total_conditions": 3673,
  "resolved_conditions": 3673,
  "last_updated": "2025-01-21T19:45:00Z",
  "resolutions": [
    {
      "condition_id": "0x123...",
      "market_id": "0x456...",
      "resolved_outcome": "YES",
      "payout_yes": 1,
      "payout_no": 0,
      "resolved_at": "2025-01-15T10:30:00Z"
    }
  ]
}
```

### Impact
- Resolution outcomes are never processed
- Watchlist auto-populate fails silently
- Wallet PnL calculations may be incomplete
- Strategy performance metrics are inaccurate

### Fix Strategy (Option 4: Fix parsing logic AND document expected format)

**Code Changes:**
```typescript
// BEFORE (incorrect):
Object.entries(resolutionData).forEach(([conditionId, resolution]) => {
  // process resolution
});

// AFTER (correct):
if (!resolutionData.resolutions || !Array.isArray(resolutionData.resolutions)) {
  console.error('Invalid resolution data structure: missing resolutions array');
  return;
}

resolutionData.resolutions.forEach((resolution) => {
  const conditionId = resolution.condition_id;
  // process resolution
});
```

**Validation to Add:**
1. Check that `resolutionData.resolutions` exists and is an array
2. Validate required fields exist: `condition_id`, `market_id`, `resolved_outcome`
3. Log warning if `total_conditions` doesn't match array length
4. Check `resolved_conditions` >= 3000 for data integrity

**Schema Documentation:**
Create schema file documenting the expected format (see Bug #1 fix in runbook).

### Testing
- Unit test with valid resolution data structure
- Test with missing `resolutions` property (should log error)
- Test with malformed array (should handle gracefully)
- Integration test confirming outcomes are processed correctly

---

## Bug #2: Watchlist Service Hardcoded Values and Missing Error Handling

### Severity
MEDIUM-HIGH - Causes runtime errors and limits functionality

### Location
`/lib/services/watchlist-auto-populate.ts`

### Root Cause
Service has multiple issues:
1. Hardcoded condition IDs that may not exist in all environments
2. Missing error handling for data fetching failures
3. No fallback mechanism when resolution data is unavailable
4. Not configurable via environment variables

### Current Issues
```typescript
// Hardcoded condition IDs
const defaultConditions = [
  '0x1234...', // May not exist in all environments
  '0x5678...'
];

// No error handling
const resolutionData = await fetchResolutions(); // Throws if fails
const outcomes = processOutcomes(resolutionData); // No null checks
```

### Impact
- Service crashes when hardcoded conditions don't exist
- Entire watchlist population fails if resolution fetch fails
- No visibility into what went wrong
- Difficult to test in different environments
- Cannot customize default markets per deployment

### Fix Strategy

**Error Handling:**
```typescript
try {
  const resolutionData = await fetchResolutions();
  if (!resolutionData) {
    console.warn('No resolution data available, using fallback');
    return getFallbackWatchlist();
  }

  const outcomes = processOutcomes(resolutionData);
  return outcomes;
} catch (error) {
  console.error('Failed to populate watchlist:', error);
  // Return empty array or cached data instead of crashing
  return [];
}
```

**Environment Variable Configuration:**
```typescript
// .env or .env.local
DEFAULT_MARKET_ID=0xabc123...
DEFAULT_CONDITION_IDS=0x111,0x222,0x333
FALLBACK_WATCHLIST_SIZE=10

// In code:
const defaultMarketId = process.env.DEFAULT_MARKET_ID || DEFAULT_FALLBACK;
const defaultConditions = process.env.DEFAULT_CONDITION_IDS?.split(',') || [];
```

**Graceful Degradation:**
- Return empty array if all data sources fail
- Use cached data if available
- Log warnings but don't crash the application
- Provide meaningful error messages in API responses

### Testing
- Test with missing environment variables (should use sensible defaults)
- Test with network failures (should return fallback)
- Test with invalid condition IDs (should skip and continue)
- Test with missing resolution data (should handle gracefully)

---

## Bug #3: API Streaming Endpoint Incomplete Implementation

### Severity
MEDIUM - Could cause production errors if accessed

### Location
`/app/api/strategies/[id]/watchlist/stream/route.ts`

### Root Cause
Streaming endpoint exists in file structure but may have incomplete or experimental implementation that's not production-ready.

### Current State
- Endpoint exists in routing structure
- Implementation status unknown without code inspection
- May be placeholder or work-in-progress
- Could return errors if called by frontend

### Impact
- Runtime errors if frontend attempts to use streaming
- Confusion about feature availability
- Potential memory leaks if streaming not properly implemented
- Client-side timeout issues

### Fix Strategy

**Option A: Complete Implementation (if needed for production)**
- Implement proper Server-Sent Events (SSE) or WebSocket streaming
- Add error handling and connection cleanup
- Implement heartbeat/keepalive mechanism
- Add tests for streaming behavior

**Option B: Document as Experimental (if not needed now)**
- Add clear comments marking endpoint as experimental
- Return 501 Not Implemented status with message
- Remove from production API routes if unused
- Document in API reference as "coming soon"

**Recommended Approach:**
Since this is not in the critical path for overnight processing, document as experimental and return proper error response:

```typescript
export async function GET(req: Request) {
  return new Response(
    JSON.stringify({
      error: 'Streaming endpoint not yet implemented',
      status: 'experimental',
      alternative: 'Use /api/strategies/[id]/watchlist for polling'
    }),
    {
      status: 501,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}
```

### Testing
- Verify endpoint returns expected error response
- Confirm alternative endpoint works correctly
- Document in API reference

---

## Bug Priority and Fix Order

### Phase 1: Critical Blockers (Must fix immediately)
1. **Bug #1: Resolution Data Parsing** - Blocks all resolution processing
2. **Bug #2: Watchlist Service Error Handling** - Causes crashes

### Phase 2: Production Stability
3. **Bug #3: Streaming Endpoint** - Document or implement properly

---

## Validation Checklist

After fixing all bugs, verify:
- [ ] Resolution data processes correctly with actual file structure
- [ ] Watchlist service handles errors gracefully
- [ ] Environment variables can configure default markets
- [ ] Streaming endpoint returns proper response (implemented or 501)
- [ ] All unit tests pass
- [ ] Integration tests pass
- [ ] No errors in production logs after deployment
- [ ] Healthcheck script validates resolution count >= 3000

---

## Related Documentation
- See `runbook.md` for step-by-step fix procedures
- See `requirements.md` for full context
- See `acceptance-criteria.md` for success metrics
