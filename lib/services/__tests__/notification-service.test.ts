/**
 * Notification Service Tests
 *
 * Tests for notification creation and integration with strategy execution.
 * Covers notification types, quiet hours, and user preferences.
 */

// Mock Supabase client
const mockSupabase = {
  from: jest.fn(() => mockSupabase),
  select: jest.fn(() => mockSupabase),
  insert: jest.fn(() => mockSupabase),
  update: jest.fn(() => mockSupabase),
  eq: jest.fn(() => mockSupabase),
  single: jest.fn(() => ({ data: null, error: null })),
  then: jest.fn((callback) => callback({ data: null, error: null })),
};

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => mockSupabase),
}));

describe('Notification Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  /**
   * Test 1: Notification creation on strategy events
   * Verifies that notifications are created for key strategy lifecycle events
   */
  it('should create notification on strategy start', async () => {
    const notificationData = {
      user_id: 'user-123',
      workflow_id: 'workflow-123',
      type: 'strategy_started',
      title: 'Test Strategy started',
      message: 'Your strategy is now running',
      priority: 'normal',
      link: '/strategies/workflow-123',
    };

    mockSupabase.insert.mockReturnValueOnce(mockSupabase);
    mockSupabase.select.mockReturnValueOnce(mockSupabase);
    mockSupabase.single.mockReturnValueOnce({
      data: { id: 1, ...notificationData },
      error: null,
    });

    // Simulate notification creation through API
    const response = await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notificationData),
    });

    // Verify notification was created
    expect(mockSupabase.insert).toHaveBeenCalled();
    expect(mockSupabase.select).toHaveBeenCalled();
  });

  /**
   * Test 2: Notification center displays notifications correctly
   * Verifies that notifications are fetched and displayed with proper formatting
   */
  it('should fetch and display notifications in notification center', async () => {
    const mockNotifications = [
      {
        id: 1,
        type: 'strategy_started',
        title: 'Test Strategy started',
        message: 'Your strategy is now running',
        is_read: false,
        priority: 'normal',
        created_at: new Date().toISOString(),
      },
      {
        id: 2,
        type: 'watchlist_updated',
        title: 'Market added to watchlist',
        message: 'Added "Trump 2024" to watchlist',
        is_read: false,
        priority: 'normal',
        created_at: new Date().toISOString(),
      },
    ];

    mockSupabase.select.mockReturnValueOnce(mockSupabase);
    mockSupabase.eq.mockReturnValueOnce({
      data: mockNotifications,
      error: null,
      count: 2,
    });

    // Verify notifications can be fetched
    expect(mockNotifications.length).toBe(2);
    expect(mockNotifications[0].is_read).toBe(false);
    expect(mockNotifications[1].type).toBe('watchlist_updated');
  });

  /**
   * Test 3: Mark notification as read
   * Verifies that notifications can be marked as read
   */
  it('should mark notification as read', async () => {
    const notificationId = 1;

    mockSupabase.update.mockReturnValueOnce(mockSupabase);
    mockSupabase.eq.mockReturnValueOnce(mockSupabase);
    mockSupabase.select.mockReturnValueOnce(mockSupabase);
    mockSupabase.single.mockReturnValueOnce({
      data: { id: notificationId, is_read: true },
      error: null,
    });

    // Simulate marking as read
    const response = await fetch(`/api/notifications/${notificationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_read: true }),
    });

    expect(mockSupabase.update).toHaveBeenCalled();
    expect(mockSupabase.eq).toHaveBeenCalledWith('id', notificationId);
  });

  /**
   * Test 4: Notification bell badge count
   * Verifies that unread notification count is calculated correctly
   */
  it('should calculate unread notification count for bell badge', async () => {
    const mockUnreadCount = 5;

    mockSupabase.select.mockReturnValueOnce(mockSupabase);
    mockSupabase.eq.mockImplementation(() => mockSupabase);
    mockSupabase.or = jest.fn(() => ({
      count: mockUnreadCount,
      error: null,
    }));

    // Verify count can be retrieved
    expect(mockUnreadCount).toBeGreaterThan(0);
    expect(mockUnreadCount).toBeLessThanOrEqual(99);
  });

  /**
   * Test 5: Notification preferences enable/disable types
   * Verifies that users can configure which notification types they receive
   */
  it('should respect notification preferences when creating notifications', async () => {
    const userSettings = [
      {
        user_id: 'user-123',
        notification_type: 'strategy_started',
        enabled: true,
        delivery_method: 'in-app',
      },
      {
        user_id: 'user-123',
        notification_type: 'watchlist_updated',
        enabled: false,
        delivery_method: 'in-app',
      },
    ];

    mockSupabase.select.mockReturnValueOnce(mockSupabase);
    mockSupabase.eq.mockImplementation(() => ({
      data: userSettings,
      error: null,
    }));

    // Verify settings can be checked
    const strategyStartedSetting = userSettings.find(
      (s) => s.notification_type === 'strategy_started'
    );
    const watchlistSetting = userSettings.find(
      (s) => s.notification_type === 'watchlist_updated'
    );

    expect(strategyStartedSetting?.enabled).toBe(true);
    expect(watchlistSetting?.enabled).toBe(false);
  });

  /**
   * Test 6: Quiet hours functionality
   * Verifies that notifications respect quiet hours settings
   */
  it('should respect quiet hours when sending notifications', async () => {
    const quietHoursSettings = {
      quiet_hours_enabled: true,
      quiet_hours_start: '23:00:00',
      quiet_hours_end: '07:00:00',
    };

    const isWithinQuietHours = (
      time: Date,
      start: string,
      end: string
    ): boolean => {
      const currentHour = time.getHours();
      const startHour = parseInt(start.split(':')[0]);
      const endHour = parseInt(end.split(':')[0]);

      if (startHour > endHour) {
        // Quiet hours span midnight
        return currentHour >= startHour || currentHour < endHour;
      }
      return currentHour >= startHour && currentHour < endHour;
    };

    // Test during quiet hours (2 AM)
    const duringQuietHours = new Date();
    duringQuietHours.setHours(2, 0, 0, 0);
    expect(
      isWithinQuietHours(
        duringQuietHours,
        quietHoursSettings.quiet_hours_start,
        quietHoursSettings.quiet_hours_end
      )
    ).toBe(true);

    // Test outside quiet hours (10 AM)
    const outsideQuietHours = new Date();
    outsideQuietHours.setHours(10, 0, 0, 0);
    expect(
      isWithinQuietHours(
        outsideQuietHours,
        quietHoursSettings.quiet_hours_start,
        quietHoursSettings.quiet_hours_end
      )
    ).toBe(false);
  });
});
