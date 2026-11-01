import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@liendo/shared"],
  serverExternalPackages: ["sharp", "bcryptjs", "pg", "qrcode"],
  skipTrailingSlashRedirect: true,
  async headers() {
    return [
      {
        source: "/.well-known/apple-app-site-association",
        headers: [{ key: "content-type", value: "application/json" }],
      },
      {
        source: "/.well-known/apple-app-site-association/",
        headers: [{ key: "content-type", value: "application/json" }],
      },
    ];
  },
};

export default nextConfig;
