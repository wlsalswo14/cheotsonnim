"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";

import { PERSONA_BY_ID } from "@/lib/personas";
import type { RunRecord, Shot } from "@/lib/types";

import { ScoreRing, scoreColor } from "./ScoreRing";
import { describeStep, statusLabel } from "./VisitForm";

const OUTCOME_LABEL = { success: "목표 달성", partial: "부분 달성", fail: "실패", blocked: "입장 거부" } as const;

function shotSrc(shot: Shot): string {
  return `data:image/jpeg;base64,${shot.jpegBase64}`;
}

const subscribeNothing = () => () => undefined;
const readPageUrl = () => window.location.origin + window.location.pathname;
const readServerPageUrl = () => "";

/**
 * The server runs in UTC on Vercel and the reader's browser does not, so a plain
 * toLocaleString made every report page throw React error #418 (hydration text mismatch).
 * Pinning the zone makes both sides print the same Seoul time.
 */
function formatSeoul(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" });
}

/** A percent-encoded Korean path eats three lines and reads like noise. Show it decoded. */
function readableUrl(url: string, limit = 90): string {
  let text = url;
  try {
    text = decodeURI(url);
  } catch {
    // keep the raw form
  }
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

export function ReportView({ record, cached }: { record: RunRecord; cached: boolean }) {
  const [open, setOpen] = useState<Shot | null>(null);
  const [copied, setCopied] = useState(false);
  // The share links need the absolute address, which only the browser knows. Reading
  // window.location while rendering makes the first client render disagree with the
  // server HTML, so the server snapshot stays empty and the value arrives after hydration.
  const pageUrl = useSyncExternalStore(subscribeNothing, readPageUrl, readServerPageUrl);
  const shotById = new Map(record.shots.map((shot) => [shot.id, shot]));
  const landing = record.shots[0];
  const stepShots = record.steps.map((step) => ({ step, shot: step.shotId ? shotById.get(step.shotId) ?? null : null }));
  const color = scoreColor(record.score.total);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const openShot = (id: string | null) => {
    if (!id) return;
    const shot = shotById.get(id);
    if (shot) setOpen(shot);
  };

  const share = async () => {
    const link = window.location.origin + window.location.pathname;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("링크를 복사하세요", link);
    }
  };

  const shareText = `${record.site.host} 첫손님 점수 ${record.score.total}점 · ${record.verdict.oneLiner}`;

  return (
    <main className="wrap report">
      <div className="crumbs">
        <Link href="/">첫손님</Link>
        <span>/</span>
        <Link href="/gallery">방문 기록</Link>
        <span>/</span>
        <span>{record.site.host}</span>
        {cached && <span className="status status--skipped_safety">최근 6시간 안에 다녀간 리뷰</span>}
      </div>

      <section className="card rhero">
        <div className="rhero__main">
          <ScoreRing score={record.score.total} />
          <div>
            <div className="rhero__site">
              {readableUrl(record.site.finalUrl)}
              {record.site.title ? ` · ${record.site.title.slice(0, 60)}` : ""}
            </div>
            <span className="grade" style={{ background: `${color}1f`, color }}>
              {record.score.grade}
            </span>
            <h1>{record.verdict.oneLiner}</h1>
            <p className="rhero__impression">{record.verdict.firstImpression}</p>
          </div>
        </div>
        {landing && (
          <button type="button" className="rhero__shot" onClick={() => setOpen(landing)} aria-label="첫 화면 크게 보기" style={{ cursor: "zoom-in" }}>
            <img src={shotSrc(landing)} alt="첫 화면" />
          </button>
        )}
      </section>

      <section className="card mission">
        <div className="mission__head">
          <span className="card__num" style={{ marginBottom: 0 }}>
            손님의 미션
          </span>
          <span className={`badge badge--${record.degraded ? "unknown" : record.verdict.missionOutcome}`}>
            {record.degraded ? "판정 못 함" : OUTCOME_LABEL[record.verdict.missionOutcome]}
          </span>
        </div>
        <div className="mission__goal">“{record.goalUsed}”</div>
        {record.verdict.missionNarrative && <p className="mission__narr">{record.verdict.missionNarrative}</p>}
        {record.verdict.stuckReason && <div className="stuck">막힌 곳: {record.verdict.stuckReason}</div>}
        {record.status === "blocked" && <div className="stuck">이 사이트는 자동 방문을 차단했습니다(봇 차단 또는 오류 페이지). 손님이 첫 화면을 보지 못해 리뷰는 참고용입니다.</div>}
        {stepShots.length > 0 && (
          <div className="steps">
            {stepShots.map(({ step, shot }) => (
              <button key={step.index} type="button" className="stepcard" onClick={() => shot && setOpen(shot)} disabled={!shot}>
                {shot ? <img src={shotSrc(shot)} alt={shot.label} loading="lazy" /> : <span className="stepcard__noshot">화면이 넘어가는 중이라 사진을 찍지 못했어요</span>}
                <span className="stepcard__body">
                  <span className="stepcard__title">
                    {step.index}. {describeStep(step)} <span className={`status status--${step.status}`}>{statusLabel(step.status)}</span>
                  </span>
                  <span className="stepcard__note">{step.note ?? step.action.why}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="section__head">
          <h2>손님 5명의 리뷰</h2>
          <span className="section__sub">{record.degraded ? "리뷰 없음" : `평균 ${record.score.reviewAvg} / 5`}</span>
        </div>
        {record.degraded && (
          <div className="card">
            <div className="card__num">리뷰 생성 실패</div>
            <h3 style={{ margin: "0 0 6px" }}>{record.degraded.headline}</h3>
            <p style={{ margin: 0, color: "var(--ink-2)" }}>{record.degraded.body}</p>
            <p className="meta-line" style={{ marginTop: 10 }}>
              아래 자동 점검표와 증거 사진은 실제 방문에서 그대로 수집한 것이라 그대로 보실 수 있습니다.
            </p>
          </div>
        )}
        <div className="reviews">
          {record.reviews.map((review) => {
            const persona = PERSONA_BY_ID[review.persona];
            return (
              <article key={review.persona} className="card review">
                <div className="review__who">
                  <span className="review__emoji" aria-hidden>
                    {persona.emoji}
                  </span>
                  <div>
                    <div className="review__name">{persona.name}</div>
                    <div className="review__tag">{persona.tagline}</div>
                  </div>
                </div>
                <div className="stars" aria-label={`${review.rating}점`}>
                  {"★".repeat(review.rating)}
                  <span>{"★".repeat(5 - review.rating)}</span>
                </div>
                <h3>{review.headline}</h3>
                <p>{review.body}</p>
                <div className="review__meta">
                  {review.stuckAt && (
                    <span>
                      <b>막힌 곳</b>
                      {review.stuckAt}
                    </span>
                  )}
                  {review.wish && (
                    <span>
                      <b>바라는 것</b>
                      {review.wish}
                    </span>
                  )}
                  {review.evidenceShotId && (
                    <span>
                      <b>근거</b>
                      <button type="button" className="evlink" onClick={() => openShot(review.evidenceShotId)}>
                        사진 {review.evidenceShotId}
                      </button>
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {record.verdict.fixes.length > 0 && (
        <section>
          <div className="section__head">
            <h2>이것부터 고치면 좋겠어요</h2>
            <span className="section__sub">매니저가 고른 Top {record.verdict.fixes.length}</span>
          </div>
          <div className="fixes">
            {record.verdict.fixes.map((fix, index) => {
              const shot = fix.evidenceShotId ? shotById.get(fix.evidenceShotId) : undefined;
              return (
                <article key={index} className="card fix">
                  <span className="fix__n">{index + 1}</span>
                  <div>
                    <h3>
                      {fix.title}
                      <span className={`impact impact--${fix.impact}`}>{fix.impact === "high" ? "영향 큼" : fix.impact === "medium" ? "중간" : "작음"}</span>
                    </h3>
                    <p>{fix.why}</p>
                  </div>
                  {shot ? (
                    <button type="button" className="fix__shot" onClick={() => setOpen(shot)} aria-label={`근거 사진 ${shot.id}`}>
                      <img src={shotSrc(shot)} alt={shot.label} loading="lazy" />
                    </button>
                  ) : (
                    <span />
                  )}
                </article>
              );
            })}
          </div>
          {record.verdict.praise && (
            <div className="card" style={{ marginTop: 12, background: "var(--good-soft)", borderColor: "#bfe3cf" }}>
              <div className="card__num" style={{ color: "var(--good)" }}>
                잘한 점
              </div>
              <p style={{ color: "#14563a", fontWeight: 600 }}>{record.verdict.praise}</p>
            </div>
          )}
        </section>
      )}

      <section>
        <div className="section__head">
          <h2>자동 점검표</h2>
          <span className="section__sub">
            통과 {record.checks.filter((check) => check.status === "pass").length} · 주의 {record.checks.filter((check) => check.status === "warn").length} · 실패 {record.checks.filter((check) => check.status === "fail").length}
            {record.timings.mobileSkipped ? " · 모바일 재방문은 시간 부족으로 생략" : ""}
          </span>
        </div>
        <div className="checks">
          {record.checks.map((check) => (
            <div key={check.id} className={`check check--${check.status}`}>
              <span className="check__icon" aria-hidden>
                {check.status === "pass" ? "✓" : check.status === "warn" ? "!" : "✕"}
              </span>
              <div>
                <strong>
                  {check.label}
                  {check.viewport === "mobile" ? " · 모바일" : ""}
                </strong>
                <span>{check.detail}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="section__head">
          <h2>점수는 이렇게 계산했어요</h2>
          <span className="section__sub">AI가 점수를 “느낌”으로 매기지 않습니다</span>
        </div>
        <div className="breakdown">
          <div className="bk">
            <div className="bk__label">손님 평점 {record.degraded ? "(리뷰 없음)" : `(평균 ${record.score.reviewAvg}/5)`}</div>
            <div className="bk__val">
              {record.score.reviewPoints}
              <small> / 60</small>
            </div>
            <div className="bk__bar">
              <i style={{ width: `${(record.score.reviewPoints / 60) * 100}%` }} />
            </div>
          </div>
          <div className="bk">
            <div className="bk__label">자동 점검표 (가중 통과율 {Math.round(record.score.checkPassRatio * 100)}%)</div>
            <div className="bk__val">
              {record.score.checkPoints}
              <small> / 25</small>
            </div>
            <div className="bk__bar">
              <i style={{ width: `${(record.score.checkPoints / 25) * 100}%` }} />
            </div>
          </div>
          <div className="bk">
            <div className="bk__label">미션 결과 ({record.degraded ? "판정 못 함" : OUTCOME_LABEL[record.verdict.missionOutcome]})</div>
            <div className="bk__val">
              {record.score.missionPoints}
              <small> / 15</small>
            </div>
            <div className="bk__bar">
              <i style={{ width: `${(record.score.missionPoints / 15) * 100}%` }} />
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="section__head">
          <h2>증거 사진 {record.shots.length}장</h2>
          <span className="section__sub">손님이 실제로 본 화면 그대로</span>
        </div>
        <div className="gallery">
          {record.shots.map((shot) => (
            <button key={shot.id} type="button" className="stepcard" onClick={() => setOpen(shot)}>
              <img src={shotSrc(shot)} alt={shot.label} loading="lazy" />
              <span className="stepcard__body">
                <span className="stepcard__title">
                  {shot.id} · {shot.label}
                </span>
                <span className="stepcard__note">{shot.viewport === "mobile" ? "모바일 390×844" : "데스크톱 1280×800"}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="share">
          <button type="button" className="btn btn--sm" onClick={share}>
            {copied ? "복사됨 ✓" : "리포트 링크 복사"}
          </button>
          <a className="btn btn--sm btn--ghost" href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(pageUrl)}`} target="_blank" rel="noreferrer">
            X에 공유
          </a>
          <a className="btn btn--sm btn--ghost" href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}`} target="_blank" rel="noreferrer">
            LinkedIn에 공유
          </a>
          <Link className="btn btn--sm btn--ghost" href={`/?url=${encodeURIComponent(record.input.url)}&fresh=1`}>
            같은 곳에 손님 다시 보내기
          </Link>
          <Link className="btn btn--sm btn--ghost" href="/">
            다른 곳 방문
          </Link>
        </div>
        <p className="meta-line" style={{ marginTop: 12 }}>
          {formatSeoul(record.createdAt)} · {record.model} · 총 {(Number(record.timings.total ?? 0) / 1000).toFixed(0)}초 · 리포트 {record.id}
        </p>
      </section>

      {open && (
        <div className="lightbox" onClick={() => setOpen(null)} role="dialog" aria-label={open.label}>
          <img src={shotSrc(open)} alt={open.label} />
          <span className="lightbox__cap">
            {open.id} · {open.label} · {readableUrl(open.url, 80)}
          </span>
        </div>
      )}
    </main>
  );
}
