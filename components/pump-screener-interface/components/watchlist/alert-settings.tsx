"use client"

import { Bell, Volume2, Mail, Smartphone } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"

export function AlertSettings() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Alert Settings
        </CardTitle>
        <CardDescription>Configure how you receive pump notifications</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Notification Methods */}
        <div className="space-y-4">
          <h4 className="font-medium">Notification Methods</h4>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              <Label htmlFor="browser-notifications">Browser Notifications</Label>
            </div>
            <Switch id="browser-notifications" />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Volume2 className="h-4 w-4" />
              <Label htmlFor="sound-alerts">Sound Alerts</Label>
            </div>
            <Switch id="sound-alerts" />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              <Label htmlFor="email-notifications">Email Notifications</Label>
            </div>
            <Switch id="email-notifications" />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Smartphone className="h-4 w-4" />
              <Label htmlFor="push-notifications">Push Notifications</Label>
            </div>
            <Switch id="push-notifications" />
          </div>
        </div>

        <Separator />

        {/* Alert Thresholds */}
        <div className="space-y-4">
          <h4 className="font-medium">Alert Thresholds</h4>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="min-price-change">Min Price Change (%)</Label>
              <Input id="min-price-change" type="number" placeholder="5" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="min-volume-change">Min Volume Change (%)</Label>
              <Input id="min-volume-change" type="number" placeholder="200" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="max-risk-level">Maximum Risk Level</Label>
            <Select>
              <SelectTrigger>
                <SelectValue placeholder="Select risk level" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="very-high">Very High</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Separator />

        {/* Frequency Settings */}
        <div className="space-y-4">
          <h4 className="font-medium">Frequency Settings</h4>

          <div className="space-y-2">
            <Label htmlFor="alert-frequency">Alert Frequency</Label>
            <Select>
              <SelectTrigger>
                <SelectValue placeholder="Select frequency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="immediate">Immediate</SelectItem>
                <SelectItem value="5min">Every 5 minutes</SelectItem>
                <SelectItem value="15min">Every 15 minutes</SelectItem>
                <SelectItem value="30min">Every 30 minutes</SelectItem>
                <SelectItem value="1hour">Every hour</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="quiet-hours">Quiet Hours (9 PM - 7 AM)</Label>
            <Switch id="quiet-hours" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
