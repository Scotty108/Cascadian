import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Wallet Profile";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

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
            T
          </div>
          <div style={{ marginLeft: 24, display: "flex", flexDirection: "column", flexGrow: 1 }}>
            <div style={{ fontSize: 48, fontWeight: 700, color: "#fff" }}>
              @TestTrader
            </div>
            <div style={{ fontSize: 22, color: "#71717a" }}>
              {shortAddress}
            </div>
          </div>
          {/* Cascadian branding */}
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

        {/* Stats */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 20, color: "#71717a", marginBottom: 8 }}>
            Total P&L
          </div>
          <div style={{ fontSize: 72, fontWeight: 700, color: "#00E0AA" }}>
            +$125.4k
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
