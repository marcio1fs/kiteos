import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  allowedDevOrigins: [
    '.space-z.ai',
    '.space.chatglm.site',
  ],
};

export default nextConfig;
