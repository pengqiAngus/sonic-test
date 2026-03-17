/** @type {import('next').NextConfig} */
const nextConfig = {
  typedRoutes: true,
  async headers() {
    if (process.env.NODE_ENV !== "development") {
      return [];
    }

    return [
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
          }
        ]
      }
    ];
  }
};

export default nextConfig;
