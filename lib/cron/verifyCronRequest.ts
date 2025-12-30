/**
 * Unified Cron Authentication Helper
 *
 * All cron routes MUST use this helper for consistent authentication.
 *
 * Authentication methods (in order of precedence):
 * 1. Authorization: Bearer {CRON_SECRET}  (Vercel Cron sends this automatically)
 * 2. ?token={CRON_SECRET} query param     (for manual testing)
 *
 * Behavior:
 * - Production: Requires CRON_SECRET, rejects if not set
 * - Development: Allows requests if CRON_SECRET is not configured
 *
 * Usage:
 *   import { verifyCronRequest } from '@/lib/cron/verifyCronRequest';
 *
 *   export async function GET(request: Request) {
 *     const authResult = verifyCronRequest(request, 'my-cron-job');
 *     if (!authResult.authorized) {
 *       return NextResponse.json({ error: authResult.reason }, { status: 401 });
 *     }
 *     // ... cron logic
 *   }
 */

export interface CronAuthResult {
  authorized: boolean;
  reason?: string;
  method?: 'bearer' | 'query' | 'dev-mode';
}

/**
 * Verify that a request is authorized to run a cron job.
 *
 * @param request - The incoming HTTP request
 * @param cronName - Name of the cron job (for logging)
 * @returns CronAuthResult with authorization status
 */
export function verifyCronRequest(request: Request, cronName: string): CronAuthResult {
  const cronSecret = process.env.CRON_SECRET;
  const isProduction = process.env.NODE_ENV === 'production';

  // Case 1: Production without CRON_SECRET configured - reject
  if (!cronSecret && isProduction) {
    console.error(`[${cronName}] CRON_SECRET not set in production - rejecting`);
    return {
      authorized: false,
      reason: 'CRON_SECRET not configured in production',
    };
  }

  // Case 2: Development without CRON_SECRET - allow (dev mode)
  if (!cronSecret && !isProduction) {
    console.warn(`[${cronName}] CRON_SECRET not set (dev mode) - allowing request`);
    return {
      authorized: true,
      method: 'dev-mode',
    };
  }

  // Case 3: Check Authorization header (Vercel Cron uses this)
  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${cronSecret}`) {
    return {
      authorized: true,
      method: 'bearer',
    };
  }

  // Case 4: Check ?token= query parameter (manual testing)
  try {
    const url = new URL(request.url);
    const tokenParam = url.searchParams.get('token');
    if (tokenParam === cronSecret) {
      return {
        authorized: true,
        method: 'query',
      };
    }
  } catch {
    // URL parsing failed, continue to reject
  }

  // Case 5: No valid auth found
  console.warn(`[${cronName}] Unauthorized request - no valid auth token`);
  return {
    authorized: false,
    reason: 'Unauthorized - missing or invalid token',
  };
}

/**
 * Quick auth check that returns a boolean.
 * Use verifyCronRequest() for more detailed error handling.
 */
export function isAuthorizedCron(request: Request, cronName: string): boolean {
  return verifyCronRequest(request, cronName).authorized;
}
