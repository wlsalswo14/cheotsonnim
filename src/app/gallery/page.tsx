import type { Metadata } from "next";

import { RecentGrid } from "@/components/RecentGrid";
import { listRecent } from "@/lib/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "방문 기록" };

export default async function GalleryPage() {
  const entries = await listRecent().catch(() => []);
  return (
    <main className="wrap section">
      <div className="section__head">
        <h2>방문 기록</h2>
        <span className="section__sub">최근 {entries.length}건</span>
      </div>
      <RecentGrid entries={entries} />
    </main>
  );
}
