import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@kibadist/agentui-react", "@kibadist/agentui-protocol", "@kibadist/agentui-validate"],
};

export default nextConfig;
