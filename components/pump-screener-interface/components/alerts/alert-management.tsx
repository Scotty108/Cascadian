"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, Edit, Mail, Monitor, Plus, Trash2, Volume2, VolumeX } from "lucide-react";
import { useState } from "react";

interface AlertRule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: {
    minPriceChange?: number;
    minVolumeChange?: number;
    maxRisk?: "low" | "medium" | "high" | "very high";
    symbols?: string[];
    exchanges?: string[];
    patternTypes?: string[];
  };
  notifications: {
    browser: boolean;
    sound: boolean;
    email: boolean;
  };
  createdAt: number;
}

interface AlertNotification {
  id: string;
  alertId: number;
  ruleId: string;
  message: string;
  timestamp: number;
  read: boolean;
  severity: "low" | "medium" | "high" | "critical";
}

interface AlertManagementProps {
  rules: AlertRule[];
  notifications: AlertNotification[];
  unreadCount: number;
  soundEnabled: boolean;
  browserNotificationsEnabled: boolean;
  onCreateRule: (rule: Omit<AlertRule, "id" | "createdAt">) => void;
  onUpdateRule: (ruleId: string, updates: Partial<AlertRule>) => void;
  onDeleteRule: (ruleId: string) => void;
  onToggleRule: (ruleId: string) => void;
  onMarkAsRead: (notificationId: string) => void;
  onMarkAllAsRead: () => void;
  onClearAllNotifications: () => void;
  onSetSoundEnabled: (enabled: boolean) => void;
  onRequestNotificationPermission: () => Promise<boolean>;
}

export function AlertManagement({
  rules,
  notifications,
  unreadCount,
  soundEnabled,
  browserNotificationsEnabled,
  onCreateRule,
  onUpdateRule,
  onDeleteRule,
  onToggleRule,
  onMarkAsRead,
  onMarkAllAsRead,
  onClearAllNotifications,
  onSetSoundEnabled,
  onRequestNotificationPermission,
}: AlertManagementProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [newRule, setNewRule] = useState({
    name: "",
    enabled: true,
    conditions: {
      minPriceChange: 5,
      minVolumeChange: 200,
      maxRisk: "high" as const,
      symbols: [] as string[],
      exchanges: [] as string[],
      patternTypes: [] as string[],
    },
    notifications: {
      browser: true,
      sound: true,
      email: false,
    },
  });

  const handleCreateRule = () => {
    if (!newRule.name.trim()) return;

    onCreateRule(newRule);
    setNewRule({
      name: "",
      enabled: true,
      conditions: {
        minPriceChange: 5,
        minVolumeChange: 200,
        maxRisk: "high",
        symbols: [],
        exchanges: [],
        patternTypes: [],
      },
      notifications: {
        browser: true,
        sound: true,
        email: false,
      },
    });
    setShowCreateDialog(false);
  };

  const handleUpdateRule = () => {
    if (!editingRule) return;

    onUpdateRule(editingRule.id, editingRule);
    setEditingRule(null);
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical":
        return "bg-red-500/20 text-red-600 border-red-500/30";
      case "high":
        return "bg-orange-500/20 text-orange-600 border-orange-500/30";
      case "medium":
        return "bg-yellow-500/20 text-yellow-600 border-yellow-500/30";
      default:
        return "bg-blue-500/20 text-blue-600 border-blue-500/30";
    }
  };

  const formatTimestamp = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Alert Management</h2>
          <p className="text-muted-foreground">Manage your pump detection alerts and notifications</p>
        </div>
        <div className="flex items-center flex-wrap gap-2">
          <Badge variant="outline" className="gap-1">
            <Bell className="h-3 w-3" />
            {unreadCount} unread
          </Badge>
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                New Alert Rule
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create Alert Rule</DialogTitle>
                <DialogDescription>Set up conditions to automatically detect pump opportunities</DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="rule-name">Rule Name</Label>
                  <Input id="rule-name" placeholder="e.g., High Volume Pumps" value={newRule.name} onChange={(e) => setNewRule((prev) => ({ ...prev, name: e.target.value }))} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Min Price Change (%)</Label>
                    <Input
                      type="number"
                      value={newRule.conditions.minPriceChange}
                      onChange={(e) =>
                        setNewRule((prev) => ({
                          ...prev,
                          conditions: { ...prev.conditions, minPriceChange: Number(e.target.value) },
                        }))
                      }
                    />
                  </div>
                  <div>
                    <Label>Min Volume Change (%)</Label>
                    <Input
                      type="number"
                      value={newRule.conditions.minVolumeChange}
                      onChange={(e) =>
                        setNewRule((prev) => ({
                          ...prev,
                          conditions: { ...prev.conditions, minVolumeChange: Number(e.target.value) },
                        }))
                      }
                    />
                  </div>
                </div>

                <div>
                  <Label>Max Risk Level</Label>
                  <Select
                    value={newRule.conditions.maxRisk}
                    onValueChange={(value: any) =>
                      setNewRule((prev) => ({
                        ...prev,
                        conditions: { ...prev.conditions, maxRisk: value },
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="very high">Very High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                <div>
                  <Label className="text-base font-medium">Notification Methods</Label>
                  <div className="space-y-3 mt-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Monitor className="h-4 w-4" />
                        <span>Browser Notifications</span>
                      </div>
                      <Switch
                        checked={newRule.notifications.browser}
                        onCheckedChange={(checked) =>
                          setNewRule((prev) => ({
                            ...prev,
                            notifications: { ...prev.notifications, browser: checked },
                          }))
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Volume2 className="h-4 w-4" />
                        <span>Sound Alerts</span>
                      </div>
                      <Switch
                        checked={newRule.notifications.sound}
                        onCheckedChange={(checked) =>
                          setNewRule((prev) => ({
                            ...prev,
                            notifications: { ...prev.notifications, sound: checked },
                          }))
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4" />
                        <span>Email Notifications</span>
                      </div>
                      <Switch
                        checked={newRule.notifications.email}
                        onCheckedChange={(checked) =>
                          setNewRule((prev) => ({
                            ...prev,
                            notifications: { ...prev.notifications, email: checked },
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleCreateRule} disabled={!newRule.name.trim()}>
                    Create Rule
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs defaultValue="rules" className="space-y-4">
        <div className="overflow-x-auto">
          <TabsList className="min-w-[400px]">
            <TabsTrigger value="rules">Alert Rules ({rules.length})</TabsTrigger>
            <TabsTrigger value="notifications">
              Notifications ({notifications.length})
              {unreadCount > 0 && (
                <Badge variant="destructive" className="ml-2 h-5 w-5 p-0 text-xs">
                  {unreadCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="rules" className="space-y-4">
          {rules.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Bell className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">No Alert Rules</h3>
                <p className="text-muted-foreground text-center mb-4">Create your first alert rule to get notified about pump opportunities</p>
                <Button onClick={() => setShowCreateDialog(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Alert Rule
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {rules.map((rule) => (
                <Card key={rule.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg">{rule.name}</CardTitle>
                        <CardDescription>Created {formatTimestamp(rule.createdAt)}</CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch checked={rule.enabled} onCheckedChange={() => onToggleRule(rule.id)} />
                        <Button variant="outline" size="sm" onClick={() => setEditingRule(rule)}>
                          <Edit className="h-3 w-3" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => onDeleteRule(rule.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {rule.conditions.minPriceChange && <Badge variant="outline">Price: +{rule.conditions.minPriceChange}%</Badge>}
                      {rule.conditions.minVolumeChange && <Badge variant="outline">Volume: +{rule.conditions.minVolumeChange}%</Badge>}
                      {rule.conditions.maxRisk && <Badge variant="outline">Max Risk: {rule.conditions.maxRisk}</Badge>}
                      <div className="flex items-center gap-1 ml-auto">
                        {rule.notifications.browser && <Monitor className="h-3 w-3" />}
                        {rule.notifications.sound && <Volume2 className="h-3 w-3" />}
                        {rule.notifications.email && <Mail className="h-3 w-3" />}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="notifications" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium">Recent Notifications</h3>
            <div className="flex gap-2">
              {unreadCount > 0 && (
                <Button variant="outline" size="sm" onClick={onMarkAllAsRead}>
                  Mark All Read
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={onClearAllNotifications}>
                Clear All
              </Button>
            </div>
          </div>

          <ScrollArea className="h-96">
            <div className="space-y-2">
              {notifications.length === 0 ? (
                <Card>
                  <CardContent className="flex flex-col items-center justify-center py-8">
                    <Bell className="h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-muted-foreground">No notifications yet</p>
                  </CardContent>
                </Card>
              ) : (
                notifications.map((notification) => (
                  <Card key={notification.id} className={`cursor-pointer transition-colors ${!notification.read ? "bg-muted/50" : ""}`} onClick={() => onMarkAsRead(notification.id)}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge className={getSeverityColor(notification.severity)}>{notification.severity}</Badge>
                            {!notification.read && <div className="h-2 w-2 bg-blue-500 rounded-full" />}
                          </div>
                          <p className="text-sm">{notification.message}</p>
                          <p className="text-xs text-muted-foreground mt-1">{formatTimestamp(notification.timestamp)}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Notification Settings</CardTitle>
              <CardDescription>Configure how you receive pump alerts</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                  <span>Sound Notifications</span>
                </div>
                <Switch checked={soundEnabled} onCheckedChange={onSetSoundEnabled} />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Monitor className="h-4 w-4" />
                  <span>Browser Notifications</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={browserNotificationsEnabled ? "default" : "secondary"}>{browserNotificationsEnabled ? "Enabled" : "Disabled"}</Badge>
                  {!browserNotificationsEnabled && (
                    <Button size="sm" onClick={onRequestNotificationPermission}>
                      Enable
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Rule Dialog */}
      {editingRule && (
        <Dialog open={!!editingRule} onOpenChange={() => setEditingRule(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit Alert Rule</DialogTitle>
              <DialogDescription>Modify the conditions and settings for this alert rule</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-rule-name">Rule Name</Label>
                <Input id="edit-rule-name" value={editingRule.name} onChange={(e) => setEditingRule((prev) => (prev ? { ...prev, name: e.target.value } : null))} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Min Price Change (%)</Label>
                  <Input
                    type="number"
                    value={editingRule.conditions.minPriceChange || ""}
                    onChange={(e) =>
                      setEditingRule((prev) =>
                        prev
                          ? {
                              ...prev,
                              conditions: { ...prev.conditions, minPriceChange: Number(e.target.value) || undefined },
                            }
                          : null
                      )
                    }
                  />
                </div>
                <div>
                  <Label>Min Volume Change (%)</Label>
                  <Input
                    type="number"
                    value={editingRule.conditions.minVolumeChange || ""}
                    onChange={(e) =>
                      setEditingRule((prev) =>
                        prev
                          ? {
                              ...prev,
                              conditions: { ...prev.conditions, minVolumeChange: Number(e.target.value) || undefined },
                            }
                          : null
                      )
                    }
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditingRule(null)}>
                  Cancel
                </Button>
                <Button onClick={handleUpdateRule}>Save Changes</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
