"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { WatchlistItem } from "../../types"

interface EditWatchlistModalProps {
  isOpen: boolean
  onClose: () => void
  item: WatchlistItem | null
  onSave: (updatedItem: WatchlistItem) => void
}

export function EditWatchlistModal({ isOpen, onClose, item, onSave }: EditWatchlistModalProps) {
  const [formData, setFormData] = useState<WatchlistItem>({
    symbol: item?.symbol || "",
    exchange: item?.exchange || "",
    alert: item?.alert || false,
    notes: item?.notes || "",
  })

  const handleSave = () => {
    onSave(formData)
    onClose()
  }

  const exchanges = ["Binance", "Coinbase", "Kraken", "KuCoin", "Bybit", "OKX", "Gate.io"]

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Watchlist Item</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="symbol">Symbol</Label>
            <Input
              id="symbol"
              value={formData.symbol}
              onChange={(e) => setFormData({ ...formData, symbol: e.target.value })}
              placeholder="e.g., BTC/USDT"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="exchange">Exchange</Label>
            <Select value={formData.exchange} onValueChange={(value) => setFormData({ ...formData, exchange: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Select exchange" />
              </SelectTrigger>
              <SelectContent>
                {exchanges.map((exchange) => (
                  <SelectItem key={exchange} value={exchange}>
                    {exchange}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="alert">Enable Alerts</Label>
            <Switch
              id="alert"
              checked={formData.alert}
              onCheckedChange={(checked) => setFormData({ ...formData, alert: checked })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Add your notes here..."
              rows={3}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Changes</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
