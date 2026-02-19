import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@agentui/react", "@agentui/protocol", "@agentui/validate"],
};

export default nextConfig;
