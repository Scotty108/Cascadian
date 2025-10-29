# API Endpoints Reference

This document provides reference information for all API endpoints in the Cascadian application.

## Strategies API

### Watchlist Endpoints

#### GET /api/strategies/[id]/watchlist

**Status:** Implemented

Returns all markets in the strategy's watchlist with enrichment data.

**Query Parameters:**
- `limit` (optional): Number of items to return (default: 100, max: 1000)
- `offset` (optional): Offset for pagination (default: 0)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "watchlist-item-id",
      "workflow_id": "strategy-id",
      "market_id": "market-id",
      "condition_id": "condition-id",
      "canonical_category": "Politics",
      "raw_tags": ["election", "2024"],
      "triggering_wallet_rank": 3,
      "triggering_wallet_coverage_pct": 15.5,
      "triggering_wallet_address": "0x...",
      "added_at": "2025-10-28T10:00:00.000Z",
      "alerts": true
    }
  ],
  "metadata": {
    "total": 50,
    "limit": 100,
    "offset": 0
  }
}
```

**Status Codes:**
- `200`: Success
- `404`: Strategy not found
- `500`: Server error

---

#### GET /api/strategies/[id]/watchlist/stream

**Status:** Experimental - Not Yet Implemented

**Returns:** HTTP 501 Not Implemented

This endpoint is reserved for future real-time streaming functionality planned for Phase 3 of the backend infrastructure rollout.

**Current Implementation:**
Returns HTTP 501 with guidance to use the polling endpoint instead.

**Response:**
```json
{
  "success": false,
  "error": "Not Implemented",
  "status": 501,
  "message": "Streaming endpoint not yet implemented. This feature is planned for Phase 3 of the backend infrastructure rollout (Real-Time Watchlist Signals).",
  "alternative": "Use GET /api/strategies/[id]/watchlist for polling-based access to watchlist data. This endpoint supports pagination and returns enriched watchlist items with alert flags.",
  "documentation": {
    "polling_endpoint": "GET /api/strategies/[id]/watchlist",
    "query_parameters": {
      "limit": "number (default: 100, max: 1000)",
      "offset": "number (default: 0)"
    },
    "example": "/api/strategies/your-strategy-id/watchlist?limit=50&offset=0"
  },
  "roadmap": {
    "phase_1": "Infrastructure & Stability (Current)",
    "phase_2": "All-Wallet Analytics (Next)",
    "phase_3": "Real-Time Signals (Streaming Implementation)"
  }
}
```

**Alternative:** Use `GET /api/strategies/[id]/watchlist` for polling-based access

**Future Implementation (Phase 3):**
- Second-by-second price monitoring
- Real-time momentum and acceleration calculations
- WebSocket-based streaming
- Sub-second latency signal detection
- Auto-execution integration

**Status Codes:**
- `501`: Not Implemented (always returned)

---

#### DELETE /api/strategies/[id]/watchlist

**Status:** Implemented

Clears all markets from the strategy's watchlist.

**Response:**
```json
{
  "success": true,
  "data": {
    "removed_count": 25,
    "message": "Watchlist cleared. Removed 25 markets."
  }
}
```

**Status Codes:**
- `200`: Success
- `404`: Strategy not found
- `500`: Server error

---

## Implementation Roadmap

### Phase 1: Infrastructure & Stability (Current)
- Fix critical bugs
- Establish health monitoring
- Enable overnight processing
- **Document streaming endpoint as experimental**

### Phase 2: All-Wallet Analytics (Next)
- Scale analytics to all wallets
- Compute comprehensive metrics
- Build category leaderboards

### Phase 3: Real-Time Signals (Future)
- **Implement streaming endpoint**
- Second-by-second monitoring
- WebSocket integration
- Auto-execution triggers

---

## Error Handling

All endpoints follow consistent error response patterns:

```json
{
  "success": false,
  "error": "Error type",
  "message": "Detailed error message"
}
```

Common status codes:
- `200`: Success
- `400`: Bad request / validation error
- `403`: Forbidden / permission denied
- `404`: Resource not found
- `500`: Internal server error
- `501`: Not implemented (experimental endpoints)

---

## Rate Limiting

Rate limiting information is not yet implemented but will be added in future iterations with appropriate headers:
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

---

## Versioning

API versioning strategy will be implemented as needed. Current endpoints are considered v1 and subject to change during development.

---

## Additional Resources

- [Architecture Overview](../ARCHITECTURE_OVERVIEW.md)
- [Data Pipeline Architecture](../data-pipeline-architecture.md)
- [Backend Setup Spec](../../agent-os/specs/2025-10-28-backend-setup/spec.md)
