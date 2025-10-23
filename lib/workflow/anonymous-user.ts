/**
 * Anonymous User Utilities
 *
 * Provides utilities for working with anonymous users in the workflow system.
 * This is a development-only feature that allows users to save workflows
 * without authentication.
 *
 * IMPORTANT: Replace this with proper authentication before production deployment.
 */

/**
 * Anonymous User ID
 * Well-known UUID used for all anonymous workflow operations
 */
export const ANONYMOUS_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Get the current user ID for workflow operations
 * Returns authenticated user ID if available, otherwise returns anonymous ID
 *
 * @param authenticatedUserId - The authenticated user's ID (from auth.uid())
 * @returns User ID to use for workflow operations
 *
 * @example
 * ```typescript
 * import { supabase } from '@/lib/supabase';
 * import { getCurrentUserId } from '@/lib/workflow/anonymous-user';
 *
 * // Get current user
 * const { data: { user } } = await supabase.auth.getUser();
 *
 * // Get appropriate user ID
 * const userId = getCurrentUserId(user?.id);
 *
 * // Save workflow
 * await supabase.from('workflow_sessions').insert({
 *   user_id: userId,
 *   name: 'My Workflow',
 *   // ...
 * });
 * ```
 */
export function getCurrentUserId(authenticatedUserId?: string | null): string {
  return authenticatedUserId || ANONYMOUS_USER_ID;
}

/**
 * Check if a user ID is the anonymous user
 *
 * @param userId - User ID to check
 * @returns True if the user ID is the anonymous user
 *
 * @example
 * ```typescript
 * if (isAnonymousUser(userId)) {
 *   console.log('This is an anonymous user');
 * }
 * ```
 */
export function isAnonymousUser(userId: string | null | undefined): boolean {
  return userId === ANONYMOUS_USER_ID;
}

/**
 * Get a display name for a user
 * Returns "Anonymous User" for anonymous users, or a custom name for authenticated users
 *
 * @param userId - User ID
 * @param userName - Optional user name from auth system
 * @returns Display name for the user
 *
 * @example
 * ```typescript
 * const displayName = getUserDisplayName(userId, user?.name);
 * // Returns "Anonymous User" or "John Doe"
 * ```
 */
export function getUserDisplayName(
  userId: string | null | undefined,
  userName?: string | null
): string {
  if (isAnonymousUser(userId)) {
    return 'Anonymous User';
  }
  return userName || 'User';
}
