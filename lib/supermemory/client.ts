/**
 * Supermemory Client for Cascadian
 *
 * Provides AI memory capabilities for wallet analysis, trading insights,
 * and personalized user experiences.
 */

import Supermemory from 'supermemory';

// Singleton client
let client: Supermemory | null = null;

export function getSupermemoryClient(): Supermemory {
  if (!client) {
    const apiKey = process.env.SUPERMEMORY_API_KEY;
    if (!apiKey) {
      throw new Error('SUPERMEMORY_API_KEY not configured');
    }
    client = new Supermemory({ apiKey });
  }
  return client;
}

/**
 * Add a memory for a user
 */
export async function addMemory(
  userId: string,
  content: string,
  metadata?: Record<string, string>
) {
  const client = getSupermemoryClient();
  return client.add({
    content,
    containerTag: userId,
    metadata: {
      source: 'cascadian',
      timestamp: new Date().toISOString(),
      ...metadata,
    },
  });
}

/**
 * Search memories for a user
 * Note: Uses v3/search with containerTags (array) for compatibility
 */
export async function searchMemories(
  userId: string,
  query: string,
  options?: { limit?: number; searchMode?: 'hybrid' | 'memories' }
) {
  const client = getSupermemoryClient();
  // SDK's search.documents method uses v3 endpoint with containerTags array
  return client.search.documents({
    q: query,
    containerTags: [userId],
    limit: options?.limit ?? 5,
  } as any);
}

/**
 * Get user profile with optional search
 */
export async function getUserProfile(
  userId: string,
  query?: string
) {
  const client = getSupermemoryClient();
  return client.profile({
    containerTag: userId,
    ...(query && { q: query }),
  });
}

/**
 * Store a wallet analysis conversation
 */
export async function storeWalletAnalysis(
  userId: string,
  walletAddress: string,
  analysis: string,
  metrics?: {
    pnl?: number;
    winRate?: number;
    totalTrades?: number;
  }
) {
  return addMemory(
    userId,
    `Wallet analysis for ${walletAddress}:\n${analysis}`,
    {
      type: 'wallet_analysis',
      walletAddress,
      ...(metrics?.pnl !== undefined && { pnl: String(metrics.pnl) }),
      ...(metrics?.winRate !== undefined && { winRate: String(metrics.winRate) }),
      ...(metrics?.totalTrades !== undefined && { totalTrades: String(metrics.totalTrades) }),
    }
  );
}

/**
 * Store a trading insight or pattern
 */
export async function storeTradingInsight(
  userId: string,
  insight: string,
  category: 'pattern' | 'strategy' | 'market' | 'alert'
) {
  return addMemory(userId, insight, {
    type: 'trading_insight',
    category,
  });
}

/**
 * Get relevant context for AI responses
 */
export async function getAIContext(
  userId: string,
  userMessage: string
): Promise<string> {
  try {
    const { profile, searchResults } = await getUserProfile(userId, userMessage);

    const parts: string[] = [];

    if (profile?.static?.length) {
      parts.push(`User facts: ${profile.static.join('; ')}`);
    }

    if (profile?.dynamic?.length) {
      parts.push(`Recent context: ${profile.dynamic.join('; ')}`);
    }

    if (searchResults?.results?.length) {
      const memories = (searchResults.results as any[])
        .slice(0, 3)
        .map((r) => r.memory || r.chunk)
        .filter(Boolean);
      if (memories.length) {
        parts.push(`Relevant memories:\n${memories.join('\n')}`);
      }
    }

    return parts.join('\n\n');
  } catch (error) {
    console.error('Error getting AI context:', error);
    return '';
  }
}
