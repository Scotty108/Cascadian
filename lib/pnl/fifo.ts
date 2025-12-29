
export interface Position {
  size: number;
  price: number;
  timestamp: number;
}

export function calculateRealizedPnl(
  inventory: Position[],
  quantity: number,
  price: number
): number {
  let realizedPnl = 0;
  let remainingQuantity = quantity;

  while (remainingQuantity > 0 && inventory.length > 0) {
    const position = inventory[0];
    const tradeSize = Math.min(remainingQuantity, position.size);

    realizedPnl += tradeSize * (price - position.price);
    position.size -= tradeSize;
    remainingQuantity -= tradeSize;

    if (position.size === 0) {
      inventory.shift();
    }
  }

  return realizedPnl;
}

export function calculateUnrealizedPnl(
  inventory: Position[],
  currentPrice: number | boolean
): number {
  let unrealizedPnl = 0;
  if(typeof currentPrice === 'boolean') {
    return unrealizedPnl;
  }
  for (const position of inventory) {
    unrealizedPnl += position.size * (currentPrice - position.price);
  }

  return unrealizedPnl;
}
