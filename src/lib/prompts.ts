import { PERSONAS } from "./personas";
import type { PlannedAction, StepRecord } from "./types";

export const PLAN_SYSTEM = `당신은 '첫손님' 서비스의 방문 손님 역할을 하는 브라우저 에이전트입니다.
사이트를 처음 방문한 일반 사용자처럼 행동하며, 주어진 목표를 이루기 위해 최대 4개의 행동을 계획합니다.

규칙:
- 행동은 반드시 요소 목록에 있는 #번호만 대상으로 합니다. 목록에 없는 요소를 지어내지 않습니다.
- 가능한 행동: click(요소 클릭), type(입력창에 글자 입력, text 필수), press(key: Enter/Escape/Tab), scroll(한 화면 아래로), back(이전 페이지).
- 결제, 구매, 주문, 삭제, 탈퇴, 실제 회원가입 완료, 실제 개인정보 입력은 절대 하지 않습니다. 가입/로그인/결제 화면까지 '도달'하는 것은 됩니다.
- 팝업이나 쿠키 배너가 목표를 가리면 먼저 닫아도 됩니다.
- 목표가 비어 있으면, 첫 방문자가 이 사이트에서 가장 자연스럽게 하려는 핵심 행동 하나를 골라 goal에 적습니다(예: "요금제와 가격 확인하기", "채용공고 하나 열어보기", "제품 상세 보기").
- 모든 문장은 한국어로 짧게 씁니다.

출력 JSON 형식:
{"goal": "손님이 하려는 일 한 문장(40자 이내)", "actions": [{"type": "click|type|press|scroll|back", "target": 번호 또는 null, "text": "입력할 글자 또는 null", "key": "Enter 등 또는 null", "why": "이 행동을 하는 이유(20자 이내)"}], "expect": "행동을 마쳤을 때 보일 것으로 기대하는 화면(30자 이내)"}`;

export function planUserText(input: { goal: string | null; title: string; url: string; inventory: string; hasImage?: boolean; replan?: { steps: StepRecord[] } }): string {
  const lines = [
    `현재 페이지: ${input.title || "(제목 없음)"} — ${input.url}`,
    input.goal ? `손님의 목표: ${input.goal}` : "손님의 목표: (지정되지 않음. 당신이 가장 자연스러운 첫 방문 목표를 하나 정하세요)",
  ];
  if (input.replan) {
    lines.push("", "이전 시도 기록:");
    for (const step of input.replan.steps) {
      lines.push(`- ${step.index}. ${step.action.type} ${step.targetDescription ?? ""} → ${step.status}${step.note ? ` (${step.note})` : ""}`);
    }
    lines.push("이전 시도에서 막힌 부분을 피해서, 현재 화면 기준으로 남은 행동을 최대 3개만 다시 계획하세요. 이미 목표를 이뤘다면 actions를 빈 배열로 두세요.");
  }
  lines.push(
    "",
    "클릭·입력 가능한 요소 목록 (#번호 태그 \"보이는 글자\" → 링크):",
    input.inventory || "(요소 없음)",
    "",
    input.hasImage === false ? "이번에는 스크린샷을 찍지 못했습니다. 아래 요소 목록만 보고 계획하세요." : "첨부한 이미지는 현재 화면 스크린샷입니다.",
  );
  return lines.join("\n");
}

export interface PlanResponse {
  goal?: string;
  actions?: Partial<PlannedAction & { target: number | null; text: string | null; key: string | null }>[];
  expect?: string;
}

export function normalizePlan(raw: PlanResponse, maxActions: number, validTargets?: Set<number>): { goal: string; actions: PlannedAction[]; expect: string } {
  const actions: PlannedAction[] = [];
  for (const action of raw.actions ?? []) {
    if (!action || typeof action.type !== "string") continue;
    const type = action.type as PlannedAction["type"];
    if (!["click", "type", "press", "scroll", "back"].includes(type)) continue;
    const normalized: PlannedAction = { type, why: String(action.why ?? "").slice(0, 60) };
    if (typeof action.target === "number" && Number.isFinite(action.target)) normalized.target = Math.round(action.target);
    if (typeof action.text === "string" && action.text.trim()) normalized.text = action.text.trim().slice(0, 80);
    if (typeof action.key === "string" && action.key.trim()) normalized.key = action.key.trim();
    // press/scroll/back never use a target; a stray one would only confuse the step log.
    if (type !== "click" && type !== "type") delete normalized.target;
    if ((type === "click" || type === "type") && normalized.target === undefined) continue;
    // Drop invented element numbers instead of letting them become "요소 못 찾음" steps.
    if (validTargets && normalized.target !== undefined && !validTargets.has(normalized.target)) continue;
    if (type === "type" && !normalized.text) continue;
    actions.push(normalized);
    if (actions.length >= maxActions) break;
  }
  return {
    goal: String(raw.goal ?? "").trim().slice(0, 80) || "사이트 둘러보기",
    actions,
    expect: String(raw.expect ?? "").trim().slice(0, 80),
  };
}

const personaBlock = PERSONAS.map((persona) => `- ${persona.id} (${persona.name}, ${persona.tagline}): ${persona.lens}`).join("\n");

export const DELIBERATION_SYSTEM = `당신은 '첫손님' 서비스의 손님 5명과 매니저를 동시에 연기합니다.
손님들은 방금 실제 브라우저로 이 웹사이트를 처음 방문했고, 첨부된 스크린샷(증거 사진)과 행동 기록, 점검표만을 근거로 리뷰를 씁니다.
사진에 보이지 않거나 기록에 없는 사실은 절대 지어내지 않습니다. 확실하지 않으면 "확인하지 못했다"고 씁니다.

손님 5명:
${personaBlock}

작성 원칙:
- 모든 문장은 한국어, 반말이 아닌 자연스러운 존댓말 구어체. 네이버 플레이스 리뷰처럼 구체적이고 솔직하게.
- 각 리뷰는 화면에서 실제로 본 것을 하나 이상 그대로 집어서 말합니다: 버튼·메뉴에 적힌 글자, 제목 문구, 숫자, 행동 기록에 남은 단계. "정보가 투명해요", "깔끔해요" 같은 근거 없는 총평만 쓰면 안 됩니다.
- evidence_shot에는 위 '첨부 사진 목록'에 있는 id(S1, S2 ...) 중 그 장면이 실제로 보이는 것을 하나 반드시 적습니다. 목록에 없는 id나 null은 쓰지 않습니다.
- 손님 5명은 서로 다른 장면을 봅니다. 같은 지적을 두 사람이 반복하지 말고, 각자 자기 렌즈에 해당하는 장면을 고릅니다.
- rating은 1~5 정수. 5는 "막힘 없이 목표를 이뤘고 기분 좋음", 3은 "되긴 되는데 불편", 1은 "포기".
- 칭찬할 점이 있으면 솔직하게 칭찬합니다. 비판을 위한 비판은 하지 않습니다.
- 사진에도 없고 기록에도 없는 사실(운영 주체, 약관, 가격, 환불 조건 등)은 "확인하지 못했습니다"라고 씁니다. 봤다고 지어내면 안 됩니다.
- mission.narrative는 손님 1인칭으로, 행동 기록에 실제로 있는 단계만 이야기합니다.
- mission.outcome은 리뷰 분위기가 아니라 '마지막 스크린샷 + 마지막 주소 + 마지막 행동의 결과'만 보고 아래 정의대로 고릅니다.
  · success: 마지막 화면이 목표가 말하는 '끝 상태' 자체를 보여줄 때만. 목표가 "문서를 연다"면 그 문서 본문이, "채용공고를 하나 열어본다"면 그 공고 하나의 상세 내용(직무 설명·자격요건 등)이, "제품 상세를 본다"면 그 제품 페이지가 화면에 실제로 보여야 합니다.
  · partial: 목록·검색 결과·카테고리·메뉴처럼 '거기로 가는 길'까지만 갔을 때. 채용공고 목록, 검색 결과 목록, 문서 검색 결과는 상세 화면이 아니므로 success가 아니라 partial입니다. 목표의 일부만 이뤘을 때도 partial입니다.
  · fail: 의미 있는 진전이 없었거나, 마지막 화면이 목표와 상관없는 곳이거나, 계속 막혀 있을 때.
  · blocked: 사이트가 자동 방문을 막았거나 오류 페이지만 보였을 때.
- 목표한 상세 화면을 마지막 사진에서 직접 확인하지 못했다면 success를 쓰지 않습니다. 애매하면 항상 낮은 쪽(success 대신 partial, partial 대신 fail)을 고릅니다.
- stuck_reason에는 success가 아닌 경우 '어디까지 갔고 무엇이 남았는지'를 한 문장으로 적습니다.
- fixes는 영향이 큰 순서로 정확히 3개. why에는 "어느 화면의 무엇을 / 어떻게 바꾸는지 / 그러면 누가 무엇을 할 수 있게 되는지"가 모두 들어가야 하고, 바꿀 문구나 수치(예: 44px, "무료로 시작하기")를 적습니다. "메타데이터 보강"처럼 뭉뚱그린 제목은 쓰지 않습니다.
- 사이트가 자동 방문을 차단했거나 오류 페이지만 보였다면 mission.outcome을 "blocked"로 두고 그 사실을 그대로 씁니다.

출력 JSON 형식:
{
 "mission": {"outcome": "success|partial|fail|blocked", "narrative": "손님이 목표를 시도한 과정을 1인칭으로 2~3문장", "stuck_reason": "막혔다면 어디서 왜 막혔는지 한 문장, 아니면 null"},
 "first_impression": "첫 3초 인상 한 문장",
 "reviews": [
  {"persona": "busy", "rating": 1-5, "headline": "리뷰 제목(20자 이내)", "body": "리뷰 본문 2~3문장", "stuck_at": "막힌 지점 또는 null", "evidence_shot": "S1 같은 사진 id 또는 null", "wish": "이것 하나만 바뀌면 좋겠다(30자 이내)"},
  {"persona": "senior", ...}, {"persona": "mobile", ...}, {"persona": "screenreader", ...}, {"persona": "skeptic", ...}
 ],
 "verdict": {"one_liner": "매니저 총평 한 문장(40자 이내)", "praise": "가장 잘한 점 한 문장", "fixes": [{"title": "고칠 것(25자 이내)", "why": "왜 중요한지와 구체적 방법 1~2문장", "evidence_shot": "사진 id 또는 null", "impact": "high|medium|low"}]}
}`;

/** Percent-encoded Korean paths are unreadable for the jury; show them decoded and short. */
function readableUrl(url: string): string {
  let text = url;
  try {
    text = decodeURI(url);
  } catch {
    // keep the raw form
  }
  return text.replace(/^https?:\/\//, "").slice(0, 90);
}

export function deliberationUserText(input: {
  goal: string;
  site: { title: string; url: string; description: string | null; textSample: string };
  steps: StepRecord[];
  shotLabels: { id: string; label: string; viewport: string }[];
  checksSummary: string;
  blocked: boolean;
  lastUrl: string;
}): string {
  let where = input.site.url;
  const stepLines = input.steps.length
    ? input.steps.map((step) => {
        const what =
          step.action.type === "click"
            ? `클릭 ${step.targetDescription ?? ""}`
            : step.action.type === "type"
              ? `입력 ${step.targetDescription ?? ""}`
              : step.action.type === "press"
                ? `${step.action.key ?? "Enter"} 키`
                : step.action.type === "scroll"
                  ? "스크롤"
                  : "뒤로가기";
        const status = { done: "성공", skipped_safety: "안전 규칙으로 건너뜀", failed: "실패", not_found: "요소 못 찾음" }[step.status];
        let moved = "";
        if (step.urlAfter && step.urlAfter !== where) {
          moved = `, 주소가 ${readableUrl(step.urlAfter)} 로 바뀜`;
          where = step.urlAfter;
        } else if (step.status === "done" && (step.action.type === "click" || step.action.type === "back")) {
          moved = ", 주소는 그대로";
        }
        return `- ${step.index}. ${what} (${step.action.why}) → ${status}${step.note ? `: ${step.note}` : ""}${moved}${step.shotId ? ` [사진 ${step.shotId}]` : " [사진 없음: 화면이 넘어가는 중이라 못 찍음]"}`;
      })
    : ["- (행동 없음)"];
  const shotIds = input.shotLabels.map((shot) => shot.id).join(", ");
  const lastStep = input.steps[input.steps.length - 1];
  const lastDesktopShot = [...input.shotLabels].reverse().find((shot) => shot.viewport === "desktop");
  const statusLabel = { done: "성공", skipped_safety: "안전 규칙으로 건너뜀", failed: "실패", not_found: "요소 못 찾음" };
  const verdictFacts = [
    "미션 판정에 쓸 사실 (이 값들을 그대로 믿으세요):",
    `- 손님이 마지막으로 머문 주소: ${readableUrl(input.lastUrl || where)}`,
    `- 처음 도착했던 주소: ${readableUrl(input.site.url)}`,
    lastStep
      ? `- 마지막 행동: ${lastStep.index}번 ${lastStep.action.type} ${lastStep.targetDescription ?? ""} → ${statusLabel[lastStep.status]}`
      : "- 마지막 행동: 없음 (손님이 아무 행동도 하지 못했습니다)",
    lastDesktopShot
      ? `- 목표 달성 여부를 판정할 마지막 화면: ${lastDesktopShot.id} (${lastDesktopShot.label})`
      : "- 마지막 화면 사진이 없습니다.",
    "이 마지막 화면에 목표한 끝 상태가 직접 보이지 않으면 outcome은 success가 아닙니다.",
  ].join("\n");
  return [
    `사이트: ${input.site.title || "(제목 없음)"} — ${input.site.url}`,
    input.site.description ? `사이트 설명: ${input.site.description}` : "",
    `손님의 목표: ${input.goal}`,
    input.blocked ? "주의: 사이트가 자동 방문을 차단했거나 오류 페이지를 보여줬습니다." : "",
    "",
    "행동 기록:",
    ...stepLines,
    "",
    verdictFacts,
    "",
    "첨부 사진 목록 (순서대로 첨부됨):",
    ...(input.shotLabels.length ? input.shotLabels.map((shot) => `- ${shot.id}: ${shot.label} (${shot.viewport === "mobile" ? "모바일 390px" : "데스크톱 1280px"})`) : ["- (사진 없음)"]),
    input.shotLabels.length
      ? `evidence_shot에 쓸 수 있는 id는 ${shotIds} 뿐입니다. 각 리뷰와 각 fix마다 이 중 하나를 고르세요.`
      : "첨부된 사진이 한 장도 없습니다(캡처 실패). evidence_shot은 모두 null로 두고, 행동 기록과 점검표만 근거로 쓰세요.",
    "",
    "자동 점검표:",
    input.checksSummary,
    "",
    "첫 화면 본문 일부:",
    input.site.textSample.slice(0, 700),
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export interface DeliberationResponse {
  mission?: { outcome?: string; narrative?: string; stuck_reason?: string | null };
  first_impression?: string;
  reviews?: { persona?: string; rating?: number; headline?: string; body?: string; stuck_at?: string | null; evidence_shot?: string | null; wish?: string }[];
  verdict?: { one_liner?: string; praise?: string; fixes?: { title?: string; why?: string; evidence_shot?: string | null; impact?: string }[] };
}
