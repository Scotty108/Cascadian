"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { BarChart3, Calendar, Clock, DollarSign, TrendingUp, Volume2, Zap } from "lucide-react"
import { HistoricalPump } from "../types"
import { getProfitPotentialColor } from "../utils"


interface PumpDetailsModalProps {
  pump: HistoricalPump | null
  isOpen: boolean
  onClose: () => void
}

export function PumpDetailsModal({ pump, isOpen, onClose }: PumpDetailsModalProps) {
  if (!pump) return null

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            {pump.symbol} Pump Analysis
          </DialogTitle>
          <DialogDescription>Detailed analysis of the pump event on {pump.date}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-green-500" />
                  <span className="text-sm font-medium">Price Change</span>
                </div>
                <div className="text-2xl font-bold text-green-500">+{pump.priceChangePct}%</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Volume2 className="h-4 w-4 text-blue-500" />
                  <span className="text-sm font-medium">Volume Increase</span>
                </div>
                <div className="text-2xl font-bold text-blue-500">+{pump.volumeIncreasePct}%</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-orange-500" />
                  <span className="text-sm font-medium">Duration</span>
                </div>
                <div className="text-2xl font-bold">{pump.duration}</div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 text-purple-500" />
                  <span className="text-sm font-medium">Profit Potential</span>
                </div>
                <Badge variant="outline" className={getProfitPotentialColor(pump.profitPotential)}>
                  {pump.profitPotential}
                </Badge>
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="analysis">Analysis</TabsTrigger>
              <TabsTrigger value="patterns">Patterns</TabsTrigger>
              <TabsTrigger value="insights">Insights</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Event Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-sm font-medium text-muted-foreground">Date</span>
                      <div className="text-lg font-semibold">{pump.date}</div>
                    </div>
                    <div>
                      <span className="text-sm font-medium text-muted-foreground">Trigger</span>
                      <div className="text-lg font-semibold">{pump.trigger}</div>
                    </div>
                  </div>
                  <Separator />
                  <div>
                    <span className="text-sm font-medium text-muted-foreground">Description</span>
                    <p className="mt-1 text-sm">
                      This pump was triggered by {pump.trigger.toLowerCase()} and lasted for {pump.duration}. The price
                      increased by {pump.priceChangePct}% with a volume surge of {pump.volumeIncreasePct}%.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="analysis" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-4 w-4" />
                    Technical Analysis
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-sm font-medium text-muted-foreground">Peak Price</span>
                        <div className="text-lg font-semibold">$0.{Math.random().toFixed(4).slice(2)}</div>
                      </div>
                      <div>
                        <span className="text-sm font-medium text-muted-foreground">Peak Volume</span>
                        <div className="text-lg font-semibold">${(Math.random() * 1000000).toFixed(0)}K</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-sm font-medium text-muted-foreground">Market Cap Peak</span>
                        <div className="text-lg font-semibold">${(Math.random() * 100).toFixed(1)}M</div>
                      </div>
                      <div>
                        <span className="text-sm font-medium text-muted-foreground">Holders Increase</span>
                        <div className="text-lg font-semibold">+{Math.floor(Math.random() * 500)}%</div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="patterns" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Similar Patterns</CardTitle>
                  <CardDescription>Historical pumps with similar characteristics</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <div className="font-medium">Pattern #{i}</div>
                          <div className="text-sm text-muted-foreground">Similar trigger and duration</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium text-green-500">+{Math.floor(Math.random() * 500)}%</div>
                          <div className="text-xs text-muted-foreground">{Math.floor(Math.random() * 30)} days ago</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="insights" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Key Insights</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                      <h4 className="font-medium text-green-800 dark:text-green-200">Success Factors</h4>
                      <ul className="mt-2 text-sm text-green-700 dark:text-green-300 space-y-1">
                        <li>• Strong community engagement</li>
                        <li>• Positive market sentiment</li>
                        <li>• Low initial market cap</li>
                      </ul>
                    </div>
                    <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
                      <h4 className="font-medium text-blue-800 dark:text-blue-200">Lessons Learned</h4>
                      <ul className="mt-2 text-sm text-blue-700 dark:text-blue-300 space-y-1">
                        <li>• Early entry was crucial for maximum gains</li>
                        <li>• Volume preceded price movement</li>
                        <li>• Social media buzz was a leading indicator</li>
                      </ul>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button>
              <DollarSign className="mr-2 h-4 w-4" />
              Set Similar Alert
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
