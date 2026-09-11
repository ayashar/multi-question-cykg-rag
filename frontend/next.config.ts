import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
