"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Check, PlannedAction, Review, ScoreBreakdown, Shot, StepRecord, Verdict, VisitEvent } from "@/lib/types";

const PHASES: { id: string; label: string }[] = [
  { id: "check", label: "주소 검문" },
  { id: "arrive", label: "가게 도착" },
  { id: "plan", label: "둘러보기" },
  { id: "act", label: "직접 해보기" },
  { id: "mobile", label: "휴대폰으로 재방문" },
  { id: "checks", label: "점검표 작성" },
  { id: "deliberate", label: "손님 5명 리뷰" },
  { id: "save", label: "리뷰 게시" },
];

const EXAMPLES = ["wanted.co.kr", "ko.wikipedia.org", "github.com"];

interface LiveState {
  phase: string;
  phaseMsg: string;
  phaseIndex: number;
  shots: Shot[];
  steps: StepRecord[];
  plan: { goal: string; actions: PlannedAction[] } | null;
  checks: Check[] | null;
  reviews: Review[] | null;
  verdict: { verdict: Verdict; score: ScoreBreakdown } | null;
}

const initialLive: LiveState = { phase: "queue", phaseMsg: "손님이 줄을 서는 중", phaseIndex: -1, shots: [], steps: [], plan: null, checks: null, reviews: null, verdict: null };

export function VisitForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [url, setUrl] = useState(() => params.get("url") ?? "");
  const [goal, setGoal] = useState(() => params.get("goal") ?? "");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveState>(initialLive);
  const [selectedShot, setSelectedShot] = useState<string | null>(null);
  const [doneId, setDoneId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const forceFresh = params.get("fresh") === "1";

  useEffect(() => () => abortRef.current?.abort(), []);

  const currentShot = useMemo(() => {
    if (selectedShot) return live.shots.find((shot) => shot.id === selectedShot) ?? null;
    return live.shots[live.shots.length - 1] ?? null;
  }, [live.shots, selectedShot]);

  async function start(event?: React.FormEvent) {
    event?.preventDefault();
    if (running) return;
    setError(null);
    setDoneId(null);
    setSelectedShot(null);
    setLive(initialLive);
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/visit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, goal: goal || null, fresh: forceFresh }),
        signal: controller.signal,
      });
      const type = response.headers.get("content-type") ?? "";
      if (type.includes("application/json")) {
        const data = (await response.json()) as { error?: string; existing?: string };
        if (data.existing) {
          router.push(`/r/${data.existing}?cached=1`);
          return;
        }
        throw new Error(data.error ?? "요청이 실패했습니다.");
      }
      if (!response.ok || !response.body) throw new Error(`서버 오류 (${response.status})`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finishedId: string | null = null;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
          const line = chunk.split("\n").find((entry) => entry.startsWith("data: "));
          if (!line) continue;
          const eventData = JSON.parse(line.slice(6)) as VisitEvent;
          if (eventData.t === "error") throw new Error(eventData.message);
          if (eventData.t === "done") finishedId = eventData.id;
          setLive((prev) => reduce(prev, eventData));
        }
      }
      if (!finishedId) throw new Error("방문이 중간에 끊겼습니다. 다시 시도해 주세요.");
      setDoneId(finishedId);
      setTimeout(() => router.push(`/r/${finishedId}`), 900);
    } catch (caught) {
      if ((caught as Error).name === "AbortError") return;
      setError((caught as Error).message);
      setRunning(false);
    }
  }

  if (running || doneId) {
    return (
      <div className="live" aria-live="polite">
        <div className="live__panel">
          <p className="live__title">방문 진행</p>
          <ol className="phases">
            {PHASES.map((phase, index) => {
              const state = doneId ? "done" : index < live.phaseIndex ? "done" : index === live.phaseIndex ? "active" : "todo";
              return (
                <li key={phase.id} className={`phase phase--${state}`}>
                  <span className="phase__dot" />
                  <span>
                    {phase.label}
                    {state === "active" && <span className="phase__msg">{live.phaseMsg}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
          {live.plan && (
            <>
              <p className="live__title">손님의 목표</p>
              <p style={{ margin: "0 0 12px", fontWeight: 700 }}>{live.plan.goal}</p>
            </>
          )}
          {live.steps.length > 0 && (
            <>
              <p className="live__title">행동 기록</p>
              <div className="steplog">
                {live.steps.map((step) => (
                  <div key={step.index} className="steplog__item">
                    <span className="steplog__idx">{step.index}</span>
                    <span>
                      {describeStep(step)} <span className={`status status--${step.status}`}>{statusLabel(step.status)}</span>
                      <span className="steplog__why">{step.note ?? step.action.why}</span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
          {doneId && (
            <p style={{ marginTop: 16, fontWeight: 700, color: "var(--good)" }}>리뷰가 게시됐습니다. 리포트로 이동합니다…</p>
          )}
        </div>
        <div>
          <div className="viewer">
            {currentShot ? (
              <img src={`data:image/jpeg;base64,${currentShot.jpegBase64}`} alt={currentShot.label} width={currentShot.width} height={currentShot.height} />
            ) : (
              <div className="viewer__empty">
                <div className="spinner" style={{ margin: "0 auto 12px" }} />
                {live.phaseMsg}
              </div>
            )}
            {currentShot && (
              <span className="viewer__label">
                {currentShot.id} · {currentShot.viewport === "mobile" ? "모바일" : "데스크톱"} · {currentShot.label}
              </span>
            )}
          </div>
          {live.shots.length > 1 && (
            <div className="filmstrip">
              {live.shots.map((shot) => (
                <button key={shot.id} type="button" className={currentShot?.id === shot.id ? "is-active" : ""} onClick={() => setSelectedShot(shot.id)} title={shot.label}>
                  <img src={`data:image/jpeg;base64,${shot.jpegBase64}`} alt={shot.label} />
                </button>
              ))}
            </div>
          )}
          {live.verdict && (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="card__num">매니저 총평 · {live.verdict.score.total}점</div>
              <h3>{live.verdict.verdict.oneLiner}</h3>
              <p>{live.verdict.verdict.firstImpression}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <form className="visit-form" onSubmit={start}>
      <div className="field">
        <label htmlFor="url">가게 주소 (웹사이트 URL)</label>
        <input id="url" name="url" placeholder="https://your-site.com" value={url} onChange={(event) => setUrl(event.target.value)} autoComplete="url" inputMode="url" required />
      </div>
      <div className="field">
        <label htmlFor="goal">손님에게 시킬 일 (선택)</label>
        <input id="goal" name="goal" placeholder="예: 가격을 확인하고 무료 체험을 시작해 본다" value={goal} onChange={(event) => setGoal(event.target.value)} maxLength={120} />
      </div>
      {error && <div className="form-error">{error}</div>}
      <button type="submit" className="btn btn--accent" disabled={!url.trim()}>
        손님 보내기 →
      </button>
      <div className="examples">
        <span>예시:</span>
        {EXAMPLES.map((example) => (
          <button key={example} type="button" className="chip" onClick={() => setUrl(example)}>
            {example}
          </button>
        ))}
      </div>
      <p className="form-note">손님 5명이 실제 브라우저(데스크톱·모바일)로 방문해 60~120초 뒤 리뷰를 남깁니다. 결제·가입·삭제는 하지 않고 비밀번호와 카드 정보도 입력하지 않습니다. 같은 주소는 6시간 동안 이전 리뷰를 보여줍니다.</p>
    </form>
  );
}

function reduce(prev: LiveState, event: VisitEvent): LiveState {
  switch (event.t) {
    case "phase": {
      const index = PHASES.findIndex((phase) => phase.id === event.phase);
      return { ...prev, phase: event.phase, phaseMsg: event.msg, phaseIndex: index === -1 ? prev.phaseIndex : Math.max(prev.phaseIndex, index) };
    }
    case "shot":
      return { ...prev, shots: [...prev.shots, event.shot] };
    case "plan":
      return { ...prev, plan: { goal: event.goal, actions: event.actions } };
    case "step":
      return { ...prev, steps: [...prev.steps, event.step] };
    case "checks":
      return { ...prev, checks: event.checks };
    case "reviews":
      return { ...prev, reviews: event.reviews };
    case "verdict":
      return { ...prev, verdict: { verdict: event.verdict, score: event.score } };
    default:
      return prev;
  }
}

export function describeStep(step: StepRecord): string {
  const target = step.targetDescription ? step.targetDescription.replace(/^[a-z]+(\[[^\]]*\])?\s*/, "") : "";
  switch (step.action.type) {
    case "click":
      return `${target} 클릭`;
    case "type":
      return `${target}에 입력`;
    case "press":
      return `${step.action.key ?? "Enter"} 키`;
    case "scroll":
      return "아래로 스크롤";
    case "back":
      return "이전 페이지로";
  }
}

export function statusLabel(status: StepRecord["status"]): string {
  return { done: "완료", failed: "실패", not_found: "못 찾음", skipped_safety: "안전상 건너뜀" }[status];
}
