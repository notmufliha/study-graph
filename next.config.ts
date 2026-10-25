import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents / partialPrefetching were removed on purpose: every note
  // lives in the browser (IndexedDB), so pages render client-side and there is
  // no server data to cache. Keeping it off also lets `notes/[id]` stay a plain
  // client route without Suspense boundaries around useParams.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
