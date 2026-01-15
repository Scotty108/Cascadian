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
    return `${x},${y}`;
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
      `https://gamma-api.polymarket.com/users?username=${encodeURIComponent(username)}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Cascadian/1.0)",
        },
      }
    );

    if (response.ok) {
      const users = await response.json();
      if (users && users.length > 0 && users[0].proxyWallet) {
        return users[0].proxyWallet.toLowerCase();
      }
    }
  } catch (e) {
    console.error("Failed to resolve username:", e);
  }

  return null;
}

export default async function Image({
  params,
}: {
  params: Promise<{ identifier: string }>;
}) {
  const { identifier } = await params;

  // Resolve identifier to address
  const address = await resolveIdentifier(identifier);

  if (!address) {
    // Return a simple "not found" image
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

  // Determine base URL
  const baseUrl =
    process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_APP_URL || "https://cascadian.vercel.app";

  let profile: ProfileData = {};
  let walletData: WalletData = {};
  let pnlHistory: PnLDataPoint[] = [];

  try {
    const profileRes = await fetch(
      `${baseUrl}/api/polymarket/wallet/${address}/profile`,
      { next: { revalidate: 3600 } }
    );
    if (profileRes.ok) {
      const profileJson = await profileRes.json();
      if (profileJson.success && profileJson.data) {
        profile = profileJson.data;
      }
    }
  } catch (e) {
    console.error("Failed to fetch profile:", e);
  }

  try {
    const walletRes = await fetch(`${baseUrl}/api/wio/wallet/${address}`, {
      next: { revalidate: 3600 },
    });
    if (walletRes.ok) {
      const walletJson = await walletRes.json();
      if (walletJson.success) {
        walletData = walletJson;
      }
    }
  } catch (e) {
    console.error("Failed to fetch wallet data:", e);
  }

  try {
    const pnlRes = await fetch(
      `${baseUrl}/api/wio/wallet/${address}/pnl-history?period=ALL`,
      { next: { revalidate: 3600 } }
    );
    if (pnlRes.ok) {
      const pnlJson = await pnlRes.json();
      if (pnlJson.success && pnlJson.data) {
        pnlHistory = pnlJson.data;
      }
    }
  } catch (e) {
    console.error("Failed to fetch PnL history:", e);
  }

  const totalPnl =
    walletData.realizedPnl ??
    walletData.metrics?.pnl_total_usd ??
    profile.pnl ??
    0;
  const winRate = walletData.metrics?.win_rate ?? 0;
  const positions = walletData.metrics?.resolved_positions_n ?? 0;
  const isPositive = totalPnl >= 0;

  const sparklineData = pnlHistory.map((d) => d.cumulative_pnl);
  const sparklinePath = generateSparklinePath(sparklineData, 500, 120);

  const displayName = profile.username ? `@${profile.username}` : shortAddress;

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#0a0a0a",
          padding: "60px",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Header with profile */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "24px",
            marginBottom: "40px",
          }}
        >
          {/* Profile picture */}
          {profile.profilePicture ? (
            <img
              src={profile.profilePicture}
              alt=""
              width={100}
              height={100}
              style={{
                borderRadius: "50%",
                border: "4px solid #27272a",
              }}
            />
          ) : (
            <div
              style={{
                width: 100,
                height: 100,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #00E0AA 0%, #00B088 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 40,
                fontWeight: 700,
                color: "#000",
              }}
            >
              {(profile.username || address).charAt(0).toUpperCase()}
            </div>
          )}

          {/* Name and address */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div
              style={{
                fontSize: 48,
                fontWeight: 700,
                color: "#ffffff",
              }}
            >
              {displayName}
            </div>
            {profile.username && (
              <div
                style={{
                  fontSize: 24,
                  color: "#71717a",
                  fontFamily: "monospace",
                }}
              >
                {shortAddress}
              </div>
            )}
          </div>

          {/* Cascadian branding */}
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "12px",
                background: "linear-gradient(135deg, #00E0AA 0%, #00B088 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 28,
                fontWeight: 700,
                color: "#000",
              }}
            >
              C
            </div>
            <span style={{ fontSize: 28, color: "#71717a", fontWeight: 600 }}>
              Cascadian
            </span>
          </div>
        </div>

        {/* Main content area */}
        <div
          style={{
            display: "flex",
            flex: 1,
            gap: "40px",
          }}
        >
          {/* Left side - PnL and stats */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "24px",
              flex: 1,
            }}
          >
            {/* Total PnL */}
            <div
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
              <div style={{ fontSize: 20, color: "#71717a", fontWeight: 500 }}>
                Total P&L
              </div>
              <div
                style={{
                  fontSize: 72,
                  fontWeight: 700,
                  color: isPositive ? "#00E0AA" : "#ef4444",
                }}
              >
                {formatPnL(totalPnl)}
              </div>
            </div>

            {/* Stats row */}
            <div style={{ display: "flex", gap: "48px", marginTop: "16px" }}>
              <div
                style={{ display: "flex", flexDirection: "column", gap: "4px" }}
              >
                <div style={{ fontSize: 18, color: "#71717a" }}>Win Rate</div>
                <div
                  style={{ fontSize: 32, fontWeight: 600, color: "#ffffff" }}
                >
                  {(winRate * 100).toFixed(0)}%
                </div>
              </div>
              <div
                style={{ display: "flex", flexDirection: "column", gap: "4px" }}
              >
                <div style={{ fontSize: 18, color: "#71717a" }}>Positions</div>
                <div
                  style={{ fontSize: 32, fontWeight: 600, color: "#ffffff" }}
                >
                  {positions.toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          {/* Right side - Sparkline chart */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 520,
              height: 200,
              backgroundColor: "#18181b",
              borderRadius: "24px",
              padding: "20px",
            }}
          >
            {sparklineData.length > 1 ? (
              <svg width="500" height="120" viewBox="0 0 500 120">
                <defs>
                  <linearGradient
                    id="areaGradient"
                    x1="0%"
                    y1="0%"
                    x2="0%"
                    y2="100%"
                  >
                    <stop
                      offset="0%"
                      stopColor={isPositive ? "#00E0AA" : "#ef4444"}
                      stopOpacity="0.3"
                    />
                    <stop
                      offset="100%"
                      stopColor={isPositive ? "#00E0AA" : "#ef4444"}
                      stopOpacity="0"
                    />
                  </linearGradient>
                </defs>
                <path
                  d={`${sparklinePath} L 490,110 L 10,110 Z`}
                  fill="url(#areaGradient)"
                />
                <path
                  d={sparklinePath}
                  fill="none"
                  stroke={isPositive ? "#00E0AA" : "#ef4444"}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : (
              <div style={{ fontSize: 24, color: "#71717a" }}>No chart data</div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "auto",
            paddingTop: "24px",
            borderTop: "1px solid #27272a",
          }}
        >
          <div style={{ fontSize: 20, color: "#52525b" }}>
            Polymarket Trading Analytics
          </div>
          <div style={{ fontSize: 20, color: "#52525b" }}>cascadian.ai</div>
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
