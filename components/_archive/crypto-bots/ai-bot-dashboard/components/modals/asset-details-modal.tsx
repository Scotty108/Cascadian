"use client"

import { useState, useEffect, useMemo } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Activity,
  BarChart3,
  Clock,
  AlertTriangle,
  Target,
  Zap,
} from "lucide-react"
import { formatCurrency, formatPercentage } from "../../utils"
import { generateAssetAnalytics, getSignalBadgeVariant } from "../../utils/analytics"
import { generateNewsFeed, getSentimentBadgeVariant, getImpactColor, formatTimeAgo } from "../../utils/news"
import type { Asset, AssetAnalytics, NewsFeed } from "../../types"

interface AssetDetailsModalProps {
  asset: Asset | null
  isOpen: boolean
  onClose: () => void
}

export function AssetDetailsModal({ asset, isOpen, onClose }: AssetDetailsModalProps) {
  const [activeTab, setActiveTab] = useState("overview")
  const [analytics, setAnalytics] = useState<AssetAnalytics | null>(null)
  const [newsFeed, setNewsFeed] = useState<NewsFeed | null>(null)
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false)
  const [isLoadingNews, setIsLoadingNews] = useState(false)

  // Generate analytics data when asset changes
  useEffect(() => {
    if (asset && activeTab === "analytics") {
      setIsLoadingAnalytics(true)
      // Simulate API call delay
      setTimeout(() => {
        setAnalytics(generateAssetAnalytics(asset))
        setIsLoadingAnalytics(false)
      }, 1000)
    }
  }, [asset, activeTab])

  // Generate news data when asset changes
  useEffect(() => {
    if (asset && activeTab === "news") {
      setIsLoadingNews(true)
      // Simulate API call delay
      setTimeout(() => {
        setNewsFeed(generateNewsFeed(asset))
        setIsLoadingNews(false)
      }, 800)
    }
  }, [asset, activeTab])

  // Mock data for the asset details
  const assetDetails = useMemo(() => {
    if (!asset) return null

    return {
      marketCap: 123456789000,
      volume24h: 5678900000,
      circulatingSupply: 19000000,
      maxSupply: 21000000,
      allTimeHigh: 69000,
      allTimeHighDate: "2021-11-10",
      allTimeLow: 3000,
      allTimeLowDate: "2019-03-15",
      priceHistory: [
        { date: "2023-01-01", price: 16500 },
        { date: "2023-02-01", price: 23000 },
        { date: "2023-03-01", price: 28000 },
        { date: "2023-04-01", price: 30000 },
        { date: "2023-05-01", price: 27000 },
        { date: "2023-06-01", price: 31000 },
      ],
      exchanges: [
        { name: "Binance", price: asset.price * 0.999, volume: 2345678900 },
        { name: "Coinbase", price: asset.price * 1.001, volume: 1234567890 },
        { name: "Kraken", price: asset.price * 0.998, volume: 987654321 },
      ],
    }
  }, [asset])

  if (!asset || !assetDetails) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {asset.symbol}
            <Badge variant={asset.change24h >= 0 ? "default" : "destructive"} className="ml-2">
              {asset.change24h >= 0 ? (
                <ArrowUpRight className="h-3 w-3 mr-1" />
              ) : (
                <ArrowDownRight className="h-3 w-3 mr-1" />
              )}
              {formatPercentage(asset.change24h)}
            </Badge>
          </DialogTitle>
          <DialogDescription>Current Price: {formatCurrency(asset.price)}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="overview" value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid grid-cols-4 mb-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="markets">Markets</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
            <TabsTrigger value="news">News</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Market Cap</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-lg font-semibold">{formatCurrency(assetDetails.marketCap)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">24h Volume</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-lg font-semibold">{formatCurrency(assetDetails.volume24h)}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Circulating Supply</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-lg font-semibold">{assetDetails.circulatingSupply.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">
                    {((assetDetails.circulatingSupply / assetDetails.maxSupply) * 100).toFixed(2)}% of max supply
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">All Time High</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-lg font-semibold">{formatCurrency(assetDetails.allTimeHigh)}</p>
                  <p className="text-xs text-muted-foreground">on {assetDetails.allTimeHighDate}</p>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Price History</CardTitle>
                <CardDescription>Last 6 months</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[200px] flex items-end justify-between">
                  {assetDetails.priceHistory.map((point, index) => (
                    <div key={index} className="flex flex-col items-center">
                      <div
                        className="bg-primary w-8 rounded-t-sm"
                        style={{
                          height: `${(point.price / Math.max(...assetDetails.priceHistory.map((p) => p.price))) * 150}px`,
                        }}
                      ></div>
                      <p className="text-xs mt-2">{point.date.split("-")[1]}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Markets Tab */}
          <TabsContent value="markets">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Exchange Prices</CardTitle>
                <CardDescription>Current prices across major exchanges</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {assetDetails.exchanges.map((exchange, index) => (
                    <div
                      key={index}
                      className="flex justify-between items-center border-b pb-2 last:border-0 last:pb-0"
                    >
                      <div>
                        <p className="font-medium">{exchange.name}</p>
                        <p className="text-sm text-muted-foreground">Vol: {formatCurrency(exchange.volume)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">{formatCurrency(exchange.price)}</p>
                        <p
                          className={`text-sm ${
                            exchange.price > asset.price
                              ? "text-green-600"
                              : exchange.price < asset.price
                                ? "text-red-600"
                                : "text-muted-foreground"
                          }`}
                        >
                          {((exchange.price / asset.price - 1) * 100).toFixed(3)}%
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics" className="space-y-4">
            {isLoadingAnalytics ? (
              <div className="flex items-center justify-center py-12">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 animate-spin" />
                  <span>Loading analytics...</span>
                </div>
              </div>
            ) : analytics ? (
              <div className="space-y-6">
                {/* Technical Indicators */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="h-5 w-5" />
                      Technical Indicators
                    </CardTitle>
                    <CardDescription>Key technical analysis signals</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      {analytics.technicalIndicators.map((indicator, index) => (
                        <div key={index} className="space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-sm font-medium">{indicator.name}</span>
                            <Badge variant={getSignalBadgeVariant(indicator.signal)}>
                              {indicator.signal.toUpperCase()}
                            </Badge>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-lg font-semibold">{indicator.value.toFixed(2)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{indicator.description}</p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Price Metrics */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="h-5 w-5" />
                      Price Metrics
                    </CardTitle>
                    <CardDescription>Statistical analysis of price performance</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground">Volatility</p>
                        <p className="text-lg font-semibold">{analytics.priceMetrics.volatility.toFixed(2)}%</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground">Beta</p>
                        <p className="text-lg font-semibold">{analytics.priceMetrics.beta.toFixed(2)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground">Sharpe Ratio</p>
                        <p className="text-lg font-semibold">{analytics.priceMetrics.sharpeRatio.toFixed(2)}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground">Max Drawdown</p>
                        <p className="text-lg font-semibold text-red-600">
                          -{analytics.priceMetrics.maxDrawdown.toFixed(2)}%
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground">Avg Return</p>
                        <p
                          className={`text-lg font-semibold ${analytics.priceMetrics.averageReturn >= 0 ? "text-green-600" : "text-red-600"}`}
                        >
                          {analytics.priceMetrics.averageReturn.toFixed(2)}%
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-muted-foreground">Std Deviation</p>
                        <p className="text-lg font-semibold">{analytics.priceMetrics.standardDeviation.toFixed(2)}%</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Risk Assessment */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5" />
                      Risk Assessment
                    </CardTitle>
                    <CardDescription>Risk metrics and analysis</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <span>Risk Level</span>
                        <Badge
                          variant={
                            analytics.riskMetrics.riskLevel === "low"
                              ? "default"
                              : analytics.riskMetrics.riskLevel === "medium"
                                ? "secondary"
                                : "destructive"
                          }
                        >
                          {analytics.riskMetrics.riskLevel.toUpperCase()}
                        </Badge>
                      </div>
                      <div>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-sm">Risk Score</span>
                          <span className="text-sm font-medium">{analytics.riskMetrics.riskScore.toFixed(0)}/100</span>
                        </div>
                        <Progress value={analytics.riskMetrics.riskScore} className="h-2" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm text-muted-foreground">Value at Risk (95%)</p>
                          <p className="text-lg font-semibold text-red-600">
                            -{analytics.riskMetrics.valueAtRisk.toFixed(2)}%
                          </p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Conditional VaR</p>
                          <p className="text-lg font-semibold text-red-600">
                            -{analytics.riskMetrics.conditionalVaR.toFixed(2)}%
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Price Predictions */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Target className="h-5 w-5" />
                      AI Price Predictions
                    </CardTitle>
                    <CardDescription>Machine learning based price forecasts</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {analytics.predictions.map((prediction, index) => (
                        <div key={index} className="flex justify-between items-center p-3 border rounded-lg">
                          <div>
                            <p className="font-medium">{prediction.timeframe}</p>
                            <p className="text-sm text-muted-foreground">
                              Confidence: {prediction.confidence.toFixed(0)}%
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-lg font-semibold">{formatCurrency(prediction.predictedPrice)}</p>
                            <div className="flex items-center gap-1">
                              {prediction.direction === "up" ? (
                                <TrendingUp className="h-4 w-4 text-green-600" />
                              ) : (
                                <TrendingDown className="h-4 w-4 text-red-600" />
                              )}
                              <span
                                className={`text-sm ${prediction.direction === "up" ? "text-green-600" : "text-red-600"}`}
                              >
                                {((prediction.predictedPrice / asset.price - 1) * 100).toFixed(2)}%
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-muted-foreground">Failed to load analytics data</p>
              </div>
            )}
          </TabsContent>

          {/* News Tab */}
          <TabsContent value="news">
            {isLoadingNews ? (
              <div className="flex items-center justify-center py-12">
                <div className="flex items-center gap-2">
                  <Zap className="h-4 w-4 animate-pulse" />
                  <span>Loading latest news...</span>
                </div>
              </div>
            ) : newsFeed ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>Latest News</span>
                    <Badge variant="secondary">{newsFeed.totalCount} articles</Badge>
                  </CardTitle>
                  <CardDescription>Last updated: {formatTimeAgo(newsFeed.lastUpdated)}</CardDescription>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[400px]">
                    <div className="space-y-4">
                      {newsFeed.items.map((item, index) => (
                        <div key={item.id}>
                          <div className="space-y-2">
                            <div className="flex justify-between items-start gap-2">
                              <h4 className="font-medium text-sm leading-tight">{item.title}</h4>
                              <div className="flex gap-1 flex-shrink-0">
                                <Badge variant={getSentimentBadgeVariant(item.sentiment)} className="text-xs">
                                  {item.sentiment}
                                </Badge>
                                <Badge variant="outline" className={`text-xs ${getImpactColor(item.impact)}`}>
                                  {item.impact}
                                </Badge>
                              </div>
                            </div>
                            <p className="text-sm text-muted-foreground">{item.summary}</p>
                            <div className="flex justify-between items-center text-xs text-muted-foreground">
                              <div className="flex items-center gap-2">
                                <span>{item.source}</span>
                                <span>•</span>
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {formatTimeAgo(item.publishedAt)}
                                </span>
                              </div>
                              <div className="flex gap-1">
                                {item.tags.slice(0, 2).map((tag) => (
                                  <Badge key={tag} variant="outline" className="text-xs">
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            <div className="flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground">Relevance:</span>
                                <Progress value={item.relevanceScore} className="w-16 h-1" />
                                <span className="text-xs text-muted-foreground">{item.relevanceScore}%</span>
                              </div>
                              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
                                <ExternalLink className="h-3 w-3 mr-1" />
                                Read More
                              </Button>
                            </div>
                          </div>
                          {index < newsFeed.items.length - 1 && <Separator className="mt-4" />}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            ) : (
              <div className="text-center py-12">
                <p className="text-muted-foreground">Failed to load news feed</p>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex justify-between items-center">
          <Button variant="outline" size="sm" className="gap-1">
            <ExternalLink className="h-4 w-4" />
            <span>View on Explorer</span>
          </Button>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
