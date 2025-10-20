"use client"

import { TradingHeader } from "./components/trading-header"
import { BalanceSummary } from "./components/balance-summary"
import { MarketSummary } from "./components/market-summary"
import { PriceChart } from "./components/price-chart"
import { OrderBook } from "./components/order-book"
import { TradingTabs } from "./components/trading-tabs"
import { TradeHistory } from "./components/trade-history"
import { useTrading } from "./hooks/use-trading"

export function TradingInterface() {
  const {
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
  } = useTrading()

  const handleFullscreenToggle = () => {
    updateSetting("fullscreen", !settings.fullscreen)
  }

  return (
    <div className="flex flex-col gap-6">
      <TradingHeader
        selectedExchange={selectedExchange}
        selectedAccount={selectedAccount}
        selectedMarket={selectedMarket}
        selectedPair={selectedPair}
        settings={settings}
        onExchangeChange={setSelectedExchange}
        onAccountChange={setSelectedAccount}
        onMarketChange={setSelectedMarket}
        onPairChange={setSelectedPair}
        onSettingChange={updateSetting}
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <BalanceSummary />
        <MarketSummary pair={selectedPair} />
      </div>

      <div className="md:grid gap-4 md:grid-cols-3 max-md:space-y-4">
        <PriceChart pair={selectedPair}   />
        <OrderBook />
      </div>

      <TradingTabs
        buyOrder={buyOrder}
        sellOrder={sellOrder}
        onBuyOrderChange={updateBuyOrder}
        onSellOrderChange={updateSellOrder}
        onBuyPercentageClick={(percentage) => handlePercentageClick(percentage, "buy")}
        onSellPercentageClick={(percentage) => handlePercentageClick(percentage, "sell")}
        onExecuteBuy={executeBuyOrder}
        onExecuteSell={executeSellOrder}
      />

      <TradeHistory history={tradeHistory} />
    </div>
  )
}
