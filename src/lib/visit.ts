import type { Browser } from "playwright-core";

import { collectFacts, inventory, formatInventory, launchBrowser, navigate, openSession, performAction, screenshotJpeg, thumbnail, type InventoryItem, type PageSession } from "./browser";
import { buildChecks, summarizeChecks } from "./checks";
import { DEFAULT_MODEL, GemmaError, generateJson, imagePart, type GemmaPart } from "./gemma";
import { PERSONAS } from "./personas";
import { DELIBERATION_SYSTEM, PLAN_SYSTEM, deliberationUserText, normalizePlan, planUserText, type DeliberationResponse, type PlanResponse } from "./prompts";
import { computeScore } from "./score";
import { newRunId, pushRecent, saveRun } from "./store";
import type { Fix, MissionOutcome, PageFacts, PersonaId, PlannedAction, Review, RunRecord, Shot, StepRecord, Verdict, VisitEvent } from "./types";
import { assertPublicHost, normalizeInputUrl } from "./url-safety";

export interface VisitInput {
  url: string;
  goal: string | null;
  emit: (event: VisitEvent) => void;
}

const TOTAL_BUDGET_MS = 235_000;
const MAX_STEPS = 6;

class Clock {
  readonly started = Date.now();
  readonly marks: Record<string, number> = {};
  elapsed(): number {
    return Date.now() - this.started;
  }
  remaining(): number {
    return TOTAL_BUDGET_MS - this.elapsed();
  }
  mark(name: string, from: number): void {
    this.marks[name] = Date.now() - from;
  }
}

export async function runVisit(input: VisitInput): Promise<RunRecord> {
  const clock = new Clock();
  const emit = input.emit;
  const shots: Shot[] = [];
  const steps: StepRecord[] = [];
  let shotCounter = 0;

  const snap = async (session: PageSession, label: string): Promise<Shot | null> => {
    const image = await screenshotJpeg(session);
    // A page that is mid-navigation can refuse every capture attempt. The visit continues
    // without that photo; the step, the jury prompt and the report all tolerate shotId: null.
    if (!image) return null;
    shotCounter += 1;
    const shot: Shot = {
      id: `S${shotCounter}`,
      viewport: session.viewport,
      label,
      jpegBase64: image.base64,
      width: image.width,
      height: image.height,
      url: image.url,
      takenAt: clock.elapsed(),
    };
    shots.push(shot);
    emit({ t: "shot", shot });
    return shot;
  };

  emit({ t: "phase", phase: "check", msg: "주소를 검문하고 있습니다" });
  const url = normalizeInputUrl(input.url);
  await assertPublicHost(url.hostname);
  const goalInput = input.goal?.trim().slice(0, 120) || null;

  let browser: Browser | undefined;
  let desktop: PageSession | undefined;
  let mobile: PageSession | undefined;
  try {
    const launchStart = Date.now();
    browser = await launchBrowser();
    clock.mark("launch", launchStart);

    emit({ t: "phase", phase: "arrive", msg: "손님이 가게 문을 열고 들어갑니다" });
    const arriveStart = Date.now();
    desktop = await openSession(browser, "desktop");
    const navigation = await navigate(desktop, url.toString());
    const landing = await snap(desktop, "도착: 첫 화면");
    const desktopFacts = await collectFacts(desktop, url.toString(), navigation);
    // Gallery cards should show the site's front page, so the thumbnail is taken here —
    // before the customer clicks anything and wanders off to a sub page.
    const thumb = (await thumbnail(desktop)) ?? landing?.jpegBase64 ?? "";
    clock.mark("arrive", arriveStart);

    let goalUsed = goalInput ?? "사이트 둘러보기";
    let items: InventoryItem[] = [];

    if (!desktopFacts.botBlocked) {
      emit({ t: "phase", phase: "plan", msg: "첫 화면을 보고 뭘 할지 정하는 중" });
      const planStart = Date.now();
      items = await inventory(desktop);
      // The planner going down must not throw away a visit that already has photos: the
      // customer falls back to what a real one would do — scroll once and look around.
      // A busy model is the exception: the jury call would fail too, so ask for a retry
      // instead of spending the visitor's slot on a checks-only report.
      const plan = (await requestPlan({ goal: goalInput, facts: desktopFacts, items, landing, maxActions: 4 }).catch((error) => {
        if (error instanceof GemmaError && (error.status === 429 || error.status === 503)) throw error;
        console.warn("plan call failed, falling back to a look-around:", (error as Error).message.slice(0, 200));
        return null;
      })) ?? { goal: goalInput ?? "사이트 첫인상 둘러보기", actions: [] as PlannedAction[], expect: "" };
      // Nothing clickable (or every planned target was invented): a first customer would
      // at least scroll once before giving up, and the jury needs a second screenshot.
      if (plan.actions.length === 0) plan.actions.push({ type: "scroll", why: "더 볼 것이 있는지 확인" });
      goalUsed = plan.goal;
      clock.mark("plan", planStart);
      emit({ t: "plan", goal: plan.goal, actions: plan.actions });

      emit({ t: "phase", phase: "act", msg: `목표: ${plan.goal}` });
      const actStart = Date.now();
      let replanned = false;
      let queue = [...plan.actions];
      while (queue.length > 0 && steps.length < MAX_STEPS && clock.remaining() > 90_000) {
        const action = queue.shift()!;
        const stepStart = Date.now();
        const urlBefore = desktop.page.url();
        const outcome = await performAction(desktop, action, items);
        const shot = await snap(desktop, stepLabel(steps.length + 1, action, outcome.targetDescription));
        const step: StepRecord = {
          index: steps.length + 1,
          action,
          targetDescription: outcome.targetDescription,
          status: outcome.status,
          note: outcome.note,
          shotId: shot?.id ?? null,
          urlAfter: outcome.urlAfter,
          durationMs: Date.now() - stepStart,
        };
        steps.push(step);
        emit({ t: "step", step });
        items = await inventory(desktop);
        // Element numbers only mean something on the page they were listed from. Once the
        // customer has moved, the rest of the plan points at whatever now happens to carry
        // those numbers — that is where toss.im's "#6 요소를 찾지 못함" came from. Drop the
        // stale actions and let the single replan below re-read the page we are actually on.
        if (queue.length > 0 && outcome.urlAfter && outcome.urlAfter !== urlBefore) queue = [];
        const stuck = outcome.status === "not_found" || outcome.status === "failed";
        if ((stuck || queue.length === 0) && !replanned && steps.length < MAX_STEPS && clock.remaining() > 110_000) {
          replanned = true;
          emit({ t: "phase", phase: "plan", msg: stuck ? "예상과 달라서 다시 둘러보는 중" : "목표를 이뤘는지 확인하는 중" });
          // Only the current step's own photo may be shown as "the screen right now";
          // an older shot would describe a page the customer already left.
          const title = await desktop.page.title().catch(() => desktopFacts.title);
          const next = await requestPlan({ goal: goalUsed, facts: { ...desktopFacts, title, finalUrl: desktop.page.url() }, items, landing: shot, maxActions: 3, replanSteps: steps }).catch((error) => {
            console.warn("replan call failed, stopping after the first plan:", (error as Error).message.slice(0, 200));
            return { goal: goalUsed, actions: [] as PlannedAction[], expect: "" };
          });
          queue = next.actions;
          if (queue.length > 0) emit({ t: "plan", goal: goalUsed, actions: queue });
        }
      }
      clock.mark("act", actStart);
    } else {
      emit({ t: "phase", phase: "act", msg: "사이트가 자동 방문을 막았습니다. 남은 점검만 진행합니다" });
    }

    let mobileFacts: PageFacts | null = null;
    if (clock.remaining() > 60_000) {
      emit({ t: "phase", phase: "mobile", msg: "이번엔 휴대폰으로 다시 들어가 봅니다" });
      const mobileStart = Date.now();
      try {
        mobile = await openSession(browser, "mobile");
        const mobileNav = await navigate(mobile, url.toString());
        await snap(mobile, "모바일: 첫 화면");
        mobileFacts = await collectFacts(mobile, url.toString(), mobileNav);
        if (!mobileFacts.botBlocked) {
          await performAction(mobile, { type: "scroll", why: "아래 내용 확인" }, []);
          await snap(mobile, "모바일: 한 화면 아래");
        }
      } catch (error) {
        console.warn("mobile pass failed:", (error as Error).message);
      } finally {
        await mobile?.close();
        mobile = undefined;
      }
      clock.mark("mobile", mobileStart);
    }

    emit({ t: "phase", phase: "checks", msg: "점검표를 채우는 중" });
    const checks = buildChecks(desktopFacts, mobileFacts);
    emit({ t: "checks", checks });

    // Where the customer actually ended up after the clicks — desktopFacts.finalUrl is the
    // landing page and would let the jury call a search-results page "the goal screen".
    const lastUrl = desktop.page.url();
    await desktop.close();
    desktop = undefined;
    await browser.close().catch(() => undefined);
    browser = undefined;

    emit({ t: "phase", phase: "deliberate", msg: "손님 5명이 리뷰를 쓰고 있습니다" });
    const deliberateStart = Date.now();
    const blocked = desktopFacts.botBlocked;
    const { reviews, verdict, model, degraded } = await deliberate({ goal: goalUsed, facts: desktopFacts, steps, shots, checksSummary: summarizeChecks(checks), blocked, lastUrl });
    clock.mark("deliberate", deliberateStart);
    const score = computeScore(reviews, checks, verdict.missionOutcome);
    emit({ t: "reviews", reviews });
    emit({ t: "verdict", verdict, score });

    const record: RunRecord = {
      id: newRunId(),
      version: 1,
      createdAt: new Date().toISOString(),
      input: { url: url.toString(), goal: goalInput },
      goalUsed,
      site: { host: url.hostname, title: desktopFacts.title, finalUrl: desktopFacts.finalUrl },
      shots,
      steps,
      facts: { desktop: desktopFacts, mobile: mobileFacts },
      checks,
      reviews,
      verdict,
      score,
      model,
      timings: { ...clock.marks, total: clock.elapsed() },
      status: blocked ? "blocked" : "complete",
      ...(degraded ? { degraded } : {}),
    };
    emit({ t: "phase", phase: "save", msg: "리뷰를 게시하는 중" });
    await saveRun(record);
    await pushRecent({
      id: record.id,
      host: record.site.host,
      title: record.site.title,
      url: record.input.url,
      score: score.total,
      grade: score.grade,
      oneLiner: verdict.oneLiner,
      createdAt: record.createdAt,
      thumbBase64: thumb,
      status: record.status,
    }).catch((error) => console.warn("recent index update failed:", (error as Error).message));
    emit({ t: "done", id: record.id });
    return record;
  } finally {
    await mobile?.close();
    await desktop?.close();
    await browser?.close().catch(() => undefined);
  }
}

function stepLabel(index: number, action: RunRecord["steps"][number]["action"], target: string | null): string {
  const verb = { click: "클릭", type: "입력", press: "키 입력", scroll: "스크롤", back: "뒤로" }[action.type];
  const what = target ? target.replace(/^[a-z]+(\[[^\]]*\])?\s*/, "") : action.type === "press" ? action.key ?? "Enter" : "";
  return `${index}. ${verb}${what ? ` ${what}` : ""}`.slice(0, 60);
}

async function requestPlan(input: { goal: string | null; facts: PageFacts; items: InventoryItem[]; landing: Shot | null; maxActions: number; replanSteps?: StepRecord[] }) {
  const text = planUserText({
    goal: input.goal,
    title: input.facts.title,
    url: input.facts.finalUrl,
    inventory: formatInventory(input.items),
    hasImage: Boolean(input.landing),
    replan: input.replanSteps ? { steps: input.replanSteps } : undefined,
  });
  const parts: GemmaPart[] = [{ text }];
  if (input.landing) parts.push(imagePart(input.landing.jpegBase64));
  const result = await generateJson<PlanResponse>({
    system: PLAN_SYSTEM,
    parts,
    temperature: 0.2,
    maxOutputTokens: 700,
    label: "plan",
  });
  return normalizePlan(result.value, input.maxActions, new Set(input.items.map((item) => item.i)));
}

function pickShotsForJury(shots: Shot[]): Shot[] {
  const desktop = shots.filter((shot) => shot.viewport === "desktop");
  const mobile = shots.filter((shot) => shot.viewport === "mobile");
  const first = desktop[0] ? [desktop[0]] : [];
  const rest = desktop.slice(1);
  const lastSteps = rest.slice(Math.max(0, rest.length - 4));
  return [...first, ...lastSteps, ...mobile.slice(0, 2)];
}

/** Arrival + end state + phone view: the smallest prompt that still supports a real verdict. */
function pickShotsMinimal(shots: Shot[]): Shot[] {
  const desktop = shots.filter((shot) => shot.viewport === "desktop");
  const mobile = shots.filter((shot) => shot.viewport === "mobile");
  const picked: Shot[] = [];
  if (desktop[0]) picked.push(desktop[0]);
  const last = desktop[desktop.length - 1];
  if (last && last !== desktop[0]) picked.push(last);
  if (mobile[0]) picked.push(mobile[0]);
  return picked;
}

const DEGRADED_NOTE = {
  headline: "리뷰를 받지 못했어요",
  body: "손님이 몰려 리뷰 생성에 실패했습니다. 잠시 후 '같은 곳에 손님 다시 보내기'를 눌러 주세요.",
};

interface DeliberateInput {
  goal: string;
  facts: PageFacts;
  steps: StepRecord[];
  shots: Shot[];
  checksSummary: string;
  blocked: boolean;
  lastUrl: string;
}

interface DeliberateResult {
  reviews: Review[];
  verdict: Verdict;
  model: string;
  degraded?: RunRecord["degraded"];
}

/**
 * A dead jury call used to kill the whole visit after four minutes of real browsing. Now it
 * costs the reviews only: one cheaper retry, then an honest checks-only report.
 */
async function deliberate(input: DeliberateInput): Promise<DeliberateResult> {
  try {
    return await runJury(input, pickShotsForJury(input.shots));
  } catch (error) {
    console.warn("jury call failed, retrying with fewer photos:", (error as Error).message.slice(0, 200));
  }
  try {
    return await runJury(input, pickShotsMinimal(input.shots));
  } catch (error) {
    console.error("jury call failed twice, saving a checks-only report:", (error as Error).message.slice(0, 200));
    return degradedResult(input);
  }
}

function degradedResult(input: DeliberateInput): DeliberateResult {
  return {
    reviews: [],
    verdict: {
      oneLiner: "리뷰를 받지 못해 자동 점검표 결과만 남깁니다",
      firstImpression: "",
      // Nothing read the screenshots, so nothing may claim the mission succeeded; the report
      // shows "판정 못 함" instead of a verdict and the score keeps only the check points.
      missionOutcome: input.blocked ? "blocked" : "fail",
      missionNarrative: "",
      stuckReason: null,
      praise: "",
      fixes: [],
    },
    model: DEFAULT_MODEL,
    degraded: DEGRADED_NOTE,
  };
}

async function runJury(input: DeliberateInput, selected: Shot[]): Promise<DeliberateResult> {
  const text = deliberationUserText({
    goal: input.goal,
    site: { title: input.facts.title, url: input.facts.finalUrl, description: input.facts.metaDescription, textSample: input.facts.textSample },
    steps: input.steps,
    shotLabels: selected.map((shot) => ({ id: shot.id, label: shot.label, viewport: shot.viewport })),
    checksSummary: input.checksSummary,
    blocked: input.blocked,
    lastUrl: input.lastUrl,
  });
  const parts: GemmaPart[] = [{ text }];
  for (const shot of selected) {
    parts.push({ text: `사진 ${shot.id}: ${shot.label}` });
    parts.push(imagePart(shot.jpegBase64));
  }
  const result = await generateJson<DeliberationResponse>({
    system: DELIBERATION_SYSTEM,
    parts,
    temperature: 0.45,
    maxOutputTokens: 3200,
    label: "deliberate",
  });
  const validShot = (id: unknown): string | null => (typeof id === "string" && input.shots.some((shot) => shot.id === id) ? id : null);
  const raw = result.value;
  const reviews: Review[] = PERSONAS.map((persona) => {
    const found = (raw.reviews ?? []).find((review) => review?.persona === persona.id);
    const rating = Number(found?.rating);
    return {
      persona: persona.id as PersonaId,
      rating: Number.isFinite(rating) ? Math.min(5, Math.max(1, Math.round(rating))) : input.blocked ? 1 : 3,
      headline: String(found?.headline ?? (input.blocked ? "들어가지도 못했어요" : "리뷰를 남기지 못했어요")).slice(0, 40),
      body: String(found?.body ?? (input.blocked ? "사이트가 자동 방문을 막아서 첫 화면조차 보지 못했습니다." : "이번 방문에서는 이 손님의 리뷰가 생성되지 않았습니다.")).slice(0, 400),
      stuckAt: found?.stuck_at ? String(found.stuck_at).slice(0, 120) : null,
      evidenceShotId: validShot(found?.evidence_shot),
      wish: String(found?.wish ?? "").slice(0, 60),
    };
  });
  const outcomeRaw = String(raw.mission?.outcome ?? "").toLowerCase();
  const missionOutcome: MissionOutcome = input.blocked
    ? "blocked"
    : (["success", "partial", "fail", "blocked"] as MissionOutcome[]).find((value) => value === outcomeRaw) ?? "partial";
  const fixes: Fix[] = (raw.verdict?.fixes ?? [])
    .filter((fix) => fix && typeof fix.title === "string")
    .slice(0, 3)
    .map((fix) => ({
      title: String(fix.title).slice(0, 50),
      why: String(fix.why ?? "").slice(0, 300),
      evidenceShotId: validShot(fix.evidence_shot),
      impact: (["high", "medium", "low"] as Fix["impact"][]).find((value) => value === String(fix.impact ?? "").toLowerCase()) ?? "medium",
    }));
  const verdict: Verdict = {
    oneLiner: String(raw.verdict?.one_liner ?? (input.blocked ? "문이 잠겨 있어 들어가지 못했습니다" : "총평을 남기지 못했습니다")).slice(0, 80),
    firstImpression: String(raw.first_impression ?? "").slice(0, 160),
    missionOutcome,
    missionNarrative: String(raw.mission?.narrative ?? "").slice(0, 400),
    stuckReason: raw.mission?.stuck_reason ? String(raw.mission.stuck_reason).slice(0, 200) : null,
    praise: String(raw.verdict?.praise ?? "").slice(0, 200),
    fixes,
  };
  return { reviews, verdict, model: result.model };
}
