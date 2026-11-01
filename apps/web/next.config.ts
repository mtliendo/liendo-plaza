import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@liendo/shared"],
  serverExternalPackages: ["sharp", "bcryptjs", "pg"],
};

export default nextConfig;
