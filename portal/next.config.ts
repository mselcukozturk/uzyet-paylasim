import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // public/index.html remains the source; prebuild/predev stamp the served copy.
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/", destination: "/application.html" },
        { source: "/index.html", destination: "/application.html" },
      ],
    };
  },
  async headers() {
    return [
      {
        source: "/version.json",
        headers: [
          { key: "Cache-Control", value: "no-store, max-age=0" },
          { key: "CDN-Cache-Control", value: "no-store" },
          { key: "Vercel-CDN-Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default nextConfig;
