"use client"

import { useState, useCallback } from "react"
import type { OrderFormData, TradeHistoryItem, TradingSettings } from "../types"

export function useTrading() {
  const [settings, setSettings] = useState<TradingSettings>({
    tradingView: true,
    signals: true,
    fullscreen: false,
  })

  const [buyOrder, setBuyOrder] = useState<OrderFormData>({
    amount: "",
    price: "42831.07",
    total: "",
    type: "limit",
  })

  const [sellOrder, setSellOrder] = useState<OrderFormData>({
    amount: "",
    price: "42831.07",
    total: "",
    type: "limit",
  })

  const [selectedExchange, setSelectedExchange] = useState("binance")
  const [selectedAccount, setSelectedAccount] = useState("main")
  const [selectedMarket, setSelectedMarket] = useState("spot")
  const [selectedPair, setSelectedPair] = useState("btcusdt")
  const [tradeHistory, setTradeHistory] = useState<TradeHistoryItem[]>([
    {
      id: "1",
      type: "buy",
      amount: "0.001",
      price: "45000.00",
      total: "45.00",
      timestamp: "2025-07-13 10:00:00",
      pair: "btcusdt",
    },
    {
      id: "2",
      type: "sell",
      amount: "0.0005",
      price: "45100.00",
      total: "22.55",
      timestamp: "2025-07-13 10:05:00",
      pair: "btcusdt",
    },
    {
      id: "3",
      type: "buy",
      amount: "0.002",
      price: "44950.00",
      total: "89.90",
      timestamp: "2025-07-13 10:10:00",
      pair: "ethusdt",
    },
  ])

  const updateSetting = useCallback((key: keyof TradingSettings, value: boolean) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }, [])

  const calculateTotal = useCallback((amount: string, price: string): string => {
    const amountNum = Number.parseFloat(amount) || 0
    const priceNum = Number.parseFloat(price) || 0
    return (amountNum * priceNum).toFixed(2)
  }, [])

  const calculateAmount = useCallback((total: string, price: string): string => {
    const totalNum = Number.parseFloat(total) || 0
    const priceNum = Number.parseFloat(price) || 0
    return priceNum > 0 ? (totalNum / priceNum).toFixed(8) : "0"
  }, [])

  const updateBuyOrder = useCallback(
    (field: keyof OrderFormData, value: string) => {
      setBuyOrder((prev) => {
        const updated = { ...prev, [field]: value }

        if (field === "amount" || field === "price") {
          updated.total = calculateTotal(updated.amount, updated.price)
        } else if (field === "total") {
          updated.amount = calculateAmount(updated.total, updated.price)
        }

        return updated
      })
    },
    [calculateTotal, calculateAmount],
  )

  const updateSellOrder = useCallback(
    (field: keyof OrderFormData, value: string) => {
      setSellOrder((prev) => {
        const updated = { ...prev, [field]: value }

        if (field === "amount" || field === "price") {
          updated.total = calculateTotal(updated.amount, updated.price)
        } else if (field === "total") {
          updated.amount = calculateAmount(updated.total, updated.price)
        }

        return updated
      })
    },
    [calculateTotal, calculateAmount],
  )

  const handlePercentageClick = useCallback(
    (percentage: number, type: "buy" | "sell") => {
      if (type === "buy") {
        const availableBalance = 12500.25
        const price = Number.parseFloat(buyOrder.price) || 0
        const totalToSpend = (availableBalance * percentage) / 100
        const amount = price > 0 ? totalToSpend / price : 0

        setBuyOrder((prev) => ({
          ...prev,
          amount: amount.toFixed(8),
          total: totalToSpend.toFixed(2),
        }))
      } else {
        const availableBTC = 0.42
        const amount = (availableBTC * percentage) / 100
        const price = Number.parseFloat(sellOrder.price) || 0

        setSellOrder((prev) => ({
          ...prev,
          amount: amount.toFixed(8),
          total: (amount * price).toFixed(2),
        }))
      }
    },
    [buyOrder.price, sellOrder.price],
  )

  const executeBuyOrder = useCallback(() => {
    console.log("Attempting to execute buy order. Current buyOrder state:", buyOrder);
    if (buyOrder.amount && buyOrder.price) {
      const newTrade: TradeHistoryItem = {
        id: Date.now().toString(),
        type: "buy",
        amount: buyOrder.amount,
        price: buyOrder.price,
        total: buyOrder.total,
        timestamp: new Date().toLocaleString(),
        pair: selectedPair,
      };
      setTradeHistory((prev) => [newTrade, ...prev]);
      setBuyOrder({
        amount: "",
        price: buyOrder.price, // Keep current price for convenience
        total: "",
        type: "limit",
      });
      console.log("Buy order executed:", newTrade);
    } else {
      console.log("Invalid buy order: amount or price is missing.", buyOrder);
    }
  }, [buyOrder, selectedPair]);

  const executeSellOrder = useCallback(() => {
    console.log("Attempting to execute sell order. Current sellOrder state:", sellOrder);
    if (sellOrder.amount && sellOrder.price) {
      const newTrade: TradeHistoryItem = {
        id: Date.now().toString(),
        type: "sell",
        amount: sellOrder.amount,
        price: sellOrder.price,
        total: sellOrder.total,
        timestamp: new Date().toLocaleString(),
        pair: selectedPair,
      };
      setTradeHistory((prev) => [newTrade, ...prev]);
      setSellOrder({
        amount: "",
        price: sellOrder.price, // Keep current price for convenience
        total: "",
        type: "limit",
      });
      console.log("Sell order executed:", newTrade);
    } else {
      console.log("Invalid sell order: amount or price is missing.", sellOrder);
    }
  }, [sellOrder, selectedPair]);

  return {
    settings,
    buyOrder,
    sellOrder,
    selectedExchange,
    selectedAccount,
    selectedMarket,
    selectedPair,
    tradeHistory,
    updateSetting,
    updateBuyOrder,
    updateSellOrder,
    handlePercentageClick,
    executeBuyOrder,
    executeSellOrder,
    setSelectedExchange,
    setSelectedAccount,
    setSelectedMarket,
    setSelectedPair,
  }
}
