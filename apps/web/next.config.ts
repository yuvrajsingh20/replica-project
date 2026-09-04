import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@rule-engine/db', '@rule-engine/shared', '@rule-engine/engine'],
};

export default nextConfig;
