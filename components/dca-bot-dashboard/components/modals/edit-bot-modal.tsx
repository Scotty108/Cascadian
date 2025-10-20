"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertTriangle, Save, X } from "lucide-react"
import type { DcaBot } from "../../types"
import { mockExchanges, mockAssets, mockFrequencies } from "../../data"
import { formatCurrency } from "../../utils"

interface EditBotModalProps {
  bot: DcaBot | null
  isOpen: boolean
  onClose: () => void
  onSave: (bot: DcaBot) => void
}

export function EditBotModal({ bot, isOpen, onClose, onSave }: EditBotModalProps) {
  const [formData, setFormData] = useState({
    name: "",
    asset: "",
    exchange: "",
    frequency: "",
    amount: 0,
    autoAdjust: false,
    priceLimit: false,
    notifications: true,
    autoReinvest: false,
    maxPrice: 0,
    minPrice: 0,
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (bot && isOpen) {
      setFormData({
        name: bot.name,
        asset: bot.asset,
        exchange: bot.exchange,
        frequency: bot.frequency,
        amount: bot.amount,
        autoAdjust: false,
        priceLimit: false,
        notifications: true,
        autoReinvest: false,
        maxPrice: 0,
        minPrice: 0,
      })
      setErrors({})
    }
  }, [bot, isOpen])

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    if (!formData.name.trim()) {
      newErrors.name = "Bot name is required"
    } else if (formData.name.length < 3) {
      newErrors.name = "Bot name must be at least 3 characters"
    }

    if (!formData.asset) {
      newErrors.asset = "Asset selection is required"
    }

    if (!formData.exchange) {
      newErrors.exchange = "Exchange selection is required"
    }

    if (!formData.frequency) {
      newErrors.frequency = "Frequency selection is required"
    }

    if (formData.amount <= 0) {
      newErrors.amount = "Amount must be greater than 0"
    } else if (formData.amount > 10000) {
      newErrors.amount = "Amount cannot exceed $10,000"
    }

    if (formData.priceLimit) {
      if (formData.maxPrice <= 0) {
        newErrors.maxPrice = "Maximum price must be greater than 0"
      }
      if (formData.minPrice <= 0) {
        newErrors.minPrice = "Minimum price must be greater than 0"
      }
      if (formData.minPrice >= formData.maxPrice) {
        newErrors.minPrice = "Minimum price must be less than maximum price"
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSave = async () => {
    if (!validateForm() || !bot) return

    setIsLoading(true)
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const updatedBot: DcaBot = {
        ...bot,
        name: formData.name,
        asset: formData.asset,
        exchange: formData.exchange,
        frequency: formData.frequency,
        amount: formData.amount,
      }

      onSave(updatedBot)
      onClose()
    } catch (error) {
      console.error("Failed to update bot:", error)
      setErrors({ general: "Failed to update bot. Please try again." })
    } finally {
      setIsLoading(false)
    }
  }

  const handleClose = () => {
    if (!isLoading) {
      setFormData({
        name: "",
        asset: "",
        exchange: "",
        frequency: "",
        amount: 0,
        autoAdjust: false,
        priceLimit: false,
        notifications: true,
        autoReinvest: false,
        maxPrice: 0,
        minPrice: 0,
      })
      setErrors({})
      onClose()
    }
  }

  if (!bot) return null

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">Edit DCA Bot: {bot.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {errors.general && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{errors.general}</AlertDescription>
            </Alert>
          )}

          {/* Basic Settings */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Basic Settings</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Bot Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Enter bot name"
                  className={errors.name ? "border-red-500" : ""}
                />
                {errors.name && <p className="text-sm text-red-500">{errors.name}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="asset">Asset *</Label>
                <Select
                  value={formData.asset}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, asset: value }))}
                >
                  <SelectTrigger className={errors.asset ? "border-red-500" : ""}>
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
                {errors.asset && <p className="text-sm text-red-500">{errors.asset}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="exchange">Exchange *</Label>
                <Select
                  value={formData.exchange}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, exchange: value }))}
                >
                  <SelectTrigger className={errors.exchange ? "border-red-500" : ""}>
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
                {errors.exchange && <p className="text-sm text-red-500">{errors.exchange}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="frequency">Frequency *</Label>
                <Select
                  value={formData.frequency}
                  onValueChange={(value) => setFormData((prev) => ({ ...prev, frequency: value }))}
                >
                  <SelectTrigger className={errors.frequency ? "border-red-500" : ""}>
                    <SelectValue placeholder="Select frequency" />
                  </SelectTrigger>
                  <SelectContent>
                    {mockFrequencies.map((freq) => (
                      <SelectItem key={freq.id} value={freq.name}>
                        {freq.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.frequency && <p className="text-sm text-red-500">{errors.frequency}</p>}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="amount">Investment Amount (USD) *</Label>
              <Input
                id="amount"
                type="number"
                value={formData.amount}
                onChange={(e) => setFormData((prev) => ({ ...prev, amount: Number.parseFloat(e.target.value) || 0 }))}
                placeholder="Enter amount"
                min="1"
                max="10000"
                step="0.01"
                className={errors.amount ? "border-red-500" : ""}
              />
              {errors.amount && <p className="text-sm text-red-500">{errors.amount}</p>}
              <p className="text-sm text-muted-foreground">Current value: {formatCurrency(formData.amount)}</p>
            </div>
          </div>

          <Separator />

          {/* Advanced Settings */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Advanced Settings</h3>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Auto-adjust Amount</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically adjust investment amount based on market conditions
                  </p>
                </div>
                <Switch
                  checked={formData.autoAdjust}
                  onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, autoAdjust: checked }))}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Price Limits</Label>
                  <p className="text-sm text-muted-foreground">Set minimum and maximum price limits for purchases</p>
                </div>
                <Switch
                  checked={formData.priceLimit}
                  onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, priceLimit: checked }))}
                />
              </div>

              {formData.priceLimit && (
                <div className="grid grid-cols-2 gap-4 ml-4 p-4 border rounded-lg">
                  <div className="space-y-2">
                    <Label htmlFor="minPrice">Minimum Price (USD)</Label>
                    <Input
                      id="minPrice"
                      type="number"
                      value={formData.minPrice}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, minPrice: Number.parseFloat(e.target.value) || 0 }))
                      }
                      placeholder="Min price"
                      min="0"
                      step="0.01"
                      className={errors.minPrice ? "border-red-500" : ""}
                    />
                    {errors.minPrice && <p className="text-sm text-red-500">{errors.minPrice}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maxPrice">Maximum Price (USD)</Label>
                    <Input
                      id="maxPrice"
                      type="number"
                      value={formData.maxPrice}
                      onChange={(e) =>
                        setFormData((prev) => ({ ...prev, maxPrice: Number.parseFloat(e.target.value) || 0 }))
                      }
                      placeholder="Max price"
                      min="0"
                      step="0.01"
                      className={errors.maxPrice ? "border-red-500" : ""}
                    />
                    {errors.maxPrice && <p className="text-sm text-red-500">{errors.maxPrice}</p>}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Notifications</Label>
                  <p className="text-sm text-muted-foreground">Receive notifications for bot activities</p>
                </div>
                <Switch
                  checked={formData.notifications}
                  onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, notifications: checked }))}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Auto-reinvest</Label>
                  <p className="text-sm text-muted-foreground">Automatically reinvest profits back into the strategy</p>
                </div>
                <Switch
                  checked={formData.autoReinvest}
                  onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, autoReinvest: checked }))}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            <X className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isLoading}>
            <Save className="h-4 w-4 mr-2" />
            {isLoading ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
