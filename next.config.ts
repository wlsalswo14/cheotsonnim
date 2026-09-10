import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["playwright-core", "playwright", "@sparticuz/chromium"],
  outputFileTracingIncludes: {
    "/api/visit": ["./fonts/**/*", "./node_modules/@sparticuz/chromium/bin/**/*"],
  },
  outputFileTracingExcludes: {
    "/*": ["./node_modules/playwright/**/*", "./.data/**/*"],
  },
  images: { unoptimized: true },
};

export default nextConfig;
