"use client"

import type React from "react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { toast } from "@/hooks/use-toast"
import { Plus, X, Star, TrendingUp, Shield, Zap } from "lucide-react"

interface AddProviderModalProps {
  isOpen: boolean
  onClose: () => void
  onAdd: (provider: any) => void
}

export function AddProviderModal({ isOpen, onClose, onAdd }: AddProviderModalProps) {
  const [formData, setFormData] = useState({
    name: "",
    type: "",
    description: "",
    apiKey: "",
    webhookUrl: "",
    isActive: true,
    riskLevel: "medium",
    successRate: "",
    avgReturn: "",
    maxDrawdown: "",
    subscriptionFee: "",
    tags: [] as string[],
    features: {
      realTimeSignals: false,
      backtesting: false,
      riskManagement: false,
      customAlerts: false,
      portfolioTracking: false,
      socialTrading: false,
    },
  })

  const [newTag, setNewTag] = useState("")

  const handleInputChange = (field: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  const handleFeatureChange = (feature: string, value: boolean) => {
    setFormData((prev) => ({
      ...prev,
      features: {
        ...prev.features,
        [feature]: value,
      },
    }))
  }

  const addTag = () => {
    if (newTag.trim() && !formData.tags.includes(newTag.trim())) {
      setFormData((prev) => ({
        ...prev,
        tags: [...prev.tags, newTag.trim()],
      }))
      setNewTag("")
    }
  }

  const removeTag = (tagToRemove: string) => {
    setFormData((prev) => ({
      ...prev,
      tags: prev.tags.filter((tag) => tag !== tagToRemove),
    }))
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.name || !formData.type) {
      toast({
        title: "Validation Error",
        description: "Please fill in all required fields.",
        variant: "destructive",
      })
      return
    }

    const newProvider = {
      id: Date.now().toString(),
      ...formData,
      successRate: Number.parseFloat(formData.successRate) || 0,
      avgReturn: Number.parseFloat(formData.avgReturn) || 0,
      maxDrawdown: Number.parseFloat(formData.maxDrawdown) || 0,
      subscriptionFee: Number.parseFloat(formData.subscriptionFee) || 0,
      createdAt: new Date().toISOString(),
      status: formData.isActive ? "active" : "inactive",
    }

    onAdd(newProvider)
    handleClose()

    toast({
      title: "Provider Added",
      description: `${formData.name} has been successfully added to your providers.`,
    })
  }

  const handleClose = () => {
    setFormData({
      name: "",
      type: "",
      description: "",
      apiKey: "",
      webhookUrl: "",
      isActive: true,
      riskLevel: "medium",
      successRate: "",
      avgReturn: "",
      maxDrawdown: "",
      subscriptionFee: "",
      tags: [],
      features: {
        realTimeSignals: false,
        backtesting: false,
        riskManagement: false,
        customAlerts: false,
        portfolioTracking: false,
        socialTrading: false,
      },
    })
    setNewTag("")
    onClose()
  }

  const providerTypes = [
    { value: "telegram", label: "Telegram Channel" },
    { value: "discord", label: "Discord Server" },
    { value: "api", label: "API Provider" },
    { value: "webhook", label: "Webhook" },
    { value: "email", label: "Email Alerts" },
    { value: "custom", label: "Custom Integration" },
  ]

  const riskLevels = [
    { value: "low", label: "Low Risk", color: "bg-green-100 text-green-800" },
    { value: "medium", label: "Medium Risk", color: "bg-yellow-100 text-yellow-800" },
    { value: "high", label: "High Risk", color: "bg-red-100 text-red-800" },
  ]

  const featuresList = [
    { key: "realTimeSignals", label: "Real-time Signals", icon: Zap },
    { key: "backtesting", label: "Backtesting", icon: TrendingUp },
    { key: "riskManagement", label: "Risk Management", icon: Shield },
    { key: "customAlerts", label: "Custom Alerts", icon: Star },
    { key: "portfolioTracking", label: "Portfolio Tracking", icon: TrendingUp },
    { key: "socialTrading", label: "Social Trading", icon: Star },
  ]

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Signal Provider</DialogTitle>
          <DialogDescription>Configure a new signal provider to receive trading signals and alerts.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Information */}
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Provider Name *</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => handleInputChange("name", e.target.value)}
                  placeholder="Enter provider name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="type">Provider Type *</Label>
                <Select value={formData.type} onValueChange={(value) => handleInputChange("type", value)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select provider type" />
                  </SelectTrigger>
                  <SelectContent>
                    {providerTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => handleInputChange("description", e.target.value)}
                placeholder="Describe the signal provider..."
                rows={3}
              />
            </div>
          </div>

          <Separator />

          {/* Connection Settings */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Connection Settings</h3>

            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key / Token</Label>
                <Input
                  id="apiKey"
                  type="password"
                  value={formData.apiKey}
                  onChange={(e) => handleInputChange("apiKey", e.target.value)}
                  placeholder="Enter API key or access token"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="webhookUrl">Webhook URL</Label>
                <Input
                  id="webhookUrl"
                  value={formData.webhookUrl}
                  onChange={(e) => handleInputChange("webhookUrl", e.target.value)}
                  placeholder="https://example.com/webhook"
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Performance Metrics */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Performance Metrics</h3>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="successRate">Success Rate (%)</Label>
                <Input
                  id="successRate"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={formData.successRate}
                  onChange={(e) => handleInputChange("successRate", e.target.value)}
                  placeholder="85.5"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="avgReturn">Average Return (%)</Label>
                <Input
                  id="avgReturn"
                  type="number"
                  step="0.1"
                  value={formData.avgReturn}
                  onChange={(e) => handleInputChange("avgReturn", e.target.value)}
                  placeholder="12.5"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="maxDrawdown">Max Drawdown (%)</Label>
                <Input
                  id="maxDrawdown"
                  type="number"
                  min="0"
                  step="0.1"
                  value={formData.maxDrawdown}
                  onChange={(e) => handleInputChange("maxDrawdown", e.target.value)}
                  placeholder="15.2"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="subscriptionFee">Subscription Fee ($)</Label>
                <Input
                  id="subscriptionFee"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.subscriptionFee}
                  onChange={(e) => handleInputChange("subscriptionFee", e.target.value)}
                  placeholder="99.99"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="riskLevel">Risk Level</Label>
              <Select value={formData.riskLevel} onValueChange={(value) => handleInputChange("riskLevel", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {riskLevels.map((level) => (
                    <SelectItem key={level.value} value={level.value}>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${level.color.split(" ")[0]}`} />
                        {level.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* Features */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Features</h3>

            <div className="grid sm:grid-cols-2 gap-4">
              {featuresList.map((feature) => {
                const Icon = feature.icon
                return (
                  <div key={feature.key} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{feature.label}</span>
                    </div>
                    <Switch
                      checked={formData.features[feature.key as keyof typeof formData.features]}
                      onCheckedChange={(checked) => handleFeatureChange(feature.key, checked)}
                    />
                  </div>
                )
              })}
            </div>
          </div>

          <Separator />

          {/* Tags */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Tags</h3>

            <div className="flex gap-2">
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="Add a tag..."
                onKeyPress={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
              />
              <Button type="button" onClick={addTag} size="sm">
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            {formData.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {formData.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="flex items-center gap-1">
                    {tag}
                    <button type="button" onClick={() => removeTag(tag)} className="ml-1 hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* Status */}
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="isActive">Active Status</Label>
              <p className="text-sm text-muted-foreground">Enable this provider to start receiving signals</p>
            </div>
            <Switch
              id="isActive"
              checked={formData.isActive}
              onCheckedChange={(checked) => handleInputChange("isActive", checked)}
            />
          </div>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" onClick={handleSubmit}>
            Add Provider
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
