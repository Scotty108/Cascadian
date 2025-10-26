/**
 * Notification Service
 *
 * Centralized service for creating and managing notifications for autonomous strategies.
 * Handles notification creation, user preferences, and quiet hours.
 *
 * @module lib/services/notification-service
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Notification types for autonomous strategies
 */
export type StrategyNotificationType =
  | 'strategy_started'
  | 'strategy_paused'
  | 'strategy_stopped'
  | 'strategy_error'
  | 'watchlist_updated'
  | 'execution_completed'
  | 'execution_failed';

/**
 * Notification priority levels
 */
export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

/**
 * Notification data structure
 */
export interface NotificationData {
  user_id?: string;
  workflow_id?: string;
  type: StrategyNotificationType;
  title: string;
  message: string;
  link?: string;
  priority?: NotificationPriority;
  metadata?: Record<string, any>;
}

/**
 * User notification settings
 */
interface NotificationSettings {
  notification_type: string;
  enabled: boolean;
  delivery_method: 'in-app' | 'email' | 'both';
  quiet_hours_enabled: boolean;
  quiet_hours_start?: string;
  quiet_hours_end?: string;
}

/**
 * Check if current time is within quiet hours
 *
 * @param settings - User notification settings
 * @returns True if within quiet hours
 */
function isWithinQuietHours(settings: NotificationSettings): boolean {
  if (!settings.quiet_hours_enabled) {
    return false;
  }

  if (!settings.quiet_hours_start || !settings.quiet_hours_end) {
    return false;
  }

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTime = currentHour * 60 + currentMinute;

  const [startHour, startMinute] = settings.quiet_hours_start.split(':').map(Number);
  const [endHour, endMinute] = settings.quiet_hours_end.split(':').map(Number);
  const startTime = startHour * 60 + startMinute;
  const endTime = endHour * 60 + endMinute;

  if (startTime < endTime) {
    // Normal case: quiet hours within same day
    return currentTime >= startTime && currentTime < endTime;
  } else {
    // Quiet hours span midnight
    return currentTime >= startTime || currentTime < endTime;
  }
}

/**
 * Get user notification settings for a specific notification type
 *
 * @param userId - User ID
 * @param notificationType - Type of notification
 * @returns Notification settings or null
 */
async function getUserSettings(
  userId: string,
  notificationType: StrategyNotificationType
): Promise<NotificationSettings | null> {
  try {
    const { data, error } = await supabase
      .from('notification_settings')
      .select('*')
      .eq('user_id', userId)
      .eq('notification_type', notificationType)
      .single();

    if (error) {
      // No settings found is not an error - use defaults
      if (error.code === 'PGRST116') {
        return null;
      }
      console.error('[Notification Service] Error fetching settings:', error);
      return null;
    }

    return data as NotificationSettings;
  } catch (error) {
    console.error('[Notification Service] Exception fetching settings:', error);
    return null;
  }
}

/**
 * Create a notification for a strategy event
 *
 * This function checks user preferences and quiet hours before creating a notification.
 * If the notification is disabled or within quiet hours, it will not be created.
 *
 * @param data - Notification data
 * @returns Created notification or null if suppressed
 */
export async function createStrategyNotification(
  data: NotificationData
): Promise<any | null> {
  try {
    // If user_id is provided, check their notification settings
    if (data.user_id) {
      const settings = await getUserSettings(data.user_id, data.type);

      // If settings exist, check if notification is enabled
      if (settings && !settings.enabled) {
        console.log(
          `[Notification Service] Notification type ${data.type} disabled for user ${data.user_id}`
        );
        return null;
      }

      // Check quiet hours
      if (settings && isWithinQuietHours(settings)) {
        console.log(
          `[Notification Service] Notification suppressed (quiet hours) for user ${data.user_id}`
        );
        return null;
      }
    }

    // Create notification via API
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || ''}/api/notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: data.user_id,
        workflow_id: data.workflow_id,
        type: data.type,
        title: data.title,
        message: data.message,
        link: data.link,
        priority: data.priority || 'normal',
        metadata: data.metadata || {},
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('[Notification Service] API error:', errorData);
      return null;
    }

    const result = await response.json();
    return result.data;
  } catch (error) {
    console.error('[Notification Service] Error creating notification:', error);
    return null;
  }
}

/**
 * Helper function to create notification directly with Supabase
 * (for use in server-side contexts where fetch is not available)
 *
 * @param data - Notification data
 * @returns Created notification or null
 */
export async function createNotificationDirect(
  data: NotificationData
): Promise<any | null> {
  try {
    // If user_id is provided, check their notification settings
    if (data.user_id) {
      const settings = await getUserSettings(data.user_id, data.type);

      // If settings exist, check if notification is enabled
      if (settings && !settings.enabled) {
        console.log(
          `[Notification Service] Notification type ${data.type} disabled for user ${data.user_id}`
        );
        return null;
      }

      // Check quiet hours
      if (settings && isWithinQuietHours(settings)) {
        console.log(
          `[Notification Service] Notification suppressed (quiet hours) for user ${data.user_id}`
        );
        return null;
      }
    }

    // Create notification directly
    const { data: notification, error } = await supabase
      .from('notifications')
      .insert({
        user_id: data.user_id || null,
        workflow_id: data.workflow_id || null,
        type: data.type,
        title: data.title,
        message: data.message,
        link: data.link || null,
        priority: data.priority || 'normal',
        metadata: data.metadata || {},
      })
      .select()
      .single();

    if (error) {
      console.error('[Notification Service] Database error:', error);
      return null;
    }

    return notification;
  } catch (error) {
    console.error('[Notification Service] Error creating notification:', error);
    return null;
  }
}

/**
 * Create notification for strategy started event
 */
export async function notifyStrategyStarted(
  userId: string,
  workflowId: string,
  strategyName: string,
  intervalMinutes: number
): Promise<void> {
  await createNotificationDirect({
    user_id: userId,
    workflow_id: workflowId,
    type: 'strategy_started',
    title: `${strategyName} started`,
    message: `Your strategy is now running every ${intervalMinutes} minute${intervalMinutes !== 1 ? 's' : ''}`,
    link: `/strategies/${workflowId}`,
    priority: 'normal',
  });
}

/**
 * Create notification for strategy paused event
 */
export async function notifyStrategyPaused(
  userId: string,
  workflowId: string,
  strategyName: string
): Promise<void> {
  await createNotificationDirect({
    user_id: userId,
    workflow_id: workflowId,
    type: 'strategy_paused',
    title: `${strategyName} paused`,
    message: 'Your strategy has been paused. No further executions will occur.',
    link: `/strategies/${workflowId}`,
    priority: 'normal',
  });
}

/**
 * Create notification for strategy stopped event
 */
export async function notifyStrategyStopped(
  userId: string,
  workflowId: string,
  strategyName: string
): Promise<void> {
  await createNotificationDirect({
    user_id: userId,
    workflow_id: workflowId,
    type: 'strategy_stopped',
    title: `${strategyName} stopped`,
    message: 'Your strategy has been stopped permanently.',
    link: `/strategies/${workflowId}`,
    priority: 'normal',
  });
}

/**
 * Create notification for strategy error event
 */
export async function notifyStrategyError(
  userId: string,
  workflowId: string,
  strategyName: string,
  errorMessage: string,
  autoPaused: boolean = false
): Promise<void> {
  await createNotificationDirect({
    user_id: userId,
    workflow_id: workflowId,
    type: 'strategy_error',
    title: `${strategyName} encountered an error`,
    message: `${errorMessage}${autoPaused ? ' Strategy has been auto-paused after multiple failures.' : ''}`,
    link: `/strategies/${workflowId}`,
    priority: autoPaused ? 'high' : 'normal',
  });
}

/**
 * Create notification for watchlist update event
 */
export async function notifyWatchlistUpdated(
  userId: string,
  workflowId: string,
  strategyName: string,
  marketQuestion: string,
  marketVolume: number
): Promise<void> {
  const volumeFormatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(marketVolume);

  await createNotificationDirect({
    user_id: userId,
    workflow_id: workflowId,
    type: 'watchlist_updated',
    title: `${strategyName} added market to watchlist`,
    message: `Added "${marketQuestion}" (${volumeFormatted} volume)`,
    link: `/strategies/${workflowId}`,
    priority: 'normal',
  });
}

/**
 * Create notification for execution completed event
 */
export async function notifyExecutionCompleted(
  userId: string,
  workflowId: string,
  strategyName: string,
  summary: string
): Promise<void> {
  await createNotificationDirect({
    user_id: userId,
    workflow_id: workflowId,
    type: 'execution_completed',
    title: `${strategyName} completed execution`,
    message: summary,
    link: `/strategies/${workflowId}`,
    priority: 'low',
  });
}

/**
 * Create notification for execution failed event
 */
export async function notifyExecutionFailed(
  userId: string,
  workflowId: string,
  strategyName: string,
  errorMessage: string
): Promise<void> {
  await createNotificationDirect({
    user_id: userId,
    workflow_id: workflowId,
    type: 'execution_failed',
    title: `${strategyName} execution failed`,
    message: errorMessage,
    link: `/strategies/${workflowId}`,
    priority: 'high',
  });
}
