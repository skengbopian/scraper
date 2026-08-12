/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // The browser talks to the API through this rewrite, so the page never needs an absolute origin
  // and the two never disagree about CORS. Server components call the API directly (see lib/api.ts).
  async rewrites() {
    const api = process.env.API_URL ?? 'http://localhost:3900';
    return [{ source: '/api/:path*', destination: `${api}/:path*` }];
  },
};
