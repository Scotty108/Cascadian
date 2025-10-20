"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, CheckCircle, Edit, Plus, RefreshCw, Save, Trash2, Wifi, XCircle } from "lucide-react";
import { useActionState, useOptimistic, useState } from "react";
import type { BotData, Exchange } from "../types";

interface SettingsSectionProps {
  botData: BotData;
  onSettingsChange: (settings: any) => void;
}

// Server Action for saving settings
async function saveSettingsAction(prevState: any, formData: FormData) {
  await new Promise((resolve) => setTimeout(resolve, 500));

  const settings = {
    botName: formData.get("botName") as string,
    autoStart: formData.get("autoStart") === "on",
    notifications: formData.get("notifications") === "on",
    logLevel: formData.get("logLevel") as string,
    maxConcurrentTrades: Number(formData.get("maxConcurrentTrades")),
    tradingHours: {
      enabled: formData.get("tradingHoursEnabled") === "on",
      start: formData.get("tradingHoursStart") as string,
      end: formData.get("tradingHoursEnd") as string,
    },
  };

  return {
    success: true,
    settings,
  };
}

// Server Action for adding exchange
async function addExchangeAction(prevState: any, formData: FormData) {
  await new Promise((resolve) => setTimeout(resolve, 500));

  const exchange = {
    name: formData.get("exchangeName") as string,
    apiKey: formData.get("apiKey") as string,
    secretKey: formData.get("secretKey") as string,
    passphrase: formData.get("passphrase") as string,
    sandbox: formData.get("sandbox") === "on",
  };

  if (!exchange.name || !exchange.apiKey || !exchange.secretKey) {
    return {
      success: false,
      settings: prevState.settings,
      error: "Please fill in all required fields",
    };
  }

  return {
    success: true,
    settings: {
      ...prevState.settings,
      exchanges: [...(prevState.settings.exchanges || []), exchange],
    },
  };
}

export function SettingsSection({ botData, onSettingsChange }: SettingsSectionProps) {
  const [generalSettings, setGeneralSettings] = useState({
    botName: botData.name,
    autoStart: true,
    notifications: true,
    logLevel: "info",
    maxConcurrentTrades: 5,
    tradingHours: {
      enabled: false,
      start: "09:00",
      end: "17:00",
    },
  });

  const [apiSettings, setApiSettings] = useState({
    exchanges: botData.exchanges,
  });

  const [notificationSettings, setNotificationSettings] = useState({
    email: true,
    push: true,
    discord: false,
    telegram: false,
    tradeAlerts: true,
    profitAlerts: true,
    lossAlerts: true,
    systemAlerts: true,
  });

  const [showAddExchange, setShowAddExchange] = useState(false);

  // React 19 useActionState for settings
  const [settingsState, settingsAction, isSettingsPending] = useActionState(saveSettingsAction, {
    success: false,
    settings: generalSettings,
  });
  const [exchangeState, exchangeAction, isExchangePending] = useActionState(addExchangeAction, {
    success: false,
    settings: apiSettings,
  });

  // Optimistic updates for settings
  const [optimisticSettings, setOptimisticSettings] = useOptimistic(generalSettings, (currentSettings, newSettings: typeof generalSettings) => ({ ...currentSettings, ...newSettings }));

  const handleGeneralSettingChange = (key: string, value: any) => {
    const newSettings = { ...generalSettings, [key]: value };
    setGeneralSettings(newSettings);
    setOptimisticSettings(newSettings);
  };

  const handleNotificationSettingChange = (key: string, value: boolean) => {
    setNotificationSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSettingsSubmit = async (formData: FormData) => {
    const result = await settingsAction(formData);
  };

  const handleExchangeSubmit = async (formData: FormData) => {
    const result = await exchangeAction(formData);
  };

  const handleTestConnection = (exchangeId: string) => {
    console.log("Testing connection for:", exchangeId);
  };

  const handleRemoveExchange = (exchangeId: string) => {
    console.log("Removing exchange:", exchangeId);
  };

  const handleResetSettings = () => {
    console.log("Resetting settings to defaults");
  };

  const getConnectionStatus = (exchange: Exchange) => {
    if (exchange.connected) {
      return (
        <Badge className="bg-green-100 text-green-700">
          <CheckCircle className="w-3 h-3 mr-1" />
          Connected
        </Badge>
      );
    }
    return (
      <Badge variant="secondary">
        <XCircle className="w-3 h-3 mr-1" />
        Disconnected
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold">Bot Settings</h3>
          <p className="text-sm text-muted-foreground">Configure your AI trading bot parameters</p>
        </div>
        <div className="flex space-x-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">
                <RefreshCw className="w-4 h-4 mr-2" />
                Reset
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset Settings</AlertDialogTitle>
                <AlertDialogDescription>Are you sure you want to reset all settings to their default values? This action cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleResetSettings}>Reset</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList className="grid grid-cols-4 lg:w-[500px]">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="api">API Keys</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="advanced">Advanced</TabsTrigger>
        </TabsList>

        {/* General Settings Tab */}
        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>General Configuration</CardTitle>
              <CardDescription>Basic bot settings and preferences</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={handleSettingsSubmit} className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="botName">Bot Name</Label>
                    <Input id="botName" name="botName" value={optimisticSettings.botName} onChange={(e) => handleGeneralSettingChange("botName", e.target.value)} placeholder="Enter bot name" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="logLevel">Log Level</Label>
                    <Select name="logLevel" value={optimisticSettings.logLevel} onValueChange={(value) => handleGeneralSettingChange("logLevel", value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="debug">Debug</SelectItem>
                        <SelectItem value="info">Info</SelectItem>
                        <SelectItem value="warn">Warning</SelectItem>
                        <SelectItem value="error">Error</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Auto Start Bot</Label>
                      <p className="text-sm text-muted-foreground">Automatically start the bot when the application launches</p>
                    </div>
                    <Switch name="autoStart" checked={optimisticSettings.autoStart} onCheckedChange={(checked) => handleGeneralSettingChange("autoStart", checked)} />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Enable Notifications</Label>
                      <p className="text-sm text-muted-foreground">Receive notifications for trades and alerts</p>
                    </div>
                    <Switch name="notifications" checked={optimisticSettings.notifications} onCheckedChange={(checked) => handleGeneralSettingChange("notifications", checked)} />
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Trading Hours</Label>
                      <p className="text-sm text-muted-foreground">Limit trading to specific hours</p>
                    </div>
                    <Switch
                      name="tradingHoursEnabled"
                      checked={optimisticSettings.tradingHours.enabled}
                      onCheckedChange={(checked) =>
                        handleGeneralSettingChange("tradingHours", {
                          ...optimisticSettings.tradingHours,
                          enabled: checked,
                        })
                      }
                    />
                  </div>

                  {optimisticSettings.tradingHours.enabled && (
                    <div className="grid gap-4 md:grid-cols-2 ml-6">
                      <div className="space-y-2">
                        <Label>Start Time</Label>
                        <Input
                          name="tradingHoursStart"
                          type="time"
                          value={optimisticSettings.tradingHours.start}
                          onChange={(e) =>
                            handleGeneralSettingChange("tradingHours", {
                              ...optimisticSettings.tradingHours,
                              start: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>End Time</Label>
                        <Input
                          name="tradingHoursEnd"
                          type="time"
                          value={optimisticSettings.tradingHours.end}
                          onChange={(e) =>
                            handleGeneralSettingChange("tradingHours", {
                              ...optimisticSettings.tradingHours,
                              end: e.target.value,
                            })
                          }
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Max Concurrent Trades: {optimisticSettings.maxConcurrentTrades}</Label>
                  <Slider
                    value={[optimisticSettings.maxConcurrentTrades]}
                    onValueChange={([value]) => handleGeneralSettingChange("maxConcurrentTrades", value)}
                    max={20}
                    min={1}
                    step={1}
                    className="w-full"
                  />
                  <input type="hidden" name="maxConcurrentTrades" value={optimisticSettings.maxConcurrentTrades} />
                  <p className="text-xs text-muted-foreground">Maximum number of trades that can run simultaneously</p>
                </div>

                <Button type="submit" disabled={isSettingsPending}>
                  <Save className="w-4 h-4 mr-2" />
                  {isSettingsPending ? "Saving..." : "Save Changes"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* API Keys Tab */}
        <TabsContent value="api" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h4 className="text-base font-semibold">Exchange Connections</h4>
              <p className="text-sm text-muted-foreground">Manage your exchange API keys and connections</p>
            </div>
            <Dialog open={showAddExchange} onOpenChange={setShowAddExchange}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Exchange
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[525px]">
                <DialogHeader>
                  <DialogTitle>Add Exchange</DialogTitle>
                  <DialogDescription>Connect a new exchange by providing your API credentials.</DialogDescription>
                </DialogHeader>
                <form action={handleExchangeSubmit}>
                  <div className="grid gap-4 py-4">
                    {exchangeState?.error && <div className="text-sm text-red-600">{exchangeState.error}</div>}

                    <div className="space-y-2">
                      <Label htmlFor="exchangeName">Exchange</Label>
                      <Select name="exchangeName">
                        <SelectTrigger>
                          <SelectValue placeholder="Select exchange" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="binance">Binance</SelectItem>
                          <SelectItem value="coinbase">Coinbase Pro</SelectItem>
                          <SelectItem value="kraken">Kraken</SelectItem>
                          <SelectItem value="bybit">Bybit</SelectItem>
                          <SelectItem value="okx">OKX</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="apiKey">API Key</Label>
                      <Input id="apiKey" name="apiKey" type="password" placeholder="Enter API key" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="secretKey">Secret Key</Label>
                      <Input id="secretKey" name="secretKey" type="password" placeholder="Enter secret key" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="passphrase">Passphrase (if required)</Label>
                      <Input id="passphrase" name="passphrase" type="password" placeholder="Enter passphrase" />
                    </div>
                    <div className="flex items-center space-x-2">
                      <Switch name="sandbox" />
                      <Label>Use Sandbox/Testnet</Label>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setShowAddExchange(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={isExchangePending}>
                      {isExchangePending ? "Adding..." : "Add Exchange"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>

          <div className="grid gap-4">
            {apiSettings.exchanges.map((exchange) => (
              <Card key={exchange.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-base capitalize">{exchange.name}</CardTitle>
                      <CardDescription>Last sync: {exchange.lastSync ? new Date(exchange.lastSync).toLocaleString() : "Never"}</CardDescription>
                    </div>
                    <div className="flex items-center space-x-2">{getConnectionStatus(exchange)}</div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">API Status</p>
                      <p className="text-sm text-muted-foreground">{exchange.apiKeyStatus}</p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button variant="outline" size="sm" onClick={() => handleTestConnection(exchange.id)}>
                        <Wifi className="w-4 h-4 mr-1" />
                        Test
                      </Button>
                      <Button variant="outline" size="sm">
                        <Edit className="w-4 h-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Remove Exchange</AlertDialogTitle>
                            <AlertDialogDescription>Are you sure you want to remove this exchange connection? This will stop all trading on {exchange.name}.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleRemoveExchange(exchange.id)}>Remove</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="border-yellow-200 bg-yellow-50">
            <CardContent className="pt-6">
              <div className="flex items-start space-x-3">
                <AlertTriangle className="w-5 h-5 text-yellow-600 mt-0.5" />
                <div>
                  <h4 className="text-sm font-medium text-yellow-800">Security Notice</h4>
                  <p className="text-sm text-yellow-700 mt-1">Never share your API keys with anyone. Ensure your API keys have only the necessary permissions for trading.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Notification Preferences</CardTitle>
              <CardDescription>Configure how and when you receive notifications</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <h4 className="text-sm font-medium">Notification Channels</h4>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Email Notifications</Label>
                    <p className="text-sm text-muted-foreground">Receive notifications via email</p>
                  </div>
                  <Switch checked={notificationSettings.email} onCheckedChange={(checked) => handleNotificationSettingChange("email", checked)} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Push Notifications</Label>
                    <p className="text-sm text-muted-foreground">Browser push notifications</p>
                  </div>
                  <Switch checked={notificationSettings.push} onCheckedChange={(checked) => handleNotificationSettingChange("push", checked)} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Discord Webhook</Label>
                    <p className="text-sm text-muted-foreground">Send notifications to Discord channel</p>
                  </div>
                  <Switch checked={notificationSettings.discord} onCheckedChange={(checked) => handleNotificationSettingChange("discord", checked)} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Telegram Bot</Label>
                    <p className="text-sm text-muted-foreground">Send notifications via Telegram</p>
                  </div>
                  <Switch checked={notificationSettings.telegram} onCheckedChange={(checked) => handleNotificationSettingChange("telegram", checked)} />
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <h4 className="text-sm font-medium">Alert Types</h4>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Trade Alerts</Label>
                    <p className="text-sm text-muted-foreground">Notifications for buy/sell orders</p>
                  </div>
                  <Switch checked={notificationSettings.tradeAlerts} onCheckedChange={(checked) => handleNotificationSettingChange("tradeAlerts", checked)} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Profit Alerts</Label>
                    <p className="text-sm text-muted-foreground">Notifications for profitable trades</p>
                  </div>
                  <Switch checked={notificationSettings.profitAlerts} onCheckedChange={(checked) => handleNotificationSettingChange("profitAlerts", checked)} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Loss Alerts</Label>
                    <p className="text-sm text-muted-foreground">Notifications for losing trades</p>
                  </div>
                  <Switch checked={notificationSettings.lossAlerts} onCheckedChange={(checked) => handleNotificationSettingChange("lossAlerts", checked)} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>System Alerts</Label>
                    <p className="text-sm text-muted-foreground">Bot status and system notifications</p>
                  </div>
                  <Switch checked={notificationSettings.systemAlerts} onCheckedChange={(checked) => handleNotificationSettingChange("systemAlerts", checked)} />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Advanced Tab */}
        <TabsContent value="advanced" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Performance Settings</CardTitle>
              <CardDescription>Configure system performance and resource allocation</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Memory Limit (MB): {optimisticSettings.maxConcurrentTrades * 100}</Label>
                  <Slider
                    value={[optimisticSettings.maxConcurrentTrades * 100]}
                    onValueChange={([value]) => handleGeneralSettingChange("memoryLimit", value)}
                    max={2048}
                    min={256}
                    step={128}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">Maximum memory allocation for the bot process</p>
                </div>

                <div className="space-y-2">
                  <Label>CPU Threads: {Math.min(optimisticSettings.maxConcurrentTrades, 8)}</Label>
                  <Slider
                    value={[Math.min(optimisticSettings.maxConcurrentTrades, 8)]}
                    onValueChange={([value]) => handleGeneralSettingChange("cpuThreads", value)}
                    max={16}
                    min={1}
                    step={1}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">Number of CPU threads for parallel processing</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>High Performance Mode</Label>
                    <p className="text-sm text-muted-foreground">Enable aggressive optimization for faster execution</p>
                  </div>
                  <Switch checked={optimisticSettings.autoStart} onCheckedChange={(checked) => handleGeneralSettingChange("highPerformance", checked)} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Parallel Order Processing</Label>
                    <p className="text-sm text-muted-foreground">Process multiple orders simultaneously</p>
                  </div>
                  <Switch checked={optimisticSettings.notifications} onCheckedChange={(checked) => handleGeneralSettingChange("parallelProcessing", checked)} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Database & Storage</CardTitle>
              <CardDescription>Configure data storage and backup settings</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="dbConnection">Database Connection</Label>
                  <Input id="dbConnection" type="password" placeholder="postgresql://user:pass@host:port/db" className="font-mono text-sm" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="backupInterval">Backup Interval</Label>
                  <Select defaultValue="daily">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hourly">Every Hour</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Auto Backup</Label>
                    <p className="text-sm text-muted-foreground">Automatically backup trading data and settings</p>
                  </div>
                  <Switch defaultChecked />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Compress Backups</Label>
                    <p className="text-sm text-muted-foreground">Use compression to reduce backup file size</p>
                  </div>
                  <Switch defaultChecked />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Cloud Sync</Label>
                    <p className="text-sm text-muted-foreground">Sync backups to cloud storage</p>
                  </div>
                  <Switch />
                </div>
              </div>

              <div className="flex space-x-2">
                <Button variant="outline" size="sm">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Test Connection
                </Button>
                <Button variant="outline" size="sm">
                  Create Backup Now
                </Button>
                <Button variant="outline" size="sm">
                  Restore from Backup
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Risk Management Overrides</CardTitle>
              <CardDescription>Advanced risk controls for experienced traders</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Max Drawdown Override (%): {optimisticSettings.maxConcurrentTrades * 2}</Label>
                  <Slider
                    value={[optimisticSettings.maxConcurrentTrades * 2]}
                    onValueChange={([value]) => handleGeneralSettingChange("maxDrawdown", value)}
                    max={50}
                    min={5}
                    step={1}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">Maximum allowed portfolio drawdown</p>
                </div>

                <div className="space-y-2">
                  <Label>Position Size Multiplier: {(optimisticSettings.maxConcurrentTrades / 10).toFixed(1)}x</Label>
                  <Slider
                    value={[optimisticSettings.maxConcurrentTrades / 10]}
                    onValueChange={([value]) => handleGeneralSettingChange("positionMultiplier", value)}
                    max={5}
                    min={0.1}
                    step={0.1}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">Multiply default position sizes</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Emergency Stop</Label>
                    <p className="text-sm text-muted-foreground">Enable emergency stop on significant losses</p>
                  </div>
                  <Switch defaultChecked />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Override Safety Limits</Label>
                    <p className="text-sm text-muted-foreground">Allow trading beyond normal safety parameters</p>
                  </div>
                  <Switch />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Debugging & Monitoring</CardTitle>
              <CardDescription>Advanced logging and system monitoring options</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="logRetention">Log Retention (days)</Label>
                  <Input id="logRetention" type="number" defaultValue="30" min="1" max="365" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="debugLevel">Debug Level</Label>
                  <Select defaultValue="info">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="trace">Trace</SelectItem>
                      <SelectItem value="debug">Debug</SelectItem>
                      <SelectItem value="info">Info</SelectItem>
                      <SelectItem value="warn">Warning</SelectItem>
                      <SelectItem value="error">Error</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Detailed Trade Logging</Label>
                    <p className="text-sm text-muted-foreground">Log detailed information for each trade</p>
                  </div>
                  <Switch />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Performance Metrics</Label>
                    <p className="text-sm text-muted-foreground">Collect detailed performance statistics</p>
                  </div>
                  <Switch defaultChecked />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Remote Monitoring</Label>
                    <p className="text-sm text-muted-foreground">Allow remote access to bot status</p>
                  </div>
                  <Switch />
                </div>
              </div>

              <div className="flex space-x-2">
                <Button variant="outline" size="sm">
                  View System Logs
                </Button>
                <Button variant="outline" size="sm">
                  Export Debug Info
                </Button>
                <Button variant="outline" size="sm">
                  Clear Cache
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Custom Scripts & Automation</CardTitle>
              <CardDescription>Configure custom trading scripts and automation</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Enable Custom Scripts</Label>
                    <p className="text-sm text-muted-foreground">Allow execution of custom trading algorithms</p>
                  </div>
                  <Switch />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Webhook Integration</Label>
                    <p className="text-sm text-muted-foreground">Enable webhook endpoints for external signals</p>
                  </div>
                  <Switch />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>API Rate Limiting</Label>
                    <p className="text-sm text-muted-foreground">Enforce API rate limits for custom scripts</p>
                  </div>
                  <Switch defaultChecked />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="webhookUrl">Webhook URL</Label>
                <Input id="webhookUrl" placeholder="https://your-webhook-endpoint.com/signals" className="font-mono text-sm" />
              </div>

              <div className="flex space-x-2">
                <Button variant="outline" size="sm">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Script
                </Button>
                <Button variant="outline" size="sm">
                  Test Webhook
                </Button>
                <Button variant="outline" size="sm">
                  View Script Logs
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-6">
              <div className="flex items-start space-x-3">
                <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5" />
                <div>
                  <h4 className="text-sm font-medium text-red-800">Advanced Settings Warning</h4>
                  <p className="text-sm text-red-700 mt-1">
                    These settings are intended for experienced users only. Incorrect configuration may result in trading losses or system instability. Always test changes in a sandbox environment
                    first.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
