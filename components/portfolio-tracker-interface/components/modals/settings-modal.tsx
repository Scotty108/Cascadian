"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { useState } from "react";

export interface PortfolioSettings {
  currency: string;
  theme: string;
  compactView: boolean;
  showSmallBalances: boolean;
  hideZeroBalances: boolean;
  priceAlerts: boolean;
  portfolioAlerts: boolean;
  newsAlerts: boolean;
  emailNotifications: boolean;
  pushNotifications: boolean;
  hideBalances: boolean;
  anonymousMode: boolean;
  autoRefresh: boolean;
  refreshInterval: number;
  syncAcrossDevices: boolean;
  rpcEndpoints: Record<string, string>;
  customTokens: Array<{ address: string; symbol: string; name: string; decimals: number }>;
  priceChangeThreshold: number;
  portfolioChangeThreshold: number;
}

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: PortfolioSettings;
  onSettingsChange: (settings: PortfolioSettings) => void;
}

export function SettingsModal({ open, onOpenChange, settings, onSettingsChange }: SettingsModalProps) {
  const [localSettings, setLocalSettings] = useState<PortfolioSettings>(settings);

  const handleSave = () => {
    onSettingsChange(localSettings);
    toast({
      title: "Settings saved",
      description: "Your portfolio settings have been updated successfully.",
    });
    onOpenChange(false);
  };

  const updateSetting = <K extends keyof PortfolioSettings>(key: K, value: PortfolioSettings[K]) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Portfolio Settings</DialogTitle>
          <DialogDescription>Customize your portfolio tracker experience and preferences.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="display">
          <div className="overflow-x-auto">
            <TabsList className="min-w-[400px] justify-between ">
              <TabsTrigger value="display">Display</TabsTrigger>
              <TabsTrigger value="notifications">Notifications</TabsTrigger>
              <TabsTrigger value="privacy">Privacy</TabsTrigger>
              <TabsTrigger value="data">Data</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="display" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Display Preferences</CardTitle>
                <CardDescription>Customize how your portfolio is displayed</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="currency">Base Currency</Label>
                    <Select value={localSettings.currency} onValueChange={(value) => updateSetting("currency", value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USD">USD ($)</SelectItem>
                        <SelectItem value="EUR">EUR (€)</SelectItem>
                        <SelectItem value="GBP">GBP (£)</SelectItem>
                        <SelectItem value="BTC">BTC (₿)</SelectItem>
                        <SelectItem value="ETH">ETH (Ξ)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="theme">Theme</Label>
                    <Select value={localSettings.theme} onValueChange={(value) => updateSetting("theme", value)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="light">Light</SelectItem>
                        <SelectItem value="dark">Dark</SelectItem>
                        <SelectItem value="system">System</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Compact View</Label>
                      <p className="text-sm text-muted-foreground">Show more data in less space</p>
                    </div>
                    <Switch checked={localSettings.compactView} onCheckedChange={(checked) => updateSetting("compactView", checked)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Show Small Balances</Label>
                      <p className="text-sm text-muted-foreground">Display assets with small USD values</p>
                    </div>
                    <Switch checked={localSettings.showSmallBalances} onCheckedChange={(checked) => updateSetting("showSmallBalances", checked)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Hide Zero Balances</Label>
                      <p className="text-sm text-muted-foreground">Hide assets with zero balance</p>
                    </div>
                    <Switch checked={localSettings.hideZeroBalances} onCheckedChange={(checked) => updateSetting("hideZeroBalances", checked)} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notifications" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Alert Settings</CardTitle>
                <CardDescription>Configure when and how you receive notifications</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Price Alerts</Label>
                      <p className="text-sm text-muted-foreground">Get notified of significant price changes</p>
                    </div>
                    <Switch checked={localSettings.priceAlerts} onCheckedChange={(checked) => updateSetting("priceAlerts", checked)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Portfolio Alerts</Label>
                      <p className="text-sm text-muted-foreground">Get notified of portfolio value changes</p>
                    </div>
                    <Switch checked={localSettings.portfolioAlerts} onCheckedChange={(checked) => updateSetting("portfolioAlerts", checked)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>News Alerts</Label>
                      <p className="text-sm text-muted-foreground">Get notified of relevant crypto news</p>
                    </div>
                    <Switch checked={localSettings.newsAlerts} onCheckedChange={(checked) => updateSetting("newsAlerts", checked)} />
                  </div>
                </div>

                <Separator />

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="priceThreshold">Price Change Threshold (%)</Label>
                    <Input id="priceThreshold" type="number" value={localSettings.priceChangeThreshold} onChange={(e) => updateSetting("priceChangeThreshold", Number(e.target.value))} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="portfolioThreshold">Portfolio Change Threshold (%)</Label>
                    <Input id="portfolioThreshold" type="number" value={localSettings.portfolioChangeThreshold} onChange={(e) => updateSetting("portfolioChangeThreshold", Number(e.target.value))} />
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Email Notifications</Label>
                      <p className="text-sm text-muted-foreground">Receive alerts via email</p>
                    </div>
                    <Switch checked={localSettings.emailNotifications} onCheckedChange={(checked) => updateSetting("emailNotifications", checked)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Push Notifications</Label>
                      <p className="text-sm text-muted-foreground">Receive browser push notifications</p>
                    </div>
                    <Switch checked={localSettings.pushNotifications} onCheckedChange={(checked) => updateSetting("pushNotifications", checked)} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="privacy" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Privacy & Security</CardTitle>
                <CardDescription>Control your privacy and security settings</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Hide Balances</Label>
                      <p className="text-sm text-muted-foreground">Hide portfolio values by default</p>
                    </div>
                    <Switch checked={localSettings.hideBalances} onCheckedChange={(checked) => updateSetting("hideBalances", checked)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Anonymous Mode</Label>
                      <p className="text-sm text-muted-foreground">Don&apos;t track usage analytics</p>
                    </div>
                    <Switch checked={localSettings.anonymousMode} onCheckedChange={(checked) => updateSetting("anonymousMode", checked)} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="data" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Data Management</CardTitle>
                <CardDescription>Control how your data is synced and refreshed</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Auto Refresh</Label>
                      <p className="text-sm text-muted-foreground">Automatically refresh portfolio data</p>
                    </div>
                    <Switch checked={localSettings.autoRefresh} onCheckedChange={(checked) => updateSetting("autoRefresh", checked)} />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Sync Across Devices</Label>
                      <p className="text-sm text-muted-foreground">Keep settings synced across all devices</p>
                    </div>
                    <Switch checked={localSettings.syncAcrossDevices} onCheckedChange={(checked) => updateSetting("syncAcrossDevices", checked)} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="refreshInterval">Refresh Interval (seconds)</Label>
                  <Select value={localSettings.refreshInterval.toString()} onValueChange={(value) => updateSetting("refreshInterval", Number(value))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="15">15 seconds</SelectItem>
                      <SelectItem value="30">30 seconds</SelectItem>
                      <SelectItem value="60">1 minute</SelectItem>
                      <SelectItem value="300">5 minutes</SelectItem>
                      <SelectItem value="600">10 minutes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="advanced" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Advanced Settings</CardTitle>
                <CardDescription>Advanced configuration for power users</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>Custom RPC Endpoints</Label>
                  <p className="text-sm text-muted-foreground">Configure custom RPC endpoints for different networks</p>
                  <div className="space-y-2">
                    <Input placeholder="Ethereum RPC URL" />
                    <Input placeholder="Polygon RPC URL" />
                    <Input placeholder="BSC RPC URL" />
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label>Custom Tokens</Label>
                  <p className="text-sm text-muted-foreground">Add custom tokens not automatically detected</p>
                  <Button variant="outline" size="sm">
                    Add Custom Token
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end space-x-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Settings</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
