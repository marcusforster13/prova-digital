/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['javascript-opentimestamps'],
  },
};

export default nextConfig;
