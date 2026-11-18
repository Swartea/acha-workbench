import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // node:sqlite 是 Node 内置模块，交给运行时处理，不打进 bundle
  serverExternalPackages: [],
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
};

export default nextConfig;
