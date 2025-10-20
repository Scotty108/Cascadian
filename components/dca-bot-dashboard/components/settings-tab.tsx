"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, Plus, X } from "lucide-react";
import { mockAssets, mockExchanges, mockFrequencies } from "../data";
import type { DcaBotFormData, DcaSettings } from "../types";
import { formatCurrency } from "../utils";

interface SettingsTabProps {
  isCreatingBot: boolean;
  formData: DcaBotFormData;
  settings: DcaSettings;
  onUpdateFormData: (updates: Partial<DcaBotFormData>) => void;
  onUpdateSettings: (updates: Partial<DcaSettings>) => void;
  onSaveBot: () => void;
  onCancelCreate: () => void;
}

export function SettingsTab({ isCreatingBot, formData, settings, onUpdateFormData, onUpdateSettings, onSaveBot, onCancelCreate }: SettingsTabProps) {
  const isFormValid = formData.name && formData.asset && formData.exchange && formData.frequency && formData.amount > 0;

  if (isCreatingBot) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Create New DCA Bot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Basic Configuration */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Basic Configuration</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="botName">Bot Name *</Label>
                  <Input id="botName" value={formData.name} onChange={(e) => onUpdateFormData({ name: e.target.value })} placeholder="Enter bot name" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="asset">Asset *</Label>
                  <Select value={formData.asset} onValueChange={(value) => onUpdateFormData({ asset: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select asset" />
                    </SelectTrigger>
                    <SelectContent>
                      {mockAssets.map((asset) => (
                        <SelectItem key={asset.id} value={asset.symbol}>
                          <div className="flex items-center gap-2">
                            <span>{asset.symbol}</span>
                            <span className="text-muted-foreground">- {asset.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="exchange">Exchange *</Label>
                  <Select value={formData.exchange} onValueChange={(value) => onUpdateFormData({ exchange: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select exchange" />
                    </SelectTrigger>
                    <SelectContent>
                      {mockExchanges.map((exchange) => (
                        <SelectItem key={exchange.id} value={exchange.id}>
                          {exchange.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="frequency">Frequency *</Label>
                  <Select value={formData.frequency} onValueChange={(value) => onUpdateFormData({ frequency: value })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select frequency" />
                    </SelectTrigger>
                    <SelectContent>
                      {mockFrequencies.map((freq) => (
                        <SelectItem key={freq.id} value={freq.id}>
                          {freq.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="amount">Investment Amount (USD) *</Label>
                <Input
                  id="amount"
                  type="number"
                  value={formData.amount}
                  onChange={(e) => onUpdateFormData({ amount: Number.parseFloat(e.target.value) || 0 })}
                  placeholder="Enter amount"
                  min="1"
                  max="10000"
                  step="0.01"
                />
                <p className="text-sm text-muted-foreground">Current value: {formatCurrency(formData.amount)}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="startDate">Start Date</Label>
                <Input id="startDate" type="date" value={formData.startDate} onChange={(e) => onUpdateFormData({ startDate: e.target.value })} min={new Date().toISOString().split("T")[0]} />
              </div>
            </div>

            <Separator />

            {/* Advanced Options */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Advanced Options</h3>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Auto-adjust Amount</Label>
                    <p className="text-sm text-muted-foreground">Automatically adjust investment amount based on market conditions</p>
                  </div>
                  <Switch checked={formData.autoAdjust} onCheckedChange={(checked) => onUpdateFormData({ autoAdjust: checked })} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Price Limits</Label>
                    <p className="text-sm text-muted-foreground">Only purchase when price is within specified range</p>
                  </div>
                  <Switch checked={formData.priceLimit} onCheckedChange={(checked) => onUpdateFormData({ priceLimit: checked })} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Notifications</Label>
                    <p className="text-sm text-muted-foreground">Receive notifications for this bot&apos;s activities</p>
                  </div>
                  <Switch checked={formData.notifications} onCheckedChange={(checked) => onUpdateFormData({ notifications: checked })} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Auto-reinvest</Label>
                    <p className="text-sm text-muted-foreground">Automatically reinvest profits back into the strategy</p>
                  </div>
                  <Switch checked={formData.autoReinvest} onCheckedChange={(checked) => onUpdateFormData({ autoReinvest: checked })} />
                </div>
              </div>
            </div>

            {!isFormValid && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>Please fill in all required fields before creating the bot.</AlertDescription>
              </Alert>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onCancelCreate}>
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button onClick={onSaveBot} disabled={!isFormValid}>
                <Plus className="h-4 w-4 mr-2" />
                Create Bot
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Default Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Default Bot Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="defaultExchange">Default Exchange</Label>
              <Select value={settings.defaultExchange} onValueChange={(value) => onUpdateSettings({ defaultExchange: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {mockExchanges.map((exchange) => (
                    <SelectItem key={exchange.id} value={exchange.id}>
                      {exchange.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="defaultFrequency">Default Frequency</Label>
              <Select value={settings.defaultFrequency} onValueChange={(value) => onUpdateSettings({ defaultFrequency: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {mockFrequencies.map((freq) => (
                    <SelectItem key={freq.id} value={freq.id}>
                      {freq.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="defaultAmount">Default Amount (USD)</Label>
              <Input
                id="defaultAmount"
                type="number"
                value={settings.defaultAmount}
                onChange={(e) => onUpdateSettings({ defaultAmount: Number.parseFloat(e.target.value) || 0 })}
                min="1"
                max="10000"
                step="0.01"
              />
              <p className="text-sm text-muted-foreground">{formatCurrency(settings.defaultAmount)}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxDailySpend">Max Daily Spend (USD)</Label>
              <Input
                id="maxDailySpend"
                type="number"
                value={settings.maxDailySpend}
                onChange={(e) => onUpdateSettings({ maxDailySpend: Number.parseFloat(e.target.value) || 0 })}
                min="1"
                max="50000"
                step="0.01"
              />
              <p className="text-sm text-muted-foreground">{formatCurrency(settings.maxDailySpend)}</p>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Auto-start New Bots</Label>
              <p className="text-sm text-muted-foreground">Automatically start new bots after creation</p>
            </div>
            <Switch checked={settings.autoStart} onCheckedChange={(checked) => onUpdateSettings({ autoStart: checked })} />
          </div>
        </CardContent>
      </Card>

      {/* Notification Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Notification Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Email Notifications</Label>
              <p className="text-sm text-muted-foreground">Receive email notifications for bot activities</p>
            </div>
            <Switch checked={settings.emailNotifications} onCheckedChange={(checked) => onUpdateSettings({ emailNotifications: checked })} />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Push Notifications</Label>
              <p className="text-sm text-muted-foreground">Receive push notifications on your device</p>
            </div>
            <Switch checked={settings.pushNotifications} onCheckedChange={(checked) => onUpdateSettings({ pushNotifications: checked })} />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Telegram Notifications</Label>
              <p className="text-sm text-muted-foreground">Receive notifications via Telegram bot</p>
            </div>
            <Switch checked={settings.telegramNotifications} onCheckedChange={(checked) => onUpdateSettings({ telegramNotifications: checked })} />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Weekly Summary</Label>
              <p className="text-sm text-muted-foreground">Receive weekly performance summaries</p>
            </div>
            <Switch checked={settings.weeklySummary} onCheckedChange={(checked) => onUpdateSettings({ weeklySummary: checked })} />
          </div>
        </CardContent>
      </Card>

      {/* Security Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Security Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Trade Confirmation</Label>
              <p className="text-sm text-muted-foreground">Require confirmation before executing trades</p>
            </div>
            <Switch checked={settings.confirmation} onCheckedChange={(checked) => onUpdateSettings({ confirmation: checked })} />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Two-Factor Authentication</Label>
              <p className="text-sm text-muted-foreground">Enable 2FA for additional security</p>
            </div>
            <Switch checked={settings.twoFactor} onCheckedChange={(checked) => onUpdateSettings({ twoFactor: checked })} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
