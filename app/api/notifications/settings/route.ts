/**
 * Notification Settings API
 *
 * GET: Fetch user notification preferences
 * PATCH: Update user notification preferences
 *
 * Data source: notification_settings table
 */

import { NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';

/**
 * GET /api/notifications/settings
 *
 * Fetch user notification preferences for all notification types.
 * If no settings exist for a user, returns empty array (frontend should use defaults).
 *
 * Query params:
 * - user_id: User ID to fetch settings for
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');

    if (!userId) {
      return NextResponse.json(
        {
          success: false,
          error: 'user_id query parameter is required',
        },
        { status: 400 }
      );
    }

    // Fetch all notification settings for user
    const { data: settings, error } = await supabase
      .from('notification_settings')
      .select('*')
      .eq('user_id', userId)
      .order('notification_type', { ascending: true });

    if (error) {
      console.error('[Notification Settings API] Database error:', error);
      throw error;
    }

    return NextResponse.json({
      success: true,
      data: settings || [],
      count: settings?.length || 0,
    });
  } catch (error) {
    console.error('[Notification Settings API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch notification settings',
        data: [],
        count: 0,
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/notifications/settings
 *
 * Update or create notification preferences for a user.
 * Supports batch updates for multiple notification types.
 *
 * Request body:
 * {
 *   user_id: string,
 *   settings: Array<{
 *     notification_type: string,
 *     enabled?: boolean,
 *     delivery_method?: 'in-app' | 'email' | 'both',
 *     quiet_hours_enabled?: boolean,
 *     quiet_hours_start?: string (HH:MM:SS),
 *     quiet_hours_end?: string (HH:MM:SS)
 *   }>
 * }
 */
export async function PATCH(request: Request) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.user_id) {
      return NextResponse.json(
        {
          success: false,
          error: 'user_id is required',
        },
        { status: 400 }
      );
    }

    if (!body.settings || !Array.isArray(body.settings)) {
      return NextResponse.json(
        {
          success: false,
          error: 'settings array is required',
        },
        { status: 400 }
      );
    }

    // Validate notification types
    const validNotificationTypes = [
      'strategy_started',
      'strategy_paused',
      'strategy_stopped',
      'strategy_error',
      'watchlist_updated',
      'execution_completed',
      'execution_failed',
      'whale_activity',
      'market_alert',
      'insider_alert',
      'strategy_update',
      'system',
      'security',
      'account',
    ];

    const validDeliveryMethods = ['in-app', 'email', 'both'];

    // Process each setting
    const updatedSettings: any[] = [];
    const errors: string[] = [];

    for (const setting of body.settings) {
      try {
        // Validate notification type
        if (!validNotificationTypes.includes(setting.notification_type)) {
          errors.push(
            `Invalid notification type: ${setting.notification_type}`
          );
          continue;
        }

        // Validate delivery method if provided
        if (
          setting.delivery_method &&
          !validDeliveryMethods.includes(setting.delivery_method)
        ) {
          errors.push(
            `Invalid delivery method for ${setting.notification_type}: ${setting.delivery_method}`
          );
          continue;
        }

        // Build update object
        const updateData: any = {
          user_id: body.user_id,
          notification_type: setting.notification_type,
          updated_at: new Date().toISOString(),
        };

        if (typeof setting.enabled === 'boolean') {
          updateData.enabled = setting.enabled;
        }

        if (setting.delivery_method) {
          updateData.delivery_method = setting.delivery_method;
        }

        if (typeof setting.quiet_hours_enabled === 'boolean') {
          updateData.quiet_hours_enabled = setting.quiet_hours_enabled;
        }

        if (setting.quiet_hours_start) {
          updateData.quiet_hours_start = setting.quiet_hours_start;
        }

        if (setting.quiet_hours_end) {
          updateData.quiet_hours_end = setting.quiet_hours_end;
        }

        // Upsert (update or insert) the setting
        const { data, error } = await supabase
          .from('notification_settings')
          .upsert(updateData, {
            onConflict: 'user_id,notification_type',
          })
          .select()
          .single();

        if (error) {
          console.error(
            '[Notification Settings API] Upsert error:',
            error
          );
          errors.push(
            `Failed to update ${setting.notification_type}: ${error.message}`
          );
          continue;
        }

        updatedSettings.push(data);
      } catch (error: any) {
        console.error('[Notification Settings API] Error processing setting:', error);
        errors.push(
          `Error processing ${setting.notification_type}: ${error.message}`
        );
      }
    }

    // Return results
    return NextResponse.json({
      success: errors.length === 0,
      data: {
        updated_count: updatedSettings.length,
        updated_settings: updatedSettings,
        errors: errors.length > 0 ? errors : undefined,
      },
      message:
        errors.length === 0
          ? `Successfully updated ${updatedSettings.length} notification settings`
          : `Updated ${updatedSettings.length} settings with ${errors.length} errors`,
    });
  } catch (error) {
    console.error('[Notification Settings API] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update notification settings',
      },
      { status: 500 }
    );
  }
}
