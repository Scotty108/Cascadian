"use client"

import Image from "next/image";
import { X, Heart, Share2, Download, Code, Check } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import type { BotTemplate } from "../types"
import { formatPrice } from "../utils"
import { StarRating } from "./star-rating"
import { CreatorBadge } from "./creator-badge"
import { ComplexityBadge } from "./complexity-badge"
import { CategoryIcon } from "./category-icon"
import { CustomizationPanel } from "./customization-panel"
import { useCustomization } from "../hooks/use-customization"
import { cn } from "@/lib/utils"

interface TemplateDetailsModalProps {
  template: BotTemplate | null
  isOpen: boolean
  onClose: () => void
  onToggleFavorite: (id: string) => void
}

export function TemplateDetailsModal({ template, isOpen, onClose, onToggleFavorite }: TemplateDetailsModalProps) {
  const { customizationMode, customizedSettings, updateCustomizedSetting, toggleCustomizationMode } = useCustomization()

  if (!template) return null

  const handleDeploy = () => {
    alert(`Template "${template.name}" deployed with custom settings!`)
    onClose()
  }

  const handleShare = () => {
    alert("Share functionality would open here")
  }

  const handleDownload = () => {
    alert("Template would be downloaded")
  }

  const handleViewCode = () => {
    alert("Template code would be shown")
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-auto p-0 sm:rounded-lg">
        <div className="sticky top-0 z-10 flex items-center justify-between bg-background p-4 shadow-sm">
          <DialogTitle className="text-xl font-semibold">{template.name}</DialogTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={(e) => {
                e.stopPropagation()
                onToggleFavorite(template.id)
              }}
            >
              <Heart
                className={cn(
                  "h-4 w-4",
                  template.isFavorite ? "fill-destructive text-destructive" : "text-muted-foreground",
                )}
              />
            </Button>
            <Button variant="outline" size="icon" onClick={handleShare}>
              <Share2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-3">
          <div className="md:col-span-2">
            <div className="aspect-video w-full overflow-hidden rounded-lg bg-muted">
              <Image
                src={template.image || "/placeholder.svg"}
                alt={template.name}
                className="h-full w-full object-cover"
                width={800}
                height={450}
              />
            </div>

            <div className="mt-6">
              <h3 className="text-lg font-semibold">Description</h3>
              <p className="mt-2 text-muted-foreground">{template.description}</p>
            </div>

            <div className="mt-6">
              <h3 className="text-lg font-semibold">Features</h3>
              <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {template.features.map((feature, index) => (
                  <li key={index} className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-500" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-6">
              <h3 className="text-lg font-semibold">Performance Metrics</h3>
              <div className="mt-2 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="rounded-lg border p-3">
                  <div className="text-sm text-muted-foreground">Win Rate</div>
                  <div className="text-2xl font-bold">{template.performance.winRate}%</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-sm text-muted-foreground">Profit Factor</div>
                  <div className="text-2xl font-bold">{template.performance.profitFactor}x</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-sm text-muted-foreground">Max Drawdown</div>
                  <div className="text-2xl font-bold">{template.performance.maxDrawdown}%</div>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-sm text-muted-foreground">Avg. Profit</div>
                  <div className="text-2xl font-bold">{template.performance.averageProfit}%</div>
                </div>
              </div>
            </div>

            <div className="mt-6">
              <h3 className="text-lg font-semibold">Supported Exchanges</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {template.exchanges.map((exchange, index) => (
                  <Badge key={index} variant="secondary">
                    {exchange}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="mt-6">
              <h3 className="text-lg font-semibold">Supported Assets</h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {template.assets.map((asset, index) => (
                  <Badge key={index} variant="outline">
                    {asset}
                  </Badge>
                ))}
              </div>
            </div>

            <div className="mt-6">
              <h3 className="text-lg font-semibold">Reviews</h3>
              <div className="mt-2 flex items-center gap-2">
                <StarRating rating={template.rating} />
                <span className="text-sm text-muted-foreground">Based on {template.reviews} reviews</span>
              </div>
            </div>
          </div>

          <div>
            <div className="rounded-lg border p-4">
              {customizationMode ? (
                <CustomizationPanel
                  settings={customizedSettings}
                  onUpdateSetting={updateCustomizedSetting}
                  onBack={toggleCustomizationMode}
                  onDeploy={handleDeploy}
                />
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Template Info</h3>
                    <ComplexityBadge complexity={template.complexity} />
                  </div>

                  <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Category</span>
                      <Badge variant="outline" className="flex items-center gap-1">
                        <CategoryIcon category={template.category} />
                        {template.category}
                      </Badge>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Type</span>
                      <span className="font-medium">{template.type}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Last Updated</span>
                      <span className="font-medium">{template.lastUpdated}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Popularity</span>
                      <span className="font-medium">{template.popularity.toLocaleString()} users</span>
                    </div>

                    <Separator />

                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Creator</span>
                      <CreatorBadge creator={template.creator} size="md" />
                    </div>

                    <Separator />

                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Price</span>
                      <span className="text-xl font-bold">
                        {template.price === "Free" ? (
                          <span className="text-green-500">Free</span>
                        ) : (
                          <span>{formatPrice(template.price)}</span>
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="mt-6 space-y-2">
                    <Button className="w-full" onClick={toggleCustomizationMode}>
                      Customize & Deploy
                    </Button>

                    <Button variant="outline" className="w-full" onClick={handleDownload}>
                      <Download className="mr-2 h-4 w-4" />
                      Download Template
                    </Button>

                    <Button variant="outline" className="w-full" onClick={handleViewCode}>
                      <Code className="mr-2 h-4 w-4" />
                      View Code
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
