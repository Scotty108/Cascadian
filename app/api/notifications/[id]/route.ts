/**
 * Individual Notification API
 *
 * PATCH: Update notification (mark as read/archived)
 * DELETE: Delete a notification
 *
 * Data source: notifications table
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const notificationId = parseInt(params.id);

    if (isNaN(notificationId)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid notification ID',
        },
        { status: 400 }
      );
    }

    const body = await request.json();

    // Build update object
    const updates: any = {};

    if (typeof body.is_read === 'boolean') {
      updates.is_read = body.is_read;
    }

    if (typeof body.is_archived === 'boolean') {
      updates.is_archived = body.is_archived;
    }

    // If no updates provided, return error
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No valid update fields provided',
        },
        { status: 400 }
      );
    }

    // Execute update
    const { data: notification, error } = await supabase
      .from('notifications')
      .update(updates)
      .eq('id', notificationId)
      .select()
      .single();

    if (error) {
      console.error('[Notification Update API] Database error:', error);
      throw error;
    }

    if (!notification) {
      return NextResponse.json(
        {
          success: false,
          error: 'Notification not found',
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: notification,
    });
  } catch (error) {
    console.error('[Notification Update API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update notification',
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const notificationId = parseInt(params.id);

    if (isNaN(notificationId)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid notification ID',
        },
        { status: 400 }
      );
    }

    // Execute delete
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId);

    if (error) {
      console.error('[Notification Delete API] Database error:', error);
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: 'Notification deleted successfully',
    });
  } catch (error) {
    console.error('[Notification Delete API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to delete notification',
      },
      { status: 500 }
    );
  }
}
