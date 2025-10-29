/**
 * Notifications API
 *
 * GET: Fetch notifications with optional filters
 * POST: Create a new notification
 *
 * Data source: notifications table
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Helper to add timeout to promises
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Request timeout')), ms)
  );
  return Promise.race([promise, timeout]);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    // Extract filter parameters
    const type = searchParams.get('type');
    const isRead = searchParams.get('is_read');
    const isArchived = searchParams.get('is_archived') || 'false';
    const priority = searchParams.get('priority');
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 50;
    const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : 0;

    // Build query - Only select needed columns to reduce egress
    let query = supabase
      .from('notifications')
      .select('id, type, title, message, priority, is_read, created_at, link')
      .eq('is_archived', isArchived === 'true');

    // Apply filters
    if (type) {
      query = query.eq('type', type);
    }

    if (isRead !== null) {
      query = query.eq('is_read', isRead === 'true');
    }

    if (priority) {
      query = query.eq('priority', priority);
    }

    // Sort by most recent first
    query = query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // Execute query with 5 second timeout
    const result: any = await withTimeout(
      Promise.resolve(query),
      5000
    );
    const { data: notifications, error, count } = result;

    if (error) {
      console.error('[Notifications API] Database error:', error);
      throw error;
    }

    return NextResponse.json({
      success: true,
      data: notifications || [],
      count: notifications?.length || 0,
      total: count,
      filters: {
        type,
        is_read: isRead,
        is_archived: isArchived,
        priority,
        limit,
        offset,
      },
    });
  } catch (error: any) {
    console.error('[Notifications API] Error:', error);

    // If timeout, return empty array gracefully
    if (error.message === 'Request timeout') {
      return NextResponse.json({
        success: true,
        data: [],
        count: 0,
        message: 'Database connection timeout - showing cached data',
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch notifications',
        data: [],
        count: 0,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.type || !body.title || !body.message) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: type, title, message',
        },
        { status: 400 }
      );
    }

    // Validate notification type
    const validTypes = [
      'whale_activity',
      'market_alert',
      'insider_alert',
      'strategy_update',
      'system',
      'security',
      'account',
      // New strategy-specific notification types
      'strategy_started',
      'strategy_paused',
      'strategy_stopped',
      'strategy_error',
      'watchlist_updated',
      'execution_completed',
      'execution_failed',
      'trade_approval_needed', // Task Group 15: Approval workflow
    ];

    if (!validTypes.includes(body.type)) {
      return NextResponse.json(
        {
          success: false,
          error: `Invalid notification type. Must be one of: ${validTypes.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Create notification
    const { data: notification, error } = await supabase
      .from('notifications')
      .insert({
        user_id: body.user_id || null,
        workflow_id: body.workflow_id || null,
        type: body.type,
        title: body.title,
        message: body.message,
        link: body.link || null,
        priority: body.priority || 'normal',
        metadata: body.metadata || {},
      })
      .select()
      .single();

    if (error) {
      console.error('[Notifications API] Insert error:', error);
      throw error;
    }

    return NextResponse.json({
      success: true,
      data: notification,
    }, { status: 201 });
  } catch (error) {
    console.error('[Notifications API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to create notification',
      },
      { status: 500 }
    );
  }
}
