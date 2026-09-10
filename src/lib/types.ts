export type Viewport = "desktop" | "mobile";

export type PersonaId = "busy" | "senior" | "mobile" | "screenreader" | "skeptic";

export interface Shot {
  id: string;
  viewport: Viewport;
  label: string;
  jpegBase64: string;
  width: number;
  height: number;
  url: string;
  takenAt: number;
}

export type ActionType = "click" | "type" | "press" | "scroll" | "back";

export interface PlannedAction {
  type: ActionType;
  target?: number;
  text?: string;
  key?: string;
  why: string;
}

export type StepStatus = "done" | "skipped_safety" | "failed" | "not_found";

export interface StepRecord {
  index: number;
  action: PlannedAction;
  targetDescription: string | null;
  status: StepStatus;
  note: string | null;
  shotId: string | null;
  urlAfter: string | null;
  durationMs: number;
}

export interface PageFacts {
  requestedUrl: string;
  finalUrl: string;
  status: number | null;
  title: string;
  https: boolean;
  loadMs: number;
  metaDescription: string | null;
  viewportMeta: boolean;
  lang: string | null;
  h1Count: number;
  imgCount: number;
  imgMissingAlt: number;
  controlCount: number;
  controlsMissingName: number;
  inputCount: number;
  inputsMissingLabel: number;
  consoleErrors: string[];
  failedRequests: string[];
  overflowPx: number;
  smallTapTargets: number;
  tinyTextCount: number;
  favicon: boolean;
  ogTitle: boolean;
  ogImage: boolean;
  textSample: string;
  wordCount: number;
  domNodes: number;
  botBlocked: boolean;
}

export type CheckStatus = "pass" | "warn" | "fail";

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  viewport: Viewport | "both";
}

export interface Review {
  persona: PersonaId;
  rating: number;
  headline: string;
  body: string;
  stuckAt: string | null;
  evidenceShotId: string | null;
  wish: string;
}

export type MissionOutcome = "success" | "partial" | "fail" | "blocked";

export interface Fix {
  title: string;
  why: string;
  evidenceShotId: string | null;
  impact: "high" | "medium" | "low";
}

export interface Verdict {
  oneLiner: string;
  firstImpression: string;
  missionOutcome: MissionOutcome;
  missionNarrative: string;
  stuckReason: string | null;
  praise: string;
  fixes: Fix[];
}

export interface ScoreBreakdown {
  total: number;
  reviewAvg: number;
  reviewPoints: number;
  checkPassRatio: number;
  checkPoints: number;
  missionPoints: number;
  grade: string;
}

export interface RunRecord {
  id: string;
  version: 1;
  createdAt: string;
  input: { url: string; goal: string | null };
  goalUsed: string;
  site: { host: string; title: string; finalUrl: string };
  shots: Shot[];
  steps: StepRecord[];
  facts: { desktop: PageFacts; mobile: PageFacts | null };
  checks: Check[];
  reviews: Review[];
  verdict: Verdict;
  score: ScoreBreakdown;
  model: string;
  timings: Record<string, number>;
  status: "complete" | "blocked";
  /** Present when the jury call failed: reviews are empty and only the checks scored. */
  degraded?: { headline: string; body: string };
}

export interface RecentEntry {
  id: string;
  host: string;
  title: string;
  url: string;
  score: number;
  grade: string;
  oneLiner: string;
  createdAt: string;
  thumbBase64: string;
  status: RunRecord["status"];
}

export type VisitEvent =
  | { t: "phase"; phase: string; msg: string }
  | { t: "shot"; shot: Shot }
  | { t: "plan"; goal: string; actions: PlannedAction[] }
  | { t: "step"; step: StepRecord }
  | { t: "checks"; checks: Check[] }
  | { t: "reviews"; reviews: Review[] }
  | { t: "verdict"; verdict: Verdict; score: ScoreBreakdown }
  | { t: "done"; id: string }
  | { t: "error"; message: string };
