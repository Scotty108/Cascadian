"use client"

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface AdvancedSettingsModalProps {
  gasOption: string
  autocompoundEnabled: boolean
  onClose: () => void
  onGasOptionChange: (option: string) => void
  onAutocompoundChange: (enabled: boolean) => void
}

export function AdvancedSettingsModal({
  gasOption,
  autocompoundEnabled,
  onClose,
  onGasOptionChange,
  onAutocompoundChange,
}: AdvancedSettingsModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Advanced Settings</CardTitle>
          <CardDescription>Configure your yield farming preferences</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Default Gas Price Strategy</Label>
            <Select value={gasOption} onValueChange={onGasOptionChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select gas price strategy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="slow">Slow (Economical)</SelectItem>
                <SelectItem value="average">Average (Recommended)</SelectItem>
                <SelectItem value="fast">Fast (Urgent)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="auto-compound">Auto-compound by Default</Label>
              <Switch id="auto-compound" checked={autocompoundEnabled} onCheckedChange={onAutocompoundChange} />
            </div>
            <p className="text-xs text-muted-foreground">Automatically reinvest rewards to maximize yield</p>
          </div>

          <div className="space-y-2">
            <Label>Slippage Tolerance</Label>
            <div className="flex items-center space-x-2">
              <Input type="number" placeholder="0.5" defaultValue="0.5" className="w-20" />
              <span>%</span>
            </div>
            <p className="text-xs text-muted-foreground">Maximum price difference tolerated for transactions</p>
          </div>

          <div className="space-y-2">
            <Label>Transaction Deadline</Label>
            <div className="flex items-center space-x-2">
              <Input type="number" placeholder="20" defaultValue="20" className="w-20" />
              <span>minutes</span>
            </div>
            <p className="text-xs text-muted-foreground">Transaction will revert if pending for longer than this</p>
          </div>
        </CardContent>
        <CardFooter className="flex justify-between">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onClose}>Save Settings</Button>
        </CardFooter>
      </Card>
    </div>
  )
}
