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

  const width = 400;
  const height = 80;
  const padding = 5;
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

  const isAddress = identifier.match(/^0x[a-fA-F0-9]{40}$/i);
  const address = isAddress ? identifier.toLowerCase() : null;
  const shortAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : identifier;

  // Mock values for now
  const displayName = "@TestTrader";
  const totalPnl = 125420;
  const winRate = 68;
  const positions = 156;
  const isPositive = totalPnl >= 0;
  const sparklineData = [0, 5000, 12000, 8000, 25000, 45000, 38000, 55000, 72000, 95000, 110000, 125420];
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
        {/* Header row */}
        <div style={{ display: "flex", alignItems: "center", marginBottom: 40, width: "100%" }}>
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
            }}
          >
            {displayName.replace("@", "").charAt(0).toUpperCase()}
          </div>
          <div style={{ marginLeft: 24, display: "flex", flexDirection: "column", flexGrow: 1 }}>
            <div style={{ fontSize: 48, fontWeight: 700, color: "#fff" }}>
              {displayName}
            </div>
            <div style={{ fontSize: 22, color: "#71717a" }}>
              {shortAddress}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center" }}>
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
            <div style={{ fontSize: 28, color: "#71717a", fontWeight: 600 }}>
              Cascadian
            </div>
          </div>
        </div>

        {/* Main content row */}
        <div style={{ display: "flex", width: "100%", flexGrow: 1 }}>
          {/* Left - Stats */}
          <div style={{ display: "flex", flexDirection: "column", width: "50%" }}>
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

            <div style={{ display: "flex" }}>
              <div style={{ display: "flex", flexDirection: "column", marginRight: 48 }}>
                <div style={{ fontSize: 18, color: "#71717a" }}>Win Rate</div>
                <div style={{ fontSize: 32, fontWeight: 600, color: "#fff" }}>
                  {winRate}%
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
              width: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 450,
                height: 140,
                backgroundColor: "#18181b",
                borderRadius: 24,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 20,
              }}
            >
              {sparklinePath ? (
                <svg width="400" height="80" viewBox="0 0 400 80">
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
                <div style={{ fontSize: 24, color: "#71717a" }}>
                  No chart data
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            marginTop: "auto",
            display: "flex",
            justifyContent: "space-between",
            paddingTop: 24,
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
    { ...size }
  );
}
