/**
 * Notification Settings Panel
 *
 * Allows users to configure notification preferences for autonomous strategies.
 * Users can enable/disable specific notification types and configure quiet hours.
 *
 * @module components/notification-settings-panel
 */

'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Bell, Clock, Save, Loader2 } from 'lucide-react';

interface NotificationSetting {
  notification_type: string;
  enabled: boolean;
  delivery_method: 'in-app' | 'email' | 'both';
  quiet_hours_enabled: boolean;
  quiet_hours_start?: string;
  quiet_hours_end?: string;
}

const NOTIFICATION_TYPES = [
  {
    type: 'strategy_started',
    label: 'Strategy Started',
    description: 'When a strategy begins running autonomously',
  },
  {
    type: 'strategy_paused',
    label: 'Strategy Paused',
    description: 'When a strategy is paused',
  },
  {
    type: 'strategy_stopped',
    label: 'Strategy Stopped',
    description: 'When a strategy is stopped permanently',
  },
  {
    type: 'strategy_error',
    label: 'Strategy Errors',
    description: 'When a strategy encounters execution errors',
  },
  {
    type: 'watchlist_updated',
    label: 'Watchlist Updates',
    description: 'When markets are added to your watchlist',
  },
  {
    type: 'execution_completed',
    label: 'Execution Completed',
    description: 'When a strategy completes an execution cycle',
  },
  {
    type: 'execution_failed',
    label: 'Execution Failed',
    description: 'When a strategy execution fails',
  },
];

interface NotificationSettingsPanelProps {
  userId: string;
}

export function NotificationSettingsPanel({ userId }: NotificationSettingsPanelProps) {
  const [settings, setSettings] = useState<Record<string, NotificationSetting>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [globalQuietHours, setGlobalQuietHours] = useState({
    enabled: false,
    start: '23:00',
    end: '07:00',
  });
  const { toast } = useToast();

  // Fetch current settings
  useEffect(() => {
    fetchSettings();
  }, [userId]);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/notifications/settings?user_id=${userId}`);
      const result = await response.json();

      if (result.success) {
        // Convert array to map for easier access
        const settingsMap: Record<string, NotificationSetting> = {};

        // Initialize with defaults
        NOTIFICATION_TYPES.forEach((type) => {
          settingsMap[type.type] = {
            notification_type: type.type,
            enabled: true, // Default: all enabled
            delivery_method: 'in-app',
            quiet_hours_enabled: false,
          };
        });

        // Override with saved settings
        result.data.forEach((setting: NotificationSetting) => {
          settingsMap[setting.notification_type] = setting;

          // Extract global quiet hours from first setting that has them
          if (setting.quiet_hours_enabled && setting.quiet_hours_start && setting.quiet_hours_end) {
            setGlobalQuietHours({
              enabled: setting.quiet_hours_enabled,
              start: setting.quiet_hours_start.substring(0, 5), // HH:MM
              end: setting.quiet_hours_end.substring(0, 5), // HH:MM
            });
          }
        });

        setSettings(settingsMap);
      }
    } catch (error) {
      console.error('Failed to fetch notification settings:', error);
      toast({
        title: 'Error',
        description: 'Failed to load notification settings',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleNotification = (type: string) => {
    setSettings((prev) => ({
      ...prev,
      [type]: {
        ...prev[type],
        enabled: !prev[type].enabled,
      },
    }));
  };

  const toggleGlobalQuietHours = () => {
    setGlobalQuietHours((prev) => ({
      ...prev,
      enabled: !prev.enabled,
    }));
  };

  const updateQuietHours = (field: 'start' | 'end', value: string) => {
    setGlobalQuietHours((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const saveSettings = async () => {
    try {
      setSaving(true);

      // Convert settings map to array and apply global quiet hours
      const settingsArray = Object.values(settings).map((setting) => ({
        notification_type: setting.notification_type,
        enabled: setting.enabled,
        delivery_method: setting.delivery_method,
        quiet_hours_enabled: globalQuietHours.enabled,
        quiet_hours_start: globalQuietHours.enabled ? `${globalQuietHours.start}:00` : null,
        quiet_hours_end: globalQuietHours.enabled ? `${globalQuietHours.end}:00` : null,
      }));

      const response = await fetch('/api/notifications/settings', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userId,
          settings: settingsArray,
        }),
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: 'Settings saved',
          description: 'Your notification preferences have been updated',
        });
        fetchSettings(); // Refresh
      } else {
        throw new Error(result.error || 'Failed to save settings');
      }
    } catch (error: any) {
      console.error('Failed to save notification settings:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to save notification settings',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Loader2 className="h-8 w-8 mx-auto animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-4">Loading notification settings...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Notification Type Toggles */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Notification Preferences
          </CardTitle>
          <CardDescription>
            Choose which strategy events you want to be notified about
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {NOTIFICATION_TYPES.map((type) => {
            const setting = settings[type.type];
            if (!setting) return null;

            return (
              <div key={type.type} className="flex items-start justify-between py-3 border-b last:border-0">
                <div className="space-y-0.5 flex-1">
                  <Label htmlFor={type.type} className="text-base font-medium cursor-pointer">
                    {type.label}
                  </Label>
                  <p className="text-sm text-muted-foreground">{type.description}</p>
                </div>
                <Switch
                  id={type.type}
                  checked={setting.enabled}
                  onCheckedChange={() => toggleNotification(type.type)}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Quiet Hours */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Quiet Hours
          </CardTitle>
          <CardDescription>
            Suppress notifications during specific hours (e.g., while sleeping)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="quiet-hours-toggle" className="text-base font-medium cursor-pointer">
              Enable quiet hours
            </Label>
            <Switch
              id="quiet-hours-toggle"
              checked={globalQuietHours.enabled}
              onCheckedChange={toggleGlobalQuietHours}
            />
          </div>

          {globalQuietHours.enabled && (
            <div className="grid grid-cols-2 gap-4 pt-2">
              <div className="space-y-2">
                <Label htmlFor="quiet-start">Start time</Label>
                <Input
                  id="quiet-start"
                  type="time"
                  value={globalQuietHours.start}
                  onChange={(e) => updateQuietHours('start', e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quiet-end">End time</Label>
                <Input
                  id="quiet-end"
                  type="time"
                  value={globalQuietHours.end}
                  onChange={(e) => updateQuietHours('end', e.target.value)}
                />
              </div>
            </div>
          )}

          {globalQuietHours.enabled && (
            <p className="text-xs text-muted-foreground">
              Notifications will be suppressed from {globalQuietHours.start} to {globalQuietHours.end}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={saveSettings} disabled={saving} size="lg">
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Save preferences
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
