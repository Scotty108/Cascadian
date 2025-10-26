# Strategy Executor Cron Job

Autonomous strategy execution system for CASCADIAN's 24/7 trading capabilities.

## Overview

This cron job executes autonomous trading strategies on a scheduled basis, enabling users to run strategies continuously without manual intervention.

## Architecture

### Files

- **`route.ts`** - Next.js API route handler for cron endpoint
- **`executor.ts`** - Core execution logic (testable, reusable)
- **`lib/workflow/__tests__/strategy-executor-cron.test.ts`** - Unit tests

### Execution Flow

```
1. Vercel Cron triggers GET /api/cron/strategy-executor (every 1 minute)
2. Verify CRON_SECRET authentication
3. Query workflow_sessions for due strategies:
   - auto_run = TRUE
   - next_execution_at <= NOW()
   - status IN ('running', 'error')
   - LIMIT 25 (Vercel timeout protection)
4. For each strategy:
   a. Execute workflow using WorkflowExecutor
   b. Track execution time and results
   c. Update timestamps and counters:
      - last_executed_at = NOW()
      - next_execution_at = NOW() + execution_interval_minutes
      - execution_count += 1
      - success_count or error_count += 1
      - average_execution_time_ms (rolling average)
   d. Handle errors:
      - If error_count >= 3: auto-pause strategy
      - Send error notification to user
5. Return execution summary for monitoring
```

## Configuration

### Environment Variables

Required environment variables:

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...  # Service role key (not anon key!)

# Cron Authentication
CRON_SECRET=your-secure-random-string  # Required for production
# OR
ADMIN_API_KEY=your-admin-api-key       # Fallback if CRON_SECRET not set
```

### Vercel Cron Configuration

The cron schedule is defined in `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/strategy-executor",
      "schedule": "* * * * *"
    }
  ]
}
```

**Schedule**: `* * * * *` = Every 1 minute

**Cron Syntax**: `minute hour day month dayOfWeek`
- `*` = every unit
- `*/5` = every 5 units
- `0` = at position 0

### Vercel Dashboard Setup

1. Go to your Vercel project settings
2. Navigate to **Environment Variables**
3. Add `CRON_SECRET` with a secure random value
4. Deploy to enable cron jobs (cron jobs only run in production)

## Performance

### Targets

- **Execution Time**: < 5 seconds for 25 strategies
- **Timeout Limit**: 10 seconds (Vercel default)
- **Strategies per Run**: Max 25 (configurable in executor.ts)

### Monitoring

The cron job returns a detailed execution summary:

```json
{
  "success": true,
  "data": {
    "strategies_checked": 25,
    "strategies_executed": 3,
    "executions": [
      {
        "workflow_id": "uuid-1",
        "workflow_name": "Politics Scanner",
        "status": "completed",
        "duration_ms": 1234,
        "nodes_executed": 5
      }
    ],
    "execution_time_ms": 4567
  },
  "timestamp": "2025-10-26T15:30:00Z"
}
```

### Logs

View cron job logs in Vercel:
1. Go to your project in Vercel Dashboard
2. Navigate to **Deployments**
3. Click on a deployment
4. Go to **Functions** tab
5. Find `/api/cron/strategy-executor`
6. View execution logs

## Error Handling

### Auto-Pause Logic

Strategies automatically pause after 3 consecutive failures:

1. **First Error**: `error_count = 1`, status remains 'running'
2. **Second Error**: `error_count = 2`, status remains 'running'
3. **Third Error**: `error_count = 3`, status changes to 'error', `auto_run = FALSE`

When auto-paused:
- Strategy stops executing
- User receives high-priority notification
- Manual resume required via API or UI

### Error Recovery

On successful execution after errors:
- `error_count` resets to 0
- Strategy continues normal execution
- This allows transient errors to self-recover

## Testing

### Run Tests

```bash
# Run strategy executor tests only
npm test lib/workflow/__tests__/strategy-executor-cron.test.ts

# Run all workflow tests
npm test lib/workflow/__tests__
```

### Manual Testing

Test the cron endpoint manually:

```bash
# Using curl
curl -X POST http://localhost:3000/api/cron/strategy-executor \
  -H "Authorization: Bearer your-cron-secret"

# Expected response (if no strategies due):
{
  "success": true,
  "data": {
    "strategies_checked": 0,
    "strategies_executed": 0,
    "executions": [],
    "execution_time_ms": 123
  },
  "timestamp": "2025-10-26T15:30:00Z"
}
```

## Debugging

### Common Issues

#### 1. Strategies Not Executing

Check:
- `auto_run = TRUE`
- `next_execution_at <= NOW()`
- `status IN ('running', 'error')`

Query to debug:

```sql
SELECT id, name, auto_run, status, next_execution_at, error_count
FROM workflow_sessions
WHERE auto_run = TRUE
ORDER BY next_execution_at;
```

#### 2. Authentication Failures

- Verify `CRON_SECRET` is set in Vercel environment variables
- Check Authorization header format: `Bearer <secret>`
- In development, cron secret is optional (warning logged)

#### 3. Execution Timeouts

- Reduce number of strategies per run (default: 25)
- Simplify workflows (remove slow nodes)
- Check Vercel function logs for timeout errors

### Enable Debug Logging

Add console.log statements in `executor.ts`:

```typescript
console.log('[Strategy Executor] Debug info:', debugData)
```

Logs appear in Vercel function logs.

## Security

### Authentication

- **Production**: Requires `CRON_SECRET` in Authorization header
- **Development**: Optional (warning logged if missing)
- **Service Role**: Uses Supabase service role key (bypasses RLS)

### Best Practices

1. **Strong Secrets**: Use cryptographically random CRON_SECRET
   ```bash
   # Generate secure secret
   openssl rand -base64 32
   ```

2. **Environment Isolation**: Never commit secrets to git
3. **Least Privilege**: Service role key should only be used server-side
4. **Rate Limiting**: Cron job inherently rate-limited by schedule

## Roadmap

### Future Enhancements

- **Priority Queues**: Execute high-priority strategies first
- **Distributed Execution**: Use external job queue (BullMQ + Redis) for longer workflows
- **Advanced Scheduling**: Support time windows (e.g., only run 9am-5pm)
- **Execution History**: Retention policy for old execution logs
- **Monitoring Dashboard**: Real-time cron job health metrics

### Migration to External Queue

If execution times exceed 10 seconds regularly:

1. Deploy Redis instance (Upstash, Railway)
2. Implement BullMQ job queue
3. Cron job becomes job scheduler (adds jobs to queue)
4. Separate worker processes execute jobs
5. Unlimited execution time, better retry logic

## Support

For issues or questions:
- Check Vercel function logs
- Review test suite for expected behavior
- Consult main spec: `spec-20251026-autonomous-strategy-execution/spec.md`
- Contact engineering team

---

**Last Updated**: 2025-10-26
**Version**: 1.0
**Status**: Production Ready
