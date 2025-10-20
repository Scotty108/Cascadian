"use client"

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Shield, Pause } from "lucide-react"
import type { NotificationSettings, TradingSettings } from "../types"

interface SettingsTabProps {
  notificationSettings: NotificationSettings
  tradingSettings: TradingSettings
  onUpdateNotification: (key: keyof NotificationSettings, value: boolean) => void
  onUpdateTrading: (key: keyof TradingSettings, value: any) => void
  onResetSettings: () => void
  onSaveSettings: () => void
}

export function SettingsTab({
  notificationSettings,
  tradingSettings,
  onUpdateNotification,
  onUpdateTrading,
  onResetSettings,
  onSaveSettings,
}: SettingsTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bot Settings</CardTitle>
        <CardDescription>Configure your signal bot settings</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <h3 className="text-lg font-medium">General Settings</h3>
          <Separator />
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="bot-name">Bot Name</Label>
              <Input
                id="bot-name"
                value={tradingSettings.botName}
                onChange={(e) => onUpdateTrading("botName", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bot-description">Description</Label>
              <Input
                id="bot-description"
                value={tradingSettings.description}
                onChange={(e) => onUpdateTrading("description", e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-medium">Trading Settings</h3>
          <Separator />
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="default-exchange">Default Exchange</Label>
              <Select
                value={tradingSettings.defaultExchange}
                onValueChange={(value) => onUpdateTrading("defaultExchange", value)}
              >
                <SelectTrigger id="default-exchange">
                  <SelectValue placeholder="Select exchange" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="binance">Binance</SelectItem>
                  <SelectItem value="coinbase">Coinbase</SelectItem>
                  <SelectItem value="kucoin">KuCoin</SelectItem>
                  <SelectItem value="ftx">FTX</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="default-pair">Default Trading Pair</Label>
              <Select
                value={tradingSettings.defaultPair}
                onValueChange={(value) => onUpdateTrading("defaultPair", value)}
              >
                <SelectTrigger id="default-pair">
                  <SelectValue placeholder="Select trading pair" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="btcusdt">BTC/USDT</SelectItem>
                  <SelectItem value="ethusdt">ETH/USDT</SelectItem>
                  <SelectItem value="bnbusdt">BNB/USDT</SelectItem>
                  <SelectItem value="adausdt">ADA/USDT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="position-size">Default Position Size</Label>
              <div className="flex">
                <Input
                  id="position-size"
                  type="number"
                  value={tradingSettings.positionSize}
                  onChange={(e) => onUpdateTrading("positionSize", Number(e.target.value))}
                  className="rounded-r-none"
                />
                <Select
                  value={tradingSettings.positionSizeType}
                  onValueChange={(value) => onUpdateTrading("positionSizeType", value)}
                >
                  <SelectTrigger className="w-[180px] rounded-l-none border-l-0">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">% of Portfolio</SelectItem>
                    <SelectItem value="fixed">Fixed Amount</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-positions">Maximum Open Positions</Label>
              <Input
                id="max-positions"
                type="number"
                value={tradingSettings.maxPositions}
                onChange={(e) => onUpdateTrading("maxPositions", Number(e.target.value))}
              />
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-medium">Notification Settings</h3>
          <Separator />
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="email-notifications">Email Notifications</Label>
                <p className="text-sm text-muted-foreground">Receive signal alerts via email</p>
              </div>
              <Switch
                id="email-notifications"
                checked={notificationSettings.email}
                onCheckedChange={(checked) => onUpdateNotification("email", checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="push-notifications">Push Notifications</Label>
                <p className="text-sm text-muted-foreground">Receive signal alerts via browser notifications</p>
              </div>
              <Switch
                id="push-notifications"
                checked={notificationSettings.push}
                onCheckedChange={(checked) => onUpdateNotification("push", checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="telegram-notifications">Telegram Notifications</Label>
                <p className="text-sm text-muted-foreground">Receive signal alerts via Telegram</p>
              </div>
              <Switch
                id="telegram-notifications"
                checked={notificationSettings.telegram}
                onCheckedChange={(checked) => onUpdateNotification("telegram", checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="discord-notifications">Discord Notifications</Label>
                <p className="text-sm text-muted-foreground">Receive signal alerts via Discord</p>
              </div>
              <Switch
                id="discord-notifications"
                checked={notificationSettings.discord}
                onCheckedChange={(checked) => onUpdateNotification("discord", checked)}
              />
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <h3 className="text-lg font-medium">Security Settings</h3>
          <Separator />
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="space-y-0.5">
                <Label>API Key Management</Label>
                <p className="text-sm text-muted-foreground">Manage your exchange API keys</p>
              </div>
              <Button variant="outline" className="gap-2">
                <Shield className="h-4 w-4" />
                <span>Manage Keys</span>
              </Button>
            </div>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="space-y-0.5">
                <Label htmlFor="max-daily-trades">Maximum Daily Trades</Label>
                <p className="text-sm text-muted-foreground">Limit the number of trades per day</p>
              </div>
              <Input
                id="max-daily-trades"
                type="number"
                value={tradingSettings.maxDailyTrades}
                onChange={(e) => onUpdateTrading("maxDailyTrades", Number(e.target.value))}
                className="w-24"
              />
            </div>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="space-y-0.5">
                <Label htmlFor="emergency-stop">Emergency Stop</Label>
                <p className="text-sm text-muted-foreground">Immediately stop all trading activity</p>
              </div>
              <Button variant="destructive" className="gap-2">
                <Pause className="h-4 w-4" />
                <span>Emergency Stop</span>
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 justify-between">
        <Button variant="outline" onClick={onResetSettings}>
          Reset to Default
        </Button>
        <Button onClick={onSaveSettings}>Save Settings</Button>
      </CardFooter>
    </Card>
  )
}
