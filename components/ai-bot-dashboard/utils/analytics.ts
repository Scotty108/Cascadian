import type {
    Asset,
    AssetAnalytics,
    TechnicalIndicator,
    PriceMetrics,
    VolumeAnalysis,
    AssetCorrelation,
    RiskMetrics,
    PricePrediction,
  } from "../types"
  
  // Mock data generator for analytics
  export function generateAssetAnalytics(asset: Asset): AssetAnalytics {
    const technicalIndicators: TechnicalIndicator[] = [
      {
        name: "RSI (14)",
        value: Math.random() * 100,
        signal: Math.random() > 0.5 ? "buy" : Math.random() > 0.5 ? "sell" : "neutral",
        description: "Relative Strength Index indicates overbought/oversold conditions",
      },
      {
        name: "MACD",
        value: (Math.random() - 0.5) * 100,
        signal: Math.random() > 0.5 ? "buy" : Math.random() > 0.5 ? "sell" : "neutral",
        description: "Moving Average Convergence Divergence shows trend momentum",
      },
      {
        name: "Bollinger Bands",
        value: Math.random() * 100,
        signal: Math.random() > 0.5 ? "buy" : Math.random() > 0.5 ? "sell" : "neutral",
        description: "Price volatility and potential support/resistance levels",
      },
      {
        name: "Stochastic",
        value: Math.random() * 100,
        signal: Math.random() > 0.5 ? "buy" : Math.random() > 0.5 ? "sell" : "neutral",
        description: "Momentum oscillator comparing closing price to price range",
      },
    ]
  
    const priceMetrics: PriceMetrics = {
      volatility: Math.random() * 50 + 10,
      beta: Math.random() * 2 + 0.5,
      sharpeRatio: Math.random() * 3 - 0.5,
      maxDrawdown: Math.random() * 30 + 5,
      averageReturn: Math.random() * 20 - 5,
      standardDeviation: Math.random() * 15 + 5,
    }
  
    const volumeAnalysis: VolumeAnalysis = {
      averageVolume: Math.random() * 1000000000 + 100000000,
      volumeTrend: Math.random() > 0.5 ? "increasing" : Math.random() > 0.5 ? "decreasing" : "stable",
      volumeRatio: Math.random() * 2 + 0.5,
      liquidityScore: Math.random() * 100,
    }
  
    const correlations = [
      { asset: "BTC", correlation: Math.random() * 2 - 1, strength: "strong" },
      { asset: "ETH", correlation: Math.random() * 2 - 1, strength: "moderate" },
      { asset: "SPY", correlation: Math.random() * 2 - 1, strength: "weak" },
      { asset: "GOLD", correlation: Math.random() * 2 - 1, strength: "moderate" },
    ].filter((c) => c.asset !== asset.symbol) as AssetCorrelation[];
  
    const riskMetrics: RiskMetrics = {
      valueAtRisk: Math.random() * 10 + 1,
      conditionalVaR: Math.random() * 15 + 5,
      riskScore: Math.random() * 100,
      riskLevel: Math.random() > 0.6 ? "high" : Math.random() > 0.3 ? "medium" : "low",
    }
  
    const predictions: PricePrediction[] = [
      {
        timeframe: "1 Day",
        predictedPrice: asset.price * (1 + (Math.random() - 0.5) * 0.1),
        confidence: Math.random() * 40 + 60,
        direction: Math.random() > 0.5 ? "up" : "down",
      },
      {
        timeframe: "1 Week",
        predictedPrice: asset.price * (1 + (Math.random() - 0.5) * 0.2),
        confidence: Math.random() * 30 + 50,
        direction: Math.random() > 0.5 ? "up" : "down",
      },
      {
        timeframe: "1 Month",
        predictedPrice: asset.price * (1 + (Math.random() - 0.5) * 0.4),
        confidence: Math.random() * 25 + 40,
        direction: Math.random() > 0.5 ? "up" : "down",
      },
    ]
  
    return {
      technicalIndicators,
      priceMetrics,
      volumeAnalysis,
      correlations,
      riskMetrics,
      predictions,
    }
  }
  
  export function getSignalColor(signal: string): string {
    switch (signal) {
      case "buy":
        return "text-green-600"
      case "sell":
        return "text-red-600"
      default:
        return "text-yellow-600"
    }
  }
  
  export function getSignalBadgeVariant(signal: string): "default" | "destructive" | "secondary" {
    switch (signal) {
      case "buy":
        return "default"
      case "sell":
        return "destructive"
      default:
        return "secondary"
    }
  }
  
  export function getRiskColor(level: string): string {
    switch (level) {
      case "low":
        return "text-green-600"
      case "medium":
        return "text-yellow-600"
      case "high":
        return "text-red-600"
      default:
        return "text-gray-600"
    }
  }
  