// lib/polymarket/resolver.ts
// Helper functions for proxy resolution and ERC1155 decoding

export type ProxyInfo = {
  user_eoa: string;
  proxy_wallet: string;
  source: "api" | "inferred";
};

/**
 * Resolve proxy wallet via Polymarket API
 * Query endpoint: https://strapi-matic.poly.market/user/trades?user={eoa}&limit=1
 */
export async function resolveProxyViaAPI(eoa: string): Promise<ProxyInfo | null> {
  try {
    const url = `https://strapi-matic.poly.market/user/trades?user=${eoa}&limit=1`;
    const r = await fetch(url, {
      headers: { accept: "application/json" },
      timeout: 5000,
    });

    if (!r.ok) return null;

    const js = (await r.json()) as any;
    const proxy =
      js?.proxyWallet ||
      js?.proxy_wallet ||
      js?.trades?.[0]?.proxyWallet ||
      null;

    if (!proxy || typeof proxy !== "string") return null;

    return {
      user_eoa: eoa.toLowerCase(),
      proxy_wallet: proxy.toLowerCase(),
      source: "api",
    };
  } catch (e) {
    return null;
  }
}

/**
 * Pad 20-byte address to 32 bytes (0x-prefixed)
 */
export function pad32Hex(addr: string): string {
  const a = addr.toLowerCase().replace(/^0x/, "");
  return "0x" + "0".repeat(64 - a.length) + a;
}

/**
 * Extract address from 32-byte padded topic
 */
export function topicToAddress(topic: string): string {
  if (!topic) return "0x0000000000000000000000000000000000000000";
  const addr = topic.slice(-40);
  return "0x" + addr;
}

/**
 * Parse uint256 from hex string
 */
export function hexToUint256(hex: string): bigint {
  if (!hex || hex === "0x") return 0n;
  try {
    return BigInt(hex);
  } catch {
    return 0n;
  }
}
