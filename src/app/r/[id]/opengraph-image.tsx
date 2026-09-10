import { ImageResponse } from "next/og";

import { scoreColor } from "@/components/ScoreRing";
import { PERSONAS } from "@/lib/personas";
import { loadRun } from "@/lib/store";

export const alt = "첫손님 리포트";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

async function loadKoreanFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@700&text=${encodeURIComponent(text)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:11.0) Gecko/20100101 Firefox/11.0" },
    }).then((response) => response.text());
    const match = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:opentype|truetype)'\)/);
    if (!match) return null;
    return await fetch(match[1]).then((response) => response.arrayBuffer());
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await loadRun(id);
  const host = record?.site.host ?? "첫손님";
  const score = record?.score.total ?? 0;
  const grade = record?.score.grade ?? "리포트";
  const line = record?.verdict.oneLiner ?? "AI 손님 5명이 실제 브라우저로 다녀갔습니다";
  const ratings = record?.reviews.map((review) => review.rating) ?? [];
  const color = scoreColor(score);
  const text = `${host}${score}${grade}${line}첫손님 리뷰 점 / 100${PERSONAS.map((persona) => persona.name).join("")}0123456789`;
  const font = await loadKoreanFont(text);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#f6f1e8", color: "#1c1a17", fontFamily: font ? "NotoKR" : "sans-serif", padding: 56 }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontWeight: 700 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "#e4532a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>첫</div>
            첫손님 리뷰
            <span style={{ fontSize: 22, color: "#6f685d", marginLeft: 8 }}>{host}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 48 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 260, height: 260, borderRadius: 130, border: `18px solid ${color}`, background: "#fff" }}>
              {/* satori counts a numeric child as several nodes and then demands display:flex — keep it a string. */}
              <div style={{ fontSize: 104, fontWeight: 700, color, lineHeight: 1 }}>{String(score)}</div>
              <div style={{ fontSize: 22, color: "#6f685d" }}>점 / 100</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 18, flex: 1 }}>
              <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color, background: `${color}22`, padding: "6px 16px", borderRadius: 12, alignSelf: "flex-start" }}>{grade}</div>
              <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.25, letterSpacing: -1 }}>{line}</div>
              {ratings.length > 0 && (
                <div style={{ display: "flex", gap: 18, fontSize: 24, color: "#6f685d" }}>
                  {PERSONAS.map((persona, index) => (
                    <div key={persona.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                      <span style={{ fontSize: 30 }}>{persona.emoji}</span>
                      {/* The Google subset has no ★ glyph and the dynamic fallback 400s, so print the number. */}
                      <span style={{ color: "#e4532a", fontSize: 20, fontWeight: 700 }}>{`${ratings[index] ?? 0}점`}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 22, color: "#6f685d" }}>AI 손님 5명이 실제 브라우저로 다녀갔습니다 · 사진이 증거 · 점수 계산 공개</div>
        </div>
      </div>
    ),
    { ...size, fonts: font ? [{ name: "NotoKR", data: font, style: "normal", weight: 700 }] : undefined },
  );
}
