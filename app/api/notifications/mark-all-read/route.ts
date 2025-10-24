/**
 * Mark All Notifications as Read API
 *
 * PATCH: Marks all unread notifications as read
 *
 * Data source: notifications table
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function PATCH(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    // Build query for unread notifications
    let query = supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('is_read', false)
      .eq('is_archived', false);

    // Filter by user if provided
    if (userId) {
      query = query.or(`user_id.eq.${userId},user_id.is.null`);
    }

    // Execute update
    const { data, error } = await query.select();

    if (error) {
      console.error('[Mark All Read API] Database error:', error);
      throw error;
    }

    return NextResponse.json({
      success: true,
      count: data?.length || 0,
      message: `${data?.length || 0} notifications marked as read`,
    });
  } catch (error) {
    console.error('[Mark All Read API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to mark notifications as read',
        count: 0,
      },
      { status: 500 }
    );
  }
}
