import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ['@janus/contracts', '@janus/validation'],
  typedRoutes: true,
};

export default nextConfig;
