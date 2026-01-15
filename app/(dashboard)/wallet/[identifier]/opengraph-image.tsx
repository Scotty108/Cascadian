import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Wallet Profile";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

interface PnLDataPoint {
  timestamp: string;
  cumulative_pnl: number;
}

interface ProfileData {
  username?: string;
  profilePicture?: string;
  pnl?: number;
}

interface WalletData {
  metrics?: {
    pnl_total_usd?: number;
    roi_cost_weighted?: number;
    win_rate?: number;
    resolved_positions_n?: number;
  };
  realizedPnl?: number;
}

function formatPnL(value: number): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? "+" : "-";
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(2)}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function generateSparklinePath(
  data: number[],
  width: number,
  height: number,
  padding: number = 10
): string {
  if (data.length < 2) return "";

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((value, index) => {
    const x = padding + (index / (data.length - 1)) * (width - 2 * padding);
    const y =
      height - padding - ((value - min) / range) * (height - 2 * padding);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return `M ${points.join(" L ")}`;
}

// Resolve username to address
async function resolveIdentifier(identifier: string): Promise<string | null> {
  if (identifier.match(/^0x[a-fA-F0-9]{40}$/i)) {
    return identifier.toLowerCase();
  }

  const username = identifier.startsWith("@") ? identifier.slice(1) : identifier;

  try {
    const response = await fetch(
      `https://gamma-api.polymarket.com/users?username=${encodeURIComponent(username)}`
    );

    if (response.ok) {
      const users = await response.json();
      if (users && users.length > 0 && users[0].proxyWallet) {
        return users[0].proxyWallet.toLowerCase();
      }
    }
  } catch (e) {
    // Ignore
  }

  return null;
}

export default async function Image({
  params,
}: {
  params: Promise<{ identifier: string }>;
}) {
  const { identifier } = await params;
  const address = await resolveIdentifier(identifier);

  if (!address) {
    return new ImageResponse(
      (
        <div
          style={{
            height: "100%",
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "#0a0a0a",
            color: "#71717a",
            fontSize: 48,
          }}
        >
          Wallet Not Found
        </div>
      ),
      { ...size }
    );
  }

  const shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;
  const baseUrl = "https://cascadian.vercel.app";

  let profile: ProfileData = {};
  let walletData: WalletData = {};
  let pnlHistory: PnLDataPoint[] = [];

  // Fetch data with timeout
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const [profileRes, walletRes, pnlRes] = await Promise.all([
      fetch(`${baseUrl}/api/polymarket/wallet/${address}/profile`, {
        signal: controller.signal,
      }).catch(() => null),
      fetch(`${baseUrl}/api/wio/wallet/${address}`, {
        signal: controller.signal,
      }).catch(() => null),
      fetch(`${baseUrl}/api/wio/wallet/${address}/pnl-history?period=ALL`, {
        signal: controller.signal,
      }).catch(() => null),
    ]);

    clearTimeout(timeout);

    if (profileRes?.ok) {
      const json = await profileRes.json();
      if (json.success && json.data) profile = json.data;
    }

    if (walletRes?.ok) {
      const json = await walletRes.json();
      if (json.success) walletData = json;
    }

    if (pnlRes?.ok) {
      const json = await pnlRes.json();
      if (json.success && Array.isArray(json.data)) pnlHistory = json.data;
    }
  } catch (e) {
    // Continue with defaults
  }

  const totalPnl = walletData.realizedPnl ?? walletData.metrics?.pnl_total_usd ?? profile.pnl ?? 0;
  const winRate = walletData.metrics?.win_rate ?? 0;
  const positions = walletData.metrics?.resolved_positions_n ?? 0;
  const isPositive = totalPnl >= 0;
  const displayName = profile.username ? `@${profile.username}` : shortAddress;

  // Generate sparkline
  const sparklineData = pnlHistory.map((d) => d.cumulative_pnl);
  const sparklinePath = generateSparklinePath(sparklineData, 480, 100);

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#0a0a0a",
          padding: 60,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 40 }}>
          {/* Avatar */}
          <div
            style={{
              width: 100,
              height: 100,
              borderRadius: 50,
              backgroundColor: "#00E0AA",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 40,
              fontWeight: 700,
              color: "#000",
              marginRight: 24,
            }}
          >
            {(profile.username || address).charAt(0).toUpperCase()}
          </div>

          {/* Name */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 48, fontWeight: 700, color: "#fff" }}>
              {displayName}
            </div>
            {profile.username && (
              <div style={{ fontSize: 24, color: "#71717a" }}>
                {shortAddress}
              </div>
            )}
          </div>

          {/* Branding */}
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 12,
                backgroundColor: "#00E0AA",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                fontWeight: 700,
                color: "#000",
                marginRight: 12,
              }}
            >
              C
            </div>
            <span style={{ fontSize: 28, color: "#71717a", fontWeight: 600 }}>
              Cascadian
            </span>
          </div>
        </div>

        {/* Main content */}
        <div style={{ display: "flex", flex: 1 }}>
          {/* Left - Stats */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ fontSize: 20, color: "#71717a", marginBottom: 8 }}>
              Total P&L
            </div>
            <div
              style={{
                fontSize: 72,
                fontWeight: 700,
                color: isPositive ? "#00E0AA" : "#ef4444",
                marginBottom: 24,
              }}
            >
              {formatPnL(totalPnl)}
            </div>

            <div style={{ display: "flex", gap: 48 }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 18, color: "#71717a" }}>Win Rate</div>
                <div style={{ fontSize: 32, fontWeight: 600, color: "#fff" }}>
                  {(winRate * 100).toFixed(0)}%
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 18, color: "#71717a" }}>Positions</div>
                <div style={{ fontSize: 32, fontWeight: 600, color: "#fff" }}>
                  {positions}
                </div>
              </div>
            </div>
          </div>

          {/* Right - Chart */}
          <div
            style={{
              width: 520,
              height: 180,
              backgroundColor: "#18181b",
              borderRadius: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
            }}
          >
            {sparklinePath ? (
              <svg width="480" height="100" viewBox="0 0 480 100">
                <path
                  d={sparklinePath}
                  fill="none"
                  stroke={isPositive ? "#00E0AA" : "#ef4444"}
                  strokeWidth="3"
                />
              </svg>
            ) : (
              <div style={{ fontSize: 24, color: "#71717a" }}>
                No chart data
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            paddingTop: 24,
            borderTop: "1px solid #27272a",
            marginTop: "auto",
          }}
        >
          <div style={{ fontSize: 20, color: "#52525b" }}>
            Polymarket Trading Analytics
          </div>
          <div style={{ fontSize: 20, color: "#52525b" }}>cascadian.ai</div>
        </div>
      </div>
    ),
    { ...size }
  );
}
