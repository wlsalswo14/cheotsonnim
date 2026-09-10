import { Suspense } from "react";

import { RecentGrid } from "@/components/RecentGrid";
import { VisitForm } from "@/components/VisitForm";
import { PERSONAS } from "@/lib/personas";
import { listRecentHosts } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const recent = await listRecentHosts(8).catch(() => []);
  return (
    <main>
      <section className="wrap hero">
        <div>
          <span className="kicker">AI 미스터리 쇼퍼 · 실제 브라우저 · Gemma 4</span>
          <h1>
            배포 전에, <em>첫 손님</em>을<br />
            먼저 받아 보세요.
          </h1>
          <p className="lead">주소 하나만 주면 AI 손님 5명이 실제 브라우저로 사이트를 직접 써 보고 리뷰를 남깁니다. 스크린샷이 증거이고, 점수 계산은 전부 공개됩니다.</p>
          <p className="lead" style={{ fontSize: 15, color: "var(--muted)" }}>바이브코딩으로 만든 사이트, 새 랜딩페이지, 오늘 배포한 기능. 진짜 사용자를 만나기 전에 60초.</p>
        </div>
        <div className="hero__side">
          <Suspense fallback={<div className="visit-form">불러오는 중…</div>}>
            <VisitForm />
          </Suspense>
        </div>
      </section>

      <section className="wrap section" id="how">
        <div className="section__head">
          <h2>손님은 이렇게 다녀갑니다</h2>
          <span className="section__sub">평균 60~120초</span>
        </div>
        <div className="how">
          <div className="how__step">
            <b>01 도착</b>
            <strong>실제 Chromium으로 방문</strong>
            <span>데스크톱 1280px와 모바일 390px에서 첫 화면을 찍고, 오류·속도·접근성 사실을 수집합니다.</span>
          </div>
          <div className="how__step">
            <b>02 해보기</b>
            <strong>목표를 직접 시도</strong>
            <span>Gemma 4가 화면과 버튼 목록을 보고 최대 6번 클릭·입력합니다. 결제·가입·삭제는 하지 않습니다.</span>
          </div>
          <div className="how__step">
            <b>03 리뷰</b>
            <strong>손님 5명이 각자 리뷰</strong>
            <span>바쁜 손님, 어르신, 모바일, 스크린리더, 깐깐한 손님. 각자 다른 렌즈로 사진을 근거 삼아 씁니다.</span>
          </div>
          <div className="how__step">
            <b>04 점수</b>
            <strong>계산식이 공개된 점수</strong>
            <span>손님 평점 60점 + 자동 점검표 25점 + 미션 성공 15점. AI가 점수를 “느낌”으로 매기지 않습니다.</span>
          </div>
        </div>
      </section>

      <section className="wrap section">
        <div className="section__head">
          <h2>오늘의 손님 5명</h2>
          <span className="section__sub">한 사람의 취향이 아니라 다섯 종류의 사용자</span>
        </div>
        <div className="persona-stack" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
          {PERSONAS.map((persona) => (
            <div key={persona.id} className="persona-chip">
              <span className="persona-chip__emoji" aria-hidden>
                {persona.emoji}
              </span>
              <div>
                <strong>{persona.name}</strong>
                <span>{persona.tagline}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="wrap section">
        <div className="section__head">
          <h2>최근 방문 기록</h2>
          <a className="section__sub" href="/gallery">
            전체 보기 →
          </a>
        </div>
        <RecentGrid entries={recent} />
      </section>
    </main>
  );
}
