'use client';

import { useState, useEffect } from 'react';
import { Bell, Check, CheckCheck, Trash2, Filter, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { NotificationRow, NotificationType } from '@/types/database';
import Link from 'next/link';

interface NotificationResponse {
  success: boolean;
  data: NotificationRow[];
  count: number;
}

export function NotificationsContent() {
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');

  // Fetch notifications
  const fetchNotifications = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();

      if (filter === 'unread') {
        params.append('is_read', 'false');
      }

      const response = await fetch(`/api/notifications?${params.toString()}`);
      const result: NotificationResponse = await response.json();

      if (result.success) {
        setNotifications(result.data);
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, [filter]);

  // Mark notification as read
  const markAsRead = async (id: number) => {
    try {
      const response = await fetch(`/api/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_read: true }),
      });

      if (response.ok) {
        fetchNotifications();
      }
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  // Mark all as read
  const markAllAsRead = async () => {
    try {
      const response = await fetch('/api/notifications/mark-all-read', {
        method: 'PATCH',
      });

      if (response.ok) {
        fetchNotifications();
      }
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  };

  // Archive notification
  const archiveNotification = async (id: number) => {
    try {
      const response = await fetch(`/api/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_archived: true }),
      });

      if (response.ok) {
        fetchNotifications();
      }
    } catch (error) {
      console.error('Failed to archive notification:', error);
    }
  };

  // Delete notification
  const deleteNotification = async (id: number) => {
    try {
      const response = await fetch(`/api/notifications/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchNotifications();
      }
    } catch (error) {
      console.error('Failed to delete notification:', error);
    }
  };

  // Get notification icon and color based on type
  const getNotificationStyle = (type: NotificationType, priority: string) => {
    const styles: Record<NotificationType, { icon: string; color: string }> = {
      whale_activity: { icon: '🐋', color: 'bg-blue-500/10 text-blue-500' },
      market_alert: { icon: '📊', color: 'bg-purple-500/10 text-purple-500' },
      insider_alert: { icon: '🎯', color: 'bg-red-500/10 text-red-500' },
      strategy_update: { icon: '⚡', color: 'bg-green-500/10 text-green-500' },
      system: { icon: '⚙️', color: 'bg-gray-500/10 text-gray-500' },
      security: { icon: '🔒', color: 'bg-orange-500/10 text-orange-500' },
      account: { icon: '👤', color: 'bg-cyan-500/10 text-cyan-500' },
    };

    return styles[type] || styles.system;
  };

  // Get priority badge
  const getPriorityBadge = (priority: string) => {
    const variants: Record<string, { variant: any; label: string }> = {
      urgent: { variant: 'destructive', label: 'Urgent' },
      high: { variant: 'default', label: 'High' },
      normal: { variant: 'secondary', label: '' },
      low: { variant: 'outline', label: '' },
    };

    const config = variants[priority] || variants.normal;

    return config.label ? (
      <Badge variant={config.variant} className="ml-2">
        {config.label}
      </Badge>
    ) : null;
  };

  // Format relative time
  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Bell className="h-8 w-8" />
            Notifications
          </h1>
          <p className="text-muted-foreground mt-1">
            Stay updated with market alerts and whale activity
          </p>
        </div>

        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={markAllAsRead}>
              <CheckCheck className="h-4 w-4 mr-2" />
              Mark all read
            </Button>
          )}
        </div>
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as 'all' | 'unread')} className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="all">
            All ({notifications.length})
          </TabsTrigger>
          <TabsTrigger value="unread">
            Unread ({unreadCount})
          </TabsTrigger>
        </TabsList>

        <TabsContent value={filter} className="mt-6 space-y-4">
          {loading ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                Loading notifications...
              </CardContent>
            </Card>
          ) : notifications.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center">
                <Bell className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No notifications</h3>
                <p className="text-muted-foreground">
                  {filter === 'unread'
                    ? "You're all caught up!"
                    : "You don't have any notifications yet."}
                </p>
              </CardContent>
            </Card>
          ) : (
            notifications.map((notification) => {
              const style = getNotificationStyle(notification.type, notification.priority);
              const NotificationWrapper = notification.link
                ? ({ children }: { children: React.ReactNode }) => (
                    <Link href={notification.link!} onClick={() => markAsRead(notification.id)}>
                      {children}
                    </Link>
                  )
                : ({ children }: { children: React.ReactNode }) => <>{children}</>;

              return (
                <Card
                  key={notification.id}
                  className={`transition-all hover:shadow-md ${
                    !notification.is_read ? 'border-l-4 border-l-primary bg-accent/30' : ''
                  }`}
                >
                  <NotificationWrapper>
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3 flex-1">
                          <div className={`p-2 rounded-lg ${style.color}`}>
                            <span className="text-xl">{style.icon}</span>
                          </div>
                          <div className="flex-1">
                            <CardTitle className="text-base font-semibold flex items-center">
                              {notification.title}
                              {getPriorityBadge(notification.priority)}
                              {!notification.is_read && (
                                <Badge variant="default" className="ml-2 bg-primary/20 text-primary">
                                  New
                                </Badge>
                              )}
                            </CardTitle>
                            <CardDescription className="mt-1">
                              {notification.message}
                            </CardDescription>
                            <p className="text-xs text-muted-foreground mt-2">
                              {notification.created_at ? formatRelativeTime(notification.created_at) : 'Unknown time'}
                            </p>
                          </div>
                        </div>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <Filter className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {!notification.is_read && (
                              <DropdownMenuItem onClick={() => markAsRead(notification.id)}>
                                <Check className="h-4 w-4 mr-2" />
                                Mark as read
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => archiveNotification(notification.id)}>
                              <Archive className="h-4 w-4 mr-2" />
                              Archive
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => deleteNotification(notification.id)}
                              className="text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CardHeader>
                  </NotificationWrapper>
                </Card>
              );
            })
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
