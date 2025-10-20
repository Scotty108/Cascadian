export interface Asset {
  id: number
  name: string
  symbol: string
  logo: string
  amount: string
  price: number
  change: number
  total: number
  btcValue: number
}

export interface Account {
  id: number
  name: string
  type: string
  avatar: string
  upnl: number
  fundsLocked: number
  change: number
  total: number
}

export interface OverviewStats {
  totalBalance: number
  totalBalanceChange: number
  balanceUpnl: number
  balanceUpnlChange: number
  upnl: number
  upnlChange: number
  freeBalance: number
  freeBalanceChange: number
}

export interface FilterState {
  assetSearch: string
  accountSearch: string
  assetType: string
  accountType: string
}

export interface DateRange {
  start: Date
  end: Date
  label: string
}
