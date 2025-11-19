/** @type {import('next').NextConfig} */
const nextConfig = {
  // Performance optimizations
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },

  // Image optimization
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },

  // Experimental features for performance
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-icons",
      "framer-motion",
      "recharts",
    ],
    // Enable faster route transitions
    scrollRestoration: true,
  },

  // Ensure ESM packages are handled correctly
  transpilePackages: ['@tanstack/react-table'],

  // Optimize production builds
  productionBrowserSourceMaps: false,
};

export default nextConfig;
