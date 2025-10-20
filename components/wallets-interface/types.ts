export interface WalletType {
  id: string
  name: string
  icon: string
  color: string
}

export interface Network {
  id: string
  name: string
  icon: string
  symbol: string
}

export interface Asset {
  symbol: string
  name: string
  balance: number
  usdValue: number
  icon: string
  networkId?: string
}

export interface Transaction {
  id: string
  type: "send" | "receive" | "swap" | "stake" | "nft-buy" | "nft-sell"
  amount: number
  symbol: string
  to: string
  from: string
  timestamp: Date
  status: "confirmed" | "pending" | "failed"
  networkId: string
  fee: number
  usdValue: number
  swapDetails?: {
    fromAmount: number
    fromSymbol: string
    toAmount: number
    toSymbol: string
  }
  stakeDetails?: {
    provider: string
    apy: string
    lockPeriod: string
  }
  nftDetails?: {
    name: string
    collection: string
    image: string
  }
}

export interface NetworkBalance {
  networkId: string
  balance: number
  usdValue: number
  assets: Asset[]
}

export interface Wallet {
  id: string
  name: string
  type: string
  address: string
  totalBalance: number
  networks: NetworkBalance[]
  transactions: Transaction[]
  securityLevel: "low" | "medium" | "high" | "very high"
  lastActivity: Date
}

export interface WalletState {
  activeWallet: string
  activeTab: string
  activeNetwork: string
  showConnectWallet: boolean
  showAddressBook: boolean
  showBackup: boolean
  showSecurity: boolean
}

export interface AddressBookEntry {
  id: string
  name: string
  address: string
  networkId: string
}

export interface NFTCollection {
  id: string
  name: string
  image: string
  collection: string
  networkId: string
  floorPrice?: string
}
