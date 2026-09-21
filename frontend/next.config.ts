import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Investigations can exceed the proxy's default 30-second timeout.
    proxyTimeout: 120_000,
  },
  rewrites() {
    return [
      {
        source: "/backend/:path*",
        destination: `${process.env.INVESTIGATION_API_URL || "http://127.0.0.1:8000"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
