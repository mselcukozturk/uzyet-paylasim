import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Kök adres, ayrı bir GitHub Pages/kullanıcı adı gerektirmeden, statik paylaşım
  // sitesini (public/index.html) sunar. /admin ve /api/* değişmez.
  async rewrites() {
    return [{ source: '/', destination: '/index.html' }];
  },
};

export default nextConfig;
