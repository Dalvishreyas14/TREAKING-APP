import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";

// The Prisma 7 client is generated into src/generated and must never be bundled
// into the client. `serverExternalPackages` keeps @prisma/client, the pg driver
// and the argon2 native module on the server only.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  turbopack: {
    // This project lives under the user's home directory, which also holds a
    // package-lock.json. Without an explicit root, Turbopack walks up, refuses
    // that lockfile and silently treats the home directory as the project.
    root: process.cwd(),
  },
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-pg",
    "pg",
    "@node-rs/argon2",
  ],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
  experimental: {
    // Server Actions accept only same-origin requests in production.
    serverActions: { allowedOrigins: [] },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

// withSerwist teaches Turbopack how to reach Serwist's route handler and injects
// the precache manifest into the generated service worker.
export default withSerwist(nextConfig);
