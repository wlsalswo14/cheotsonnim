import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "첫손님 — 배포 전에 AI 손님 5명이 먼저 다녀갑니다", template: "%s · 첫손님" },
  description: "실제 브라우저로 직접 써보고 리뷰를 남기는 AI 미스터리 쇼퍼. 주소 하나면 60초 안에 첫 손님 5명의 리뷰와 점검표를 받습니다.",
  openGraph: { siteName: "첫손님", type: "website", locale: "ko_KR" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
      </head>
      <body>
        <SiteHeader />
        {children}
        <footer className="footer">
          <div className="wrap" style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <span>첫손님 · AI 미스터리 쇼퍼 · Gemma 4 + 실제 Chromium</span>
            <span>손님은 결제·가입·삭제를 하지 않고, 비밀번호와 카드 정보를 입력하지 않습니다.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
