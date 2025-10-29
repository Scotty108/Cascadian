# Fix Anonymous Workflow Saves - Quick Guide

## Problem
Workflows weren't saving to database because of authentication errors:
```
Error: User not authenticated
```

## Solution
We've implemented anonymous user support for development. This allows saving workflows without requiring login.

---

## How to Apply the Fix

### Step 1: Apply Database Migration

Run this command in your project root:

```bash
npx supabase db push
```

This will apply the migration: `20251023120001_allow_anonymous_workflows.sql`

**What it does:**
- Updates RLS policies to allow anonymous users
- Anonymous workflows use a special user_id: `00000000-0000-0000-0000-000000000000`
- Authenticated users still use their own user_id

### Step 2: Restart Dev Server

```bash
# Stop server (Ctrl+C)
pnpm dev
```

### Step 3: Test It!

1. Go to Strategy Builder
2. Create a workflow with AI Copilot
3. Click "Save"
4. Should see: ✅ Strategy saved!
5. Go to Strategy Library
6. Your workflow should appear!

---

## What Changed

### Files Modified

1. **supabase/migrations/20251023120001_allow_anonymous_workflows.sql** (NEW)
   - Updated RLS policies to allow anonymous access
   - Anonymous users can insert/update/select workflows

2. **lib/services/workflow-session-service.ts**
   - `createWorkflow()` now uses anonymous ID when not authenticated
   - No more "User not authenticated" errors

3. **app/(dashboard)/strategy-builder/page.tsx**
   - Simplified save handler
   - Clearer success messages

---

## How It Works

### Before (Broken)
```
User creates workflow → Try to save → Auth check fails → Error thrown → Save fails
```

### After (Fixed)
```
User creates workflow → Try to save → Use anonymous ID if no auth → Save succeeds ✅
```

### Database Structure
```sql
-- Authenticated users
user_id: "real-user-uuid-here"

-- Anonymous users (development)
user_id: "00000000-0000-0000-0000-000000000000"
```

---

## Security Notes

### Development vs Production

**Development (Current Setup):**
- Anonymous users can save workflows
- Good for testing without auth
- Workflows tied to anonymous user_id

**Production (Future):**
- Remove this migration before deployment
- Require proper authentication
- Each user has their own workflows

### How to Disable Anonymous Access (Production)

When ready for production:

1. Delete migration file:
   ```bash
   rm supabase/migrations/20251023120001_allow_anonymous_workflows.sql
   ```

2. Create new migration to restore auth requirement:
   ```sql
   -- Restore original policies
   DROP POLICY workflow_sessions_insert_own_or_anon ON workflow_sessions;
   DROP POLICY workflow_sessions_update_own_or_anon ON workflow_sessions;
   DROP POLICY workflow_sessions_select_own_or_anon ON workflow_sessions;

   -- Require authentication
   CREATE POLICY workflow_sessions_insert_own
     ON workflow_sessions FOR INSERT
     WITH CHECK (auth.uid() = user_id);

   CREATE POLICY workflow_sessions_update_own
     ON workflow_sessions FOR UPDATE
     USING (auth.uid() = user_id);

   CREATE POLICY workflow_sessions_select_own
     ON workflow_sessions FOR SELECT
     USING (auth.uid() = user_id OR is_template = TRUE);
   ```

3. Implement authentication in your app
4. Test with real user accounts

---

## Benefits

### For Development
✅ No auth setup needed
✅ Faster testing
✅ Workflows persist in database
✅ Strategy library works
✅ No localStorage workarounds

### For Users
✅ Save button works
✅ Workflows appear in library
✅ No confusing error messages
✅ Clean console (no auth errors)

---

## Troubleshooting

### "Migration failed"
```bash
# Check migration syntax
npx supabase db reset

# Re-push migrations
npx supabase db push
```

### "Still getting auth errors"
1. Clear browser cache
2. Hard refresh (Cmd+Shift+R)
3. Restart dev server
4. Check migration was applied:
   ```bash
   npx supabase db diff
   ```

### "Workflows not appearing in library"
1. Check save succeeds (✅ message appears)
2. Refresh Strategy Library page
3. Check browser console for errors
4. Verify migration applied correctly

---

## Next Steps

### After This Fix Works

1. ✅ Workflows save to database
2. ✅ Strategy library shows saved workflows
3. ✅ No authentication errors
4. (Optional) Enable real Polymarket data (see ENABLE_REAL_DATA.md)
5. (Optional) Set up authentication for production

---

## Questions?

If you encounter issues:
1. Check browser console for errors
2. Check server terminal for migration errors
3. Verify migration file exists in `supabase/migrations/`
4. Try running `npx supabase db reset` to start fresh

---

**Summary:** This fix allows anonymous workflow saves during development. When ready for production, simply remove the migration and implement proper authentication!
