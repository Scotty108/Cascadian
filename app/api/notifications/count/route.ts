/**
 * Notifications Count API
 *
 * GET: Returns the count of unread notifications
 *
 * Data source: notifications table
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    // Build query for unread, non-archived notifications
    let query = supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('is_read', false)
      .eq('is_archived', false);

    // Filter by user if provided
    if (userId) {
      query = query.or(`user_id.eq.${userId},user_id.is.null`);
    }

    // Execute query
    const { count, error } = await query;

    if (error) {
      console.error('[Notifications Count API] Database error:', error);
      throw error;
    }

    return NextResponse.json({
      success: true,
      count: count || 0,
    });
  } catch (error) {
    console.error('[Notifications Count API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch notification count',
        count: 0,
      },
      { status: 500 }
    );
  }
}
