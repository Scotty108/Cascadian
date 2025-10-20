export interface MarketMapTile {
  marketId: string;
  title: string;              // Truncated to fit tile
  category: string;
  sii: number;               // -100 to +100 (determines color)
  volume24h: number;         // Determines tile size
  currentPrice: number;      // Displayed on tile
}
