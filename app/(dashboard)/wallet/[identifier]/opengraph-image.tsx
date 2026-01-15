import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Wallet Profile";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

function formatPnL(value: number): string {
  const abs = Math.abs(value);
  const sign = value >= 0 ? "+" : "-";
  if (abs >= 1000000) return `${sign}$${(abs / 1000000).toFixed(2)}M`;
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}

function generateSparklinePath(data: number[]): string {
  if (data.length < 2) return "";

  const width = 460;
  const height = 100;
  const padding = 10;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((value, index) => {
    const x = padding + (index / (data.length - 1)) * (width - 2 * padding);
    const y = height - padding - ((value - min) / range) * (height - 2 * padding);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return `M ${points.join(" L ")}`;
}

export default async function Image({
  params,
}: {
  params: Promise<{ identifier: string }>;
}) {
  const { identifier } = await params;

  // Check if it's a valid address
  const isAddress = identifier.match(/^0x[a-fA-F0-9]{40}$/i);
  const address = isAddress ? identifier.toLowerCase() : null;
  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : identifier;

  // Default values
  let displayName = shortAddress;
  let totalPnl = 0;
  let winRate = 0;
  let positions = 0;
  let sparklineData: number[] = [];

  // Only fetch data if we have a valid address
  if (address) {
    const baseUrl = "https://cascadian.vercel.app";

    try {
      // Fetch PnL history (most important for the chart)
      const pnlRes = await fetch(
        `${baseUrl}/api/wio/wallet/${address}/pnl-history?period=ALL`
      );
      if (pnlRes.ok) {
        const json = await pnlRes.json();
        if (json.success && Array.isArray(json.data)) {
          sparklineData = json.data.map((d: { cumulative_pnl: number }) => d.cumulative_pnl);
          // Get total from the last data point
          if (sparklineData.length > 0) {
            totalPnl = sparklineData[sparklineData.length - 1];
          }
        }
      }
    } catch {
      // Continue with defaults
    }

    try {
      // Fetch wallet metrics
      const walletRes = await fetch(`${baseUrl}/api/wio/wallet/${address}`);
      if (walletRes.ok) {
        const json = await walletRes.json();
        if (json.success) {
          if (json.realizedPnl) totalPnl = json.realizedPnl;
          if (json.metrics?.win_rate) winRate = json.metrics.win_rate;
          if (json.metrics?.resolved_positions_n) positions = json.metrics.resolved_positions_n;
        }
      }
    } catch {
      // Continue with defaults
    }

    try {
      // Fetch profile for username
      const profileRes = await fetch(
        `${baseUrl}/api/polymarket/wallet/${address}/profile`
      );
      if (profileRes.ok) {
        const json = await profileRes.json();
        if (json.success && json.data?.username) {
          displayName = `@${json.data.username}`;
        }
      }
    } catch {
      // Continue with defaults
    }
  }

  const isPositive = totalPnl >= 0;
  const sparklinePath = generateSparklinePath(sparklineData);

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
            {displayName.replace("@", "").charAt(0).toUpperCase()}
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 48, fontWeight: 700, color: "#fff" }}>
              {displayName}
            </div>
            {displayName.startsWith("@") && (
              <div style={{ fontSize: 22, color: "#71717a" }}>
                {shortAddress}
              </div>
            )}
          </div>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
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
              width: 500,
              height: 160,
              backgroundColor: "#18181b",
              borderRadius: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
            }}
          >
            {sparklinePath ? (
              <svg width="460" height="100" viewBox="0 0 460 100">
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
