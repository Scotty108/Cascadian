"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Bell, Settings, Trash2 } from "lucide-react";
import { useState } from "react";
import type { Notification, NotificationState } from "../../types";
import { formatTimeAgo } from "../../utils";

interface NotificationCenterProps {
  notifications: NotificationState;
  onMarkRead: (id: number) => void;
  onClearAll: () => void;
  onUpdateSettings: (settings: Partial<NotificationState["settings"]>) => void;
}

export function NotificationCenter({ notifications, onMarkRead, onClearAll, onUpdateSettings }: NotificationCenterProps) {
  const [showSettings, setShowSettings] = useState(false);
  const unreadCount = notifications.alerts.filter((alert) => !alert.read).length;

  const getNotificationIcon = (type: Notification["type"]) => {
    switch (type) {
      case "success":
        return <div className="h-2 w-2 rounded-full bg-green-500" />;
      case "error":
        return <div className="h-2 w-2 rounded-full bg-red-500" />;
      case "warning":
        return <div className="h-2 w-2 rounded-full bg-yellow-500" />;
      case "harvest":
        return <div className="h-2 w-2 rounded-full bg-blue-500" />;
      default:
        return <div className="h-2 w-2 rounded-full bg-gray-500" />;
    }
  };

  const getNotificationColor = (type: Notification["type"]) => {
    switch (type) {
      case "success":
        return "border-l-green-500";
      case "error":
        return "border-l-red-500";
      case "warning":
        return "border-l-yellow-500";
      case "harvest":
        return "border-l-blue-500";
      default:
        return "border-l-gray-500";
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="relative">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <Badge variant="destructive" className="absolute -top-2 flex items-center justify-center -right-2 h-5 w-5 rounded-full p-0 text-xs">
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96">
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-medium">Notifications</h4>
            <div className="flex items-center space-x-2">
              <Button variant="ghost" size="sm" onClick={() => setShowSettings(!showSettings)}>
                <Settings className="h-4 w-4" />
              </Button>
              {notifications.alerts.length > 0 && (
                <Button variant="ghost" size="sm" onClick={onClearAll}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {showSettings && (
            <Card className="mb-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Notification Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="apy-changes" className="text-sm">
                    APY Changes
                  </Label>
                  <Switch id="apy-changes" checked={notifications.settings.apyChanges} onCheckedChange={(checked) => onUpdateSettings({ apyChanges: checked })} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="harvest-reminders" className="text-sm">
                    Harvest Reminders
                  </Label>
                  <Switch id="harvest-reminders" checked={notifications.settings.harvestReminders} onCheckedChange={(checked) => onUpdateSettings({ harvestReminders: checked })} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="risk-warnings" className="text-sm">
                    Risk Warnings
                  </Label>
                  <Switch id="risk-warnings" checked={notifications.settings.riskWarnings} onCheckedChange={(checked) => onUpdateSettings({ riskWarnings: checked })} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="new-opportunities" className="text-sm">
                    New Opportunities
                  </Label>
                  <Switch id="new-opportunities" checked={notifications.settings.newOpportunities} onCheckedChange={(checked) => onUpdateSettings({ newOpportunities: checked })} />
                </div>
              </CardContent>
            </Card>
          )}

          <ScrollArea className="h-80">
            {notifications.alerts.length === 0 ? (
              <div className="text-center py-8">
                <Bell className="mx-auto h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No notifications yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {notifications.alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`p-3 rounded-lg border-l-4 ${getNotificationColor(alert.type)} ${alert.read ? "bg-muted/50" : "bg-background"} cursor-pointer hover:bg-muted/50 transition-colors`}
                    onClick={() => onMarkRead(alert.id)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-2 flex-1">
                        {getNotificationIcon(alert.type)}
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${alert.read ? "text-muted-foreground" : ""}`}>{alert.title}</p>
                          <p className={`text-xs ${alert.read ? "text-muted-foreground" : "text-muted-foreground"}`}>{alert.message}</p>
                          <p className="text-xs text-muted-foreground mt-1">{formatTimeAgo(alert.timestamp)}</p>
                        </div>
                      </div>
                      {!alert.read && <div className="h-2 w-2 rounded-full bg-blue-500 flex-shrink-0" />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
