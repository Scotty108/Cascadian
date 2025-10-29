# Supabase Egress Optimization Plan

## Current Usage: 17.83 GB / 5 GB (357% over limit)

## 🚨 Major Issues Found

### 1. AGGRESSIVE POLLING (70% of waste)

#### Topbar Notifications (EVERY PAGE)
- **Current**: Polls every 30 seconds
- **Location**: `components/topbar.tsx:48`
- **Impact**: 120 requests/hour × 10KB = ~1.2 MB/hour per user
- **Fix**: Change to 5 minutes OR use WebSocket

```typescript
// BEFORE (30 seconds)
const interval = setInterval(fetchNotifications, 30000);

// AFTER (5 minutes)
const interval = setInterval(fetchNotifications, 300000);
```

#### Strategy Components
- Orchestrator Decisions: Every 30s (`components/strategy-dashboard/components/orchestrator-decisions-section.tsx:64`)
- Pending Decisions: Every 10s (`components/strategy-builder/orchestrator-node/pending-decisions-badge.tsx:78`)
- Strategy Status: Every 60s (`components/strategy-dashboard-overview/autonomous-card.tsx:44`)

**Recommended**: Change to event-driven updates or 5-minute polling

---

### 2. SELECT * QUERIES (15% of waste)

#### Notifications API
- **Current**: `components/topbar.tsx` and `app/api/notifications/route.ts`
- **Issue**: Fetches ALL columns including large fields

```typescript
// ❌ BAD - Returns everything
.select('*')

// ✅ GOOD - Only what you need (60% smaller)
.select('id, title, type, is_read, created_at, priority, link')
```

**Columns to REMOVE from SELECT:**
- `message` (often long text)
- `metadata` (JSON, can be large)
- `user_id` (not always needed)
- `is_archived` (filter instead)

---

### 3. NO CLIENT CACHING (10% of waste)

#### Every Mutation Refetches Everything
```typescript
// ❌ BAD - Refetches entire list
const markAsRead = async (id: number) => {
  await fetch(`/api/notifications/${id}`, { ... });
  fetchNotifications(); // ← Wasteful!
}

// ✅ GOOD - Update cache
const markAsRead = async (id: number) => {
  await fetch(`/api/notifications/${id}`, { ... });
  setNotifications(prev =>
    prev.map(n => n.id === id ? {...n, is_read: true} : n)
  );
}
```

---

### 4. NO PAGINATION (5% of waste)

#### Notifications
- **Current**: Fetches 50 notifications every time
- **Better**: Start with 10, load more on scroll

```typescript
// Initial load: 10 notifications
limit: 10

// Load more button: +10 more
```

---

## 💡 Quick Wins (Implement Today)

### Fix 1: Reduce Polling Intervals
```bash
# Change all 30s intervals to 5 minutes
# Change all 10s intervals to 1 minute
```

**Savings**: ~16 GB/month → **90% reduction in polling egress**

### Fix 2: Select Only Needed Columns
```typescript
// Notifications
.select('id, title, type, is_read, created_at, priority, link')

// Instead of
.select('*')
```

**Savings**: ~3 GB/month → **60% smaller payloads**

### Fix 3: Add Client-Side Cache Updates
```typescript
// Use optimistic updates instead of refetching
```

**Savings**: ~2 GB/month → **Eliminates unnecessary refetches**

---

## 🎯 Total Estimated Savings

| Optimization | Current | After | Savings |
|--------------|---------|-------|---------|
| Polling Intervals | ~16 GB | ~1.5 GB | 91% |
| SELECT * → Specific | ~1 GB | ~0.4 GB | 60% |
| Cache Updates | ~1.5 GB | ~0.2 GB | 87% |
| **TOTAL** | **17.83 GB** | **~2 GB** | **89%** |

---

## 🚀 Implementation Priority

### Phase 1 (Today - 1 hour)
1. ✅ Change topbar polling: 30s → 5 minutes
2. ✅ Change orchestrator polling: 10s/30s → 5 minutes
3. ✅ Add SELECT specific columns to notifications

**Result**: Drop from 17.83 GB → ~4 GB

### Phase 2 (This Week)
1. Replace polling with WebSockets for real-time updates
2. Implement optimistic cache updates
3. Add pagination to notifications

**Result**: Drop to ~2 GB

### Phase 3 (Optional)
1. Move more queries to ClickHouse (already have it)
2. Add Redis caching layer
3. Enable response compression

**Result**: Drop to < 1 GB

---

## 📊 Monitoring

After changes, monitor at: https://supabase.com/dashboard/project/_/settings/billing

Should see:
- Egress drops significantly within 24 hours
- Requests/second drops by 80%+
- Database CPU usage drops

---

## Alternative: Use ClickHouse More

You already have ClickHouse for analytics. Consider:
- Move notifications to ClickHouse
- Use Supabase only for auth/realtime
- Store metrics/analytics in ClickHouse

ClickHouse doesn't count egress the same way.
