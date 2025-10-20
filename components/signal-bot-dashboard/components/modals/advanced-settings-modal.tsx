"use client"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import type { AdvancedSettings } from "../../types"

interface AdvancedSettingsModalProps {
  isOpen: boolean
  advancedSettings: AdvancedSettings
  onClose: () => void
  onSave: () => void
  onUpdateSetting: (key: keyof AdvancedSettings, value: any) => void
}

export function AdvancedSettingsModal({
  isOpen,
  advancedSettings,
  onClose,
  onSave,
  onUpdateSetting,
}: AdvancedSettingsModalProps) {
  const handleSave = () => {
    onSave()
    onClose()
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Advanced Auto-Trading Settings</DialogTitle>
          <DialogDescription>Configure advanced parameters for your auto-trading bot</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="position-size-percent">Position Size (%)</Label>
              <Input
                id="position-size-percent"
                type="number"
                value={advancedSettings.positionSizePercent}
                onChange={(e) => onUpdateSetting("positionSizePercent", Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">Percentage of portfolio per trade</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-concurrent">Max Concurrent Trades</Label>
              <Input
                id="max-concurrent"
                type="number"
                value={advancedSettings.maxConcurrent}
                onChange={(e) => onUpdateSetting("maxConcurrent", Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="stop-loss">Stop Loss (%)</Label>
              <Input
                id="stop-loss"
                type="number"
                value={advancedSettings.stopLoss}
                onChange={(e) => onUpdateSetting("stopLoss", Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="take-profit">Take Profit (%)</Label>
              <Input
                id="take-profit"
                type="number"
                value={advancedSettings.takeProfit}
                onChange={(e) => onUpdateSetting("takeProfit", Number(e.target.value))}
              />
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <h4 className="font-medium">Trading Options</h4>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="trailing-stop">Trailing Stop Loss</Label>
                <Switch
                  id="trailing-stop"
                  checked={advancedSettings.trailingStop}
                  onCheckedChange={(checked) => onUpdateSetting("trailingStop", checked)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="partial-close">Partial Position Closing</Label>
                <Switch
                  id="partial-close"
                  checked={advancedSettings.partialClose}
                  onCheckedChange={(checked) => onUpdateSetting("partialClose", checked)}
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="reinvest-profits">Reinvest Profits</Label>
                <Switch
                  id="reinvest-profits"
                  checked={advancedSettings.reinvestProfits}
                  onCheckedChange={(checked) => onUpdateSetting("reinvestProfits", checked)}
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Settings</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
