# Workflow Anonymous Authentication Fix

**Date:** October 23, 2025
**Status:** ✅ COMPLETE
**Migration:** `20251023120001_allow_anonymous_workflows.sql`

## Problem

Users were unable to save workflows to the database due to authentication errors:
- Error: "User not authenticated"
- RLS policies required `auth.uid()` to match `user_id`
- No authentication system was implemented in the application
- Workflows could not be persisted to the database

## Solution

Applied a development-focused migration that allows anonymous users to save workflows using a well-known anonymous UUID.

### Migration Applied

**File:** `/Users/scotty/Projects/Cascadian-app/supabase/migrations/20251023120001_allow_anonymous_workflows.sql`

**Key Changes:**
1. Dropped restrictive RLS policies that required authenticated users
2. Created new RLS policies that support both authenticated and anonymous users
3. Anonymous users use special UUID: `00000000-0000-0000-0000-000000000000`
4. Authenticated users (when implemented) will use their own `user_id`

### New RLS Policies

#### SELECT Policy: `workflow_sessions_select_own_or_anon`
- Authenticated users can view their own workflows
- Anonymous users can view workflows with anonymous UUID
- Anyone can view templates (`is_template = TRUE`)

#### INSERT Policy: `workflow_sessions_insert_own_or_anon`
- Authenticated users must use their own `user_id`
- Anonymous users must use anonymous UUID

#### UPDATE Policy: `workflow_sessions_update_own_or_anon`
- Authenticated users can update their own workflows
- Anonymous users can update anonymous workflows

#### DELETE Policy
- Kept restrictive (only authenticated users can delete)
- Prevents accidental data loss during development

## Verification

### Test Script Created
**File:** `/Users/scotty/Projects/Cascadian-app/scripts/test-anonymous-workflow.ts`

### Test Results
```
✅ INSERT successful - Anonymous users can create workflows
✅ SELECT successful - Anonymous users can retrieve workflows
✅ UPDATE successful - Anonymous users can update workflows
✅ RLS policies are working correctly
```

### Database Status
```bash
$ npx supabase db push --dry-run
Remote database is up to date.
```

All migrations have been applied successfully.

## Security Considerations

### Development Only
This migration is designed for **development and testing** purposes:
- Allows rapid prototyping without authentication setup
- All anonymous workflows share the same `user_id`
- No user isolation for anonymous workflows

### Production Considerations
Before deploying to production:
1. **Implement proper authentication** (Supabase Auth, NextAuth, etc.)
2. **Remove or replace this migration** with production-ready policies
3. **Migrate anonymous workflows** to authenticated users if needed
4. **Add DELETE policy** for authenticated users

### Current Security Model
- Anonymous users are isolated from authenticated users
- Anonymous users cannot access authenticated user workflows
- Authenticated users cannot access anonymous workflows
- Templates remain publicly viewable (as intended)
- DELETE operations require authentication (prevents data loss)

## Migration Details

### Applied Migration
```sql
-- Drop old restrictive policies
DROP POLICY IF EXISTS workflow_sessions_insert_own ON workflow_sessions;
DROP POLICY IF EXISTS workflow_sessions_update_own ON workflow_sessions;
DROP POLICY IF EXISTS workflow_sessions_select_own ON workflow_sessions;

-- Create new policies supporting anonymous access
CREATE POLICY workflow_sessions_select_own_or_anon
  ON workflow_sessions FOR SELECT
  USING (
    auth.uid() = user_id
    OR is_template = TRUE
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE POLICY workflow_sessions_insert_own_or_anon
  ON workflow_sessions FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE POLICY workflow_sessions_update_own_or_anon
  ON workflow_sessions FOR UPDATE
  USING (
    auth.uid() = user_id
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WITH CHECK (
    auth.uid() = user_id
    OR (auth.uid() IS NULL AND user_id = '00000000-0000-0000-0000-000000000000'::uuid)
  );
```

### Migration Validation
```
NOTICE: Anonymous user ID for development: 00000000-0000-0000-0000-000000000000
NOTICE: ✅ Anonymous workflow access enabled for development
NOTICE: 📝 Anonymous workflows will use user_id: 00000000-0000-0000-0000-000000000000
NOTICE: ⚠️  REMINDER: Remove this migration before production deployment
```

## Application Integration

### Client-Side Usage
When saving workflows from the frontend:
```typescript
const ANONYMOUS_USER_ID = '00000000-0000-0000-0000-000000000000';

// Save workflow
const { data, error } = await supabase
  .from('workflow_sessions')
  .insert({
    user_id: ANONYMOUS_USER_ID,
    name: 'My Workflow',
    nodes: [...],
    edges: [...],
    status: 'draft'
  });
```

### Checking Authentication Status
```typescript
// Check if user is authenticated
const { data: { user } } = await supabase.auth.getUser();

const userId = user?.id || ANONYMOUS_USER_ID;

// Use appropriate user_id when saving
await supabase.from('workflow_sessions').insert({
  user_id: userId,
  // ... rest of workflow data
});
```

## Next Steps

### Immediate (Development)
- ✅ Migration applied and tested
- ✅ RLS policies verified
- ✅ Anonymous workflow saves working
- Application can now persist workflows to database

### Future (Production Readiness)
1. **Implement Authentication**
   - Set up Supabase Auth or alternative
   - Add login/signup UI
   - Update application to use authenticated user IDs

2. **Update RLS Policies**
   - Remove anonymous access policies
   - Implement production-ready policies
   - Add proper user isolation

3. **Data Migration**
   - Migrate anonymous workflows to authenticated users (if needed)
   - Clean up test/development data

4. **Security Audit**
   - Review all RLS policies
   - Test with authenticated users
   - Verify no data leakage between users

## Files Modified

### New Files
- `/Users/scotty/Projects/Cascadian-app/supabase/migrations/20251023120001_allow_anonymous_workflows.sql`
- `/Users/scotty/Projects/Cascadian-app/scripts/test-anonymous-workflow.ts`
- `/Users/scotty/Projects/Cascadian-app/WORKFLOW_ANONYMOUS_AUTH_FIX.md` (this file)

### Related Files
- `/Users/scotty/Projects/Cascadian-app/supabase/migrations/20251023000000_create_workflow_sessions.sql` (original schema)
- `/Users/scotty/Projects/Cascadian-app/lib/supabase.ts` (Supabase client configuration)

## Support

### Troubleshooting

**Error: "User not authenticated"**
- Ensure you're using `ANONYMOUS_USER_ID` constant
- Verify migration was applied: `npx supabase db push --dry-run`
- Check Supabase connection in `.env.local`

**Error: "Permission denied"**
- Verify RLS policies exist in database
- Check that `user_id` matches anonymous UUID
- Ensure `auth.uid()` is NULL (not authenticated)

**Error: "Cannot delete workflow"**
- DELETE policy requires authentication
- This is intentional to prevent data loss
- Use admin client or implement authentication

### Testing

Run the test script to verify RLS policies:
```bash
npx tsx scripts/test-anonymous-workflow.ts
```

Expected output:
```
🎉 All anonymous workflow tests passed!
✅ Anonymous users can INSERT workflows
✅ Anonymous users can SELECT their workflows
✅ Anonymous users can UPDATE their workflows
✅ RLS policies are working correctly
```

## Summary

✅ **Migration Applied Successfully**
✅ **RLS Policies Working Correctly**
✅ **Anonymous Users Can Save Workflows**
✅ **Tests Passing**
✅ **Database Schema Up to Date**

The application can now save workflows to the database without requiring user authentication. This enables development and testing of the workflow builder feature while authentication is implemented separately.

**IMPORTANT:** Remember to implement proper authentication before production deployment and remove/replace this development-only migration.
