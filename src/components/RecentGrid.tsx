import Link from "next/link";

import type { RecentEntry } from "@/lib/types";

import { scoreColor } from "./ScoreRing";

export function RecentGrid({ entries, emptyText = "아직 방문 기록이 없습니다. 첫 손님을 보내 보세요." }: { entries: RecentEntry[]; emptyText?: string }) {
  if (entries.length === 0) return <div className="empty">{emptyText}</div>;
  return (
    <div className="grid">
      {entries.map((entry) => (
        <Link key={entry.id} href={`/r/${entry.id}`} className="rcard">
          <div className="rcard__thumb">{entry.thumbBase64 && <img src={`data:image/jpeg;base64,${entry.thumbBase64}`} alt={`${entry.host} 첫 화면`} loading="lazy" />}</div>
          <div className="rcard__body">
            <span className="rcard__host">{entry.host}</span>
            <span className="rcard__line">{entry.oneLiner}</span>
            <span className="rcard__score">
              <span className="score-pill" style={{ background: scoreColor(entry.score) }}>
                {entry.score}
              </span>
              {entry.grade}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
