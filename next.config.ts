import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  async redirects() {
    return [
      {
        source: '/ceo/dashboard',
        destination: '/dashboard',
        permanent: true,
      },
      {
        source: '/ceo',
        destination: '/dashboard',
        permanent: true,
      },
      {
        source: '/\\(ceo\\)/:path*',
        destination: '/:path*',
        permanent: true,
      },
    ]
  },
};

export default nextConfig;

