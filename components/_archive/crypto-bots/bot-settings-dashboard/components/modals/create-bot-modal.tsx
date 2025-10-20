"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Loader2 } from "lucide-react"
import type { CreateBotFormData } from "../../types"
import { BOT_TYPES, EXCHANGES, STRATEGIES } from "../../constants"

interface CreateBotModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: CreateBotFormData) => Promise<{ success: boolean; bot?: any; error?: string }>
  isLoading: boolean
}

export function CreateBotModal({ open, onOpenChange, onSubmit, isLoading }: CreateBotModalProps) {
  const [formData, setFormData] = useState<CreateBotFormData>({
    name: "",
    type: "",
    exchange: "",
    pair: "",
    strategy: "",
    description: "",
  })

  const [errors, setErrors] = useState<Partial<CreateBotFormData>>({})

  const validateForm = () => {
    const newErrors: Partial<CreateBotFormData> = {}

    if (!formData.name.trim()) newErrors.name = "Bot name is required"
    if (!formData.type) newErrors.type = "Bot type is required"
    if (!formData.exchange) newErrors.exchange = "Exchange is required"
    if (!formData.pair.trim()) newErrors.pair = "Trading pair is required"
    if (!formData.strategy) newErrors.strategy = "Strategy is required"

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validateForm()) return

    const result = await onSubmit(formData)
    if (result.success) {
      setFormData({
        name: "",
        type: "",
        exchange: "",
        pair: "",
        strategy: "",
        description: "",
      })
      setErrors({})
      onOpenChange(false)
    }
  }

  const updateField = (field: keyof CreateBotFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Create New Bot</DialogTitle>
          <DialogDescription>Configure your new trading bot with the settings below.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Bot Name</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => updateField("name", e.target.value)}
              placeholder="Enter bot name"
              className={errors.name ? "border-red-500" : ""}
            />
            {errors.name && <p className="text-sm text-red-500">{errors.name}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="type">Bot Type</Label>
              <Select value={formData.type} onValueChange={(value) => updateField("type", value)}>
                <SelectTrigger className={errors.type ? "border-red-500" : ""}>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {BOT_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.type && <p className="text-sm text-red-500">{errors.type}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="exchange">Exchange</Label>
              <Select value={formData.exchange} onValueChange={(value) => updateField("exchange", value)}>
                <SelectTrigger className={errors.exchange ? "border-red-500" : ""}>
                  <SelectValue placeholder="Select exchange" />
                </SelectTrigger>
                <SelectContent>
                  {EXCHANGES.map((exchange) => (
                    <SelectItem key={exchange.value} value={exchange.value}>
                      {exchange.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.exchange && <p className="text-sm text-red-500">{errors.exchange}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="pair">Trading Pair</Label>
              <Input
                id="pair"
                value={formData.pair}
                onChange={(e) => updateField("pair", e.target.value)}
                placeholder="e.g., BTC/USDT"
                className={errors.pair ? "border-red-500" : ""}
              />
              {errors.pair && <p className="text-sm text-red-500">{errors.pair}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="strategy">Strategy</Label>
              <Select value={formData.strategy} onValueChange={(value) => updateField("strategy", value)}>
                <SelectTrigger className={errors.strategy ? "border-red-500" : ""}>
                  <SelectValue placeholder="Select strategy" />
                </SelectTrigger>
                <SelectContent>
                  {STRATEGIES.map((strategy) => (
                    <SelectItem key={strategy.value} value={strategy.value}>
                      {strategy.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.strategy && <p className="text-sm text-red-500">{errors.strategy}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (Optional)</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={(e) => updateField("description", e.target.value)}
              placeholder="Describe your bot's purpose and strategy"
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Bot
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
