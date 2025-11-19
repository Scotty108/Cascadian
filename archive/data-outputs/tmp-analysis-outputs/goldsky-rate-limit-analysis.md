# Goldsky Rate Limit Analysis

## Current Constraints

**Goldsky Free Tier**:
- 100,000 queries/month (documented limit)
- Typical rate limits: 10-50 requests/second (undocumented, inferred from similar GraphQL APIs)
- Burst capacity: Often allows temporary spikes above sustained rate

**Our Requirements**:
- Total markets: 149,907
- Queries per market: ~1-2 (most markets fit in 1 query with `first: 1000`)
- Total queries: ~150K-300K

## Performance Testing

**Single Worker** (from test):
- 3 markets in 5 seconds
- Rate: 0.6 markets/second
- Query rate: ~1.2 queries/second

**Projected Scaling**:

| Workers | Markets/sec | Queries/sec | Total Time | Risk |
|---------|-------------|-------------|------------|------|
| 8 | 4.8 | 9.6 | 8.7 hours | ✅ Safe |
| 16 | 9.6 | 19.2 | 4.3 hours | ✅ Safe |
| 32 | 19.2 | 38.4 | 2.2 hours | ⚠️ Medium |
| 64 | 38.4 | 76.8 | 1.1 hours | ❌ High |
| 128 | 76.8 | 153.6 | 0.5 hours | ❌ Very High |

## Rate Limit Estimates

**Conservative (10 req/sec)**:
- Max safe workers: 8-10
- Runtime: 8-10 hours

**Moderate (25 req/sec)**:
- Max safe workers: 16-20
- Runtime: 3-5 hours

**Aggressive (50 req/sec)**:
- Max safe workers: 32-40
- Runtime: 1.5-3 hours

## Recommendation for Maximum Speed

**Recommended: 32 workers (2-3 hour runtime)**

Why 32:
- Goldsky likely supports 25-50 req/sec bursts
- 38 queries/second is within typical GraphQL API limits
- ClickHouse can easily handle insert load
- Network bandwidth not a bottleneck
- Still under typical connection pool limits (50-100)

**To go faster (64+ workers)**:
- Risk of 429 Too Many Requests errors
- Would need exponential backoff retry logic
- Diminishing returns (network overhead)

## Bottleneck Analysis

1. **Goldsky API**: Likely bottleneck at 25-50 req/sec
2. **ClickHouse**: Can handle 1000+ inserts/sec (not a bottleneck)
3. **Network**: ~1KB per response = 38KB/sec (negligible)
4. **Node.js**: Can handle 100+ concurrent requests easily

## Implementation Strategy

**Phase 1: Aggressive Start (32 workers)**
- Run for 30 minutes
- Monitor for 429 errors
- If errors, scale back to 16

**Phase 2: Adjust Based on Errors**
- No errors? Continue at 32
- Some errors? Scale back to 16
- Many errors? Scale back to 8

**Phase 3: Monitor Query Budget**
- Track total queries used
- Goldsky likely won't hard-block on free tier (common practice)
- Worst case: queries slow down after 100K

## Testing Plan

1. **Quick validation** (100 markets, 32 workers)
2. **Monitor for errors**
3. **Scale to full backfill**
4. **Add retry logic if needed**
