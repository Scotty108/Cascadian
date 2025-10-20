"use client"

import { Label } from "@/components/ui/label"

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Edit, Play, Pause, TrendingUp, TrendingDown, DollarSign, Target, Activity, BarChart3 } from "lucide-react"
import type { DcaBot } from "../../types"
import { formatCurrency, formatPercentage, formatDateTime, getProfitColor } from "../../utils"

interface BotDetailsModalProps {
  bot: DcaBot | null
  isOpen: boolean
  onClose: () => void
  onEdit: (bot: DcaBot) => void
}

export function BotDetailsModal({ bot, isOpen, onClose, onEdit }: BotDetailsModalProps) {
  if (!bot) return null

  const profitPercentage = bot.totalInvested > 0 ? (bot.profit / bot.totalInvested) * 100 : 0
  const averageReturn =
    bot.history.length > 0
      ? bot.history.reduce((sum, purchase) => sum + (purchase.value - purchase.amount), 0) / bot.history.length
      : 0

  const completedPurchases = bot.history.filter((h) => h.status === "completed").length
  const failedPurchases = bot.history.filter((h) => h.status === "failed").length
  const successRate = bot.history.length > 0 ? (completedPurchases / bot.history.length) * 100 : 0

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span>{bot.name}</span>
              <Badge variant={bot.status === "active" ? "default" : "outline"}>{bot.status}</Badge>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => onEdit(bot)}>
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
              <Button variant="outline" size="sm">
                {bot.status === "active" ? (
                  <>
                    <Pause className="h-4 w-4 mr-2" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Start
                  </>
                )}
              </Button>
            </div>
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            {/* Key Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Invested</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(bot.totalInvested)}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Current Profit</CardTitle>
                  {bot.profit >= 0 ? (
                    <TrendingUp className="h-4 w-4 text-green-500" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-red-500" />
                  )}
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${getProfitColor(bot.profit)}`}>{formatCurrency(bot.profit)}</div>
                  <p className={`text-xs ${getProfitColor(profitPercentage)}`}>{formatPercentage(profitPercentage)}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Average Price</CardTitle>
                  <Target className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(bot.averagePrice)}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{successRate.toFixed(1)}%</div>
                  <Progress value={successRate} className="mt-2" />
                </CardContent>
              </Card>
            </div>

            {/* Bot Information */}
            <Card>
              <CardHeader>
                <CardTitle>Bot Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Asset:</span>
                      <span className="font-medium">{bot.asset}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Exchange:</span>
                      <span className="font-medium">{bot.exchange}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Frequency:</span>
                      <span className="font-medium">{bot.frequency}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Amount per Purchase:</span>
                      <span className="font-medium">{formatCurrency(bot.amount)}</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Created:</span>
                      <span className="font-medium">{formatDateTime(bot.createdAt)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Next Execution:</span>
                      <span className="font-medium">{formatDateTime(bot.nextExecution)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Purchases:</span>
                      <span className="font-medium">{bot.history.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Failed Purchases:</span>
                      <span className="font-medium text-red-500">{failedPurchases}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="performance" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Performance Metrics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Return:</span>
                      <span className={`font-medium ${getProfitColor(bot.profit)}`}>
                        {formatCurrency(bot.profit)} ({formatPercentage(profitPercentage)})
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Average Return per Purchase:</span>
                      <span className={`font-medium ${getProfitColor(averageReturn)}`}>
                        {formatCurrency(averageReturn)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Best Purchase:</span>
                      <span className="font-medium text-green-500">
                        {bot.history.length > 0
                          ? formatCurrency(Math.max(...bot.history.map((h) => h.value - h.amount)))
                          : formatCurrency(0)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Worst Purchase:</span>
                      <span className="font-medium text-red-500">
                        {bot.history.length > 0
                          ? formatCurrency(Math.min(...bot.history.map((h) => h.value - h.amount)))
                          : formatCurrency(0)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Purchase Statistics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Completed:</span>
                      <span className="font-medium text-green-500">{completedPurchases}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Failed:</span>
                      <span className="font-medium text-red-500">{failedPurchases}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Success Rate:</span>
                      <span className="font-medium">{successRate.toFixed(1)}%</span>
                    </div>
                  </div>
                  <Progress value={successRate} className="mt-4" />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Purchase History</CardTitle>
              </CardHeader>
              <CardContent>
                {bot.history.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Activity className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>No purchase history available</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {bot.history.slice(0, 10).map((purchase, index) => (
                      <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-2 h-2 rounded-full ${
                              purchase.status === "completed"
                                ? "bg-green-500"
                                : purchase.status === "failed"
                                  ? "bg-red-500"
                                  : "bg-yellow-500"
                            }`}
                          />
                          <div>
                            <p className="font-medium">{formatDateTime(purchase.date)}</p>
                            <p className="text-sm text-muted-foreground">
                              {formatCurrency(purchase.amount)} at {formatCurrency(purchase.price)}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-medium">{formatCurrency(purchase.value)}</p>
                          <p className={`text-sm ${getProfitColor(purchase.value - purchase.amount)}`}>
                            {formatCurrency(purchase.value - purchase.amount)}
                          </p>
                        </div>
                      </div>
                    ))}
                    {bot.history.length > 10 && (
                      <p className="text-center text-sm text-muted-foreground pt-2">
                        Showing 10 of {bot.history.length} purchases
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Current Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-3">
                    <div>
                      <Label className="text-sm font-medium">Asset</Label>
                      <p className="text-sm text-muted-foreground">{bot.asset}</p>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Exchange</Label>
                      <p className="text-sm text-muted-foreground">{bot.exchange}</p>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Purchase Frequency</Label>
                      <p className="text-sm text-muted-foreground">{bot.frequency}</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <Label className="text-sm font-medium">Amount per Purchase</Label>
                      <p className="text-sm text-muted-foreground">{formatCurrency(bot.amount)}</p>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Status</Label>
                      <Badge variant={bot.status === "active" ? "default" : "outline"} className="ml-2">
                        {bot.status}
                      </Badge>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">Next Execution</Label>
                      <p className="text-sm text-muted-foreground">{formatDateTime(bot.nextExecution)}</p>
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="flex justify-end">
                  <Button onClick={() => onEdit(bot)}>
                    <Edit className="h-4 w-4 mr-2" />
                    Edit Settings
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
