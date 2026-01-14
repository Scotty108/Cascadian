import { redirect } from "next/navigation";

export const metadata = {
  title: "CASCADIAN",
  description: "Discover and analyze prediction markets on Polymarket",
};

export default function Home() {
  // Temporarily redirect to Events page while market screener is being revamped
  redirect("/discovery/market-insights");
}
