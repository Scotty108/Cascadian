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

  // Simple static test
  const shortAddress = identifier.match(/^0x[a-fA-F0-9]{40}$/i)
    ? `${identifier.slice(0, 6)}...${identifier.slice(-4)}`
    : identifier;

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0a0a0a",
        }}
      >
        <div
          style={{
            width: 120,
            height: 120,
            borderRadius: 60,
            backgroundColor: "#00E0AA",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 48,
            fontWeight: 700,
            color: "#000",
            marginBottom: 32,
          }}
        >
          {shortAddress.charAt(0).toUpperCase()}
        </div>
        <div
          style={{
            fontSize: 48,
            fontWeight: 700,
            color: "#ffffff",
            marginBottom: 16,
          }}
        >
          {shortAddress}
        </div>
        <div
          style={{
            fontSize: 24,
            color: "#71717a",
          }}
        >
          Cascadian Wallet Profile
        </div>
      </div>
    ),
    { ...size }
  );
}
