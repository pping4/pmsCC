import { createRequire } from 'module';
const require = createRequire(import.meta.url);

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['next-auth'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  webpack: (config) => {
    // Fix: next-auth uses @babel/runtime/regenerator which requires regenerator-runtime
    config.resolve.alias['@babel/runtime/regenerator'] = require.resolve('regenerator-runtime');
    return config;
  },
};
export default nextConfig;
