import type { Check, CheckStatus, PageFacts } from "./types";

function tier(value: number, warnAt: number, failAt: number): CheckStatus {
  if (value <= 0) return "pass";
  if (value <= warnAt) return "warn";
  if (value <= failAt) return "warn";
  return "fail";
}

export function buildChecks(desktop: PageFacts, mobile: PageFacts | null): Check[] {
  const checks: Check[] = [];
  const add = (check: Check) => checks.push(check);

  add({
    id: "https",
    label: "보안 연결(HTTPS)",
    status: desktop.https ? "pass" : "fail",
    detail: desktop.https ? "주소가 https로 시작합니다." : "암호화되지 않은 http 연결입니다. 브라우저가 '안전하지 않음'을 표시합니다.",
    viewport: "both",
  });
  add({
    id: "load",
    label: "첫 화면 응답 속도",
    status: desktop.loadMs <= 2500 ? "pass" : desktop.loadMs <= 5000 ? "warn" : "fail",
    detail: `문서 로드까지 ${(desktop.loadMs / 1000).toFixed(1)}초 걸렸습니다.${desktop.loadMs > 2500 ? " 3초를 넘기면 손님 절반이 떠납니다." : ""}`,
    viewport: "desktop",
  });
  add({
    id: "title",
    label: "페이지 제목",
    status: desktop.title.length >= 4 ? "pass" : "fail",
    detail: desktop.title ? `“${desktop.title.slice(0, 60)}”` : "제목이 비어 있어 탭과 검색 결과에서 정체를 알 수 없습니다.",
    viewport: "both",
  });
  add({
    id: "description",
    label: "검색용 설명(meta description)",
    status: desktop.metaDescription ? "pass" : "warn",
    detail: desktop.metaDescription ? `“${desktop.metaDescription.slice(0, 80)}”` : "설명이 없어 검색 결과와 공유 미리보기가 비어 보입니다.",
    viewport: "both",
  });
  add({
    id: "og",
    label: "공유 미리보기(OG 태그)",
    status: desktop.ogTitle && desktop.ogImage ? "pass" : "warn",
    detail: desktop.ogTitle && desktop.ogImage ? "카톡·슬랙에 링크를 보내면 제목과 이미지가 보입니다." : `og:title ${desktop.ogTitle ? "있음" : "없음"}, og:image ${desktop.ogImage ? "있음" : "없음"}.`,
    viewport: "both",
  });
  add({
    id: "favicon",
    label: "파비콘",
    status: desktop.favicon ? "pass" : "warn",
    detail: desktop.favicon ? "탭 아이콘이 설정되어 있습니다." : "탭 아이콘이 없어 여러 탭 사이에서 찾기 어렵습니다.",
    viewport: "both",
  });
  add({
    id: "lang",
    label: "문서 언어 표시(lang)",
    status: desktop.lang ? "pass" : "warn",
    detail: desktop.lang ? `lang="${desktop.lang}"` : "html lang 속성이 없어 스크린리더가 발음 규칙을 고를 수 없습니다.",
    viewport: "both",
  });
  add({
    id: "h1",
    label: "대제목(h1) 구조",
    status: desktop.h1Count === 1 ? "pass" : "warn",
    detail: desktop.h1Count === 0 ? "h1이 없어 스크린리더 사용자가 페이지 주제를 바로 알 수 없습니다." : desktop.h1Count === 1 ? "h1이 하나 있습니다." : `h1이 ${desktop.h1Count}개라 주제가 흐려집니다.`,
    viewport: "both",
  });
  add({
    id: "img-alt",
    label: "이미지 대체텍스트",
    status: desktop.imgCount === 0 ? "pass" : desktop.imgMissingAlt === 0 ? "pass" : desktop.imgMissingAlt / desktop.imgCount <= 0.2 ? "warn" : "fail",
    detail: desktop.imgCount === 0 ? "이미지가 없습니다." : `이미지 ${desktop.imgCount}개 중 ${desktop.imgMissingAlt}개에 alt가 없습니다.`,
    viewport: "both",
  });
  add({
    id: "control-names",
    label: "이름 없는 버튼·링크",
    status: tier(desktop.controlsMissingName, 3, 8),
    detail: desktop.controlsMissingName === 0 ? `버튼·링크 ${desktop.controlCount}개 모두 읽을 수 있는 이름이 있습니다.` : `${desktop.controlsMissingName}개는 아이콘만 있고 이름이 없어 스크린리더가 “버튼”이라고만 읽습니다.`,
    viewport: "both",
  });
  add({
    id: "input-labels",
    label: "입력창 라벨",
    status: tier(desktop.inputsMissingLabel, 1, 3),
    detail: desktop.inputCount === 0 ? "입력창이 없습니다." : desktop.inputsMissingLabel === 0 ? `입력창 ${desktop.inputCount}개 모두 라벨이 있습니다.` : `입력창 ${desktop.inputCount}개 중 ${desktop.inputsMissingLabel}개에 라벨이 없습니다.`,
    viewport: "both",
  });
  add({
    id: "console",
    label: "자바스크립트 오류",
    status: tier(desktop.consoleErrors.length, 2, 5),
    detail: desktop.consoleErrors.length === 0 ? "콘솔 오류가 없습니다." : `콘솔 오류 ${desktop.consoleErrors.length}건: ${desktop.consoleErrors[0].slice(0, 90)}`,
    viewport: "desktop",
  });
  add({
    id: "network",
    label: "깨진 요청",
    status: tier(desktop.failedRequests.length, 3, 8),
    detail: desktop.failedRequests.length === 0 ? "실패한 네트워크 요청이 없습니다." : `실패 ${desktop.failedRequests.length}건: ${desktop.failedRequests[0].slice(0, 90)}`,
    viewport: "desktop",
  });
  add({
    id: "overflow-desktop",
    label: "가로 스크롤(데스크톱)",
    status: desktop.overflowPx === 0 ? "pass" : "fail",
    detail: desktop.overflowPx === 0 ? "화면 폭 안에 들어옵니다." : `${desktop.overflowPx}px 만큼 옆으로 삐져나옵니다.`,
    viewport: "desktop",
  });
  if (mobile) {
    add({
      id: "viewport-meta",
      label: "모바일 뷰포트 설정",
      status: mobile.viewportMeta ? "pass" : "fail",
      detail: mobile.viewportMeta ? "viewport meta가 있어 모바일에서 확대 없이 읽힙니다." : "viewport meta가 없어 모바일에서 데스크톱 화면이 축소되어 보입니다.",
      viewport: "mobile",
    });
    add({
      id: "overflow-mobile",
      label: "가로 스크롤(모바일)",
      status: mobile.overflowPx === 0 ? "pass" : "fail",
      detail: mobile.overflowPx === 0 ? "390px 화면 안에 들어옵니다." : `${mobile.overflowPx}px 만큼 옆으로 삐져나와 한 손 조작이 어렵습니다.`,
      viewport: "mobile",
    });
    add({
      id: "tap-targets",
      label: "엄지로 누르기 어려운 버튼",
      status: tier(mobile.smallTapTargets, 5, 15),
      detail: mobile.smallTapTargets === 0 ? "버튼이 충분히 큽니다." : `${mobile.smallTapTargets}개가 40px보다 작아 잘못 눌리기 쉽습니다.`,
      viewport: "mobile",
    });
    add({
      id: "tiny-text",
      label: "너무 작은 글자(모바일)",
      status: tier(mobile.tinyTextCount, 5, 15),
      detail: mobile.tinyTextCount === 0 ? "12px보다 작은 글자가 없습니다." : `12px보다 작은 글자 덩어리가 ${mobile.tinyTextCount}곳 있습니다.`,
      viewport: "mobile",
    });
  }
  return checks;
}

export function summarizeChecks(checks: Check[]): string {
  return checks.map((check) => `- [${check.status.toUpperCase()}] ${check.label}: ${check.detail}`).join("\n");
}
