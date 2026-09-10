import { mkdir, copyFile, access, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright-core";

import type { PageFacts, PlannedAction, StepStatus, Viewport } from "./types";
import { isObviouslyUnsafeRequestUrl } from "./url-safety";

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 15; SM-S938N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36";

export const VIEWPORTS: Record<Viewport, { width: number; height: number }> = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
};

const COMMON_ARGS = ["--disable-blink-features=AutomationControlled", "--lang=ko-KR", "--hide-scrollbars"];

function runningOnServerless(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.CHEOTSONNIM_SERVERLESS);
}

/** Exactly what @sparticuz/chromium ships, rewritten only if its own copy is missing. */
const FONTCONFIG = `<?xml version="1.0" ?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>/var/task/.fonts</dir>
  <dir>/var/task/fonts</dir>
  <dir>/opt/fonts</dir>
  <dir>/tmp/fonts</dir>
  <cachedir>/tmp/fonts-cache/</cachedir>
  <config></config>
</fontconfig>
`;

/**
 * Must run AFTER chromium.executablePath(): that call inflates the package's fonts.tar.br
 * into /tmp/fonts, and its inflate() silently skips the whole archive when /tmp/fonts
 * already exists. Creating the directory first would cost us /tmp/fonts/fonts.conf — the
 * only file FONTCONFIG_PATH points at — and every screenshot would come back as tofu boxes.
 */
async function ensureFonts(): Promise<void> {
  const dir = "/tmp/fonts";
  const target = path.join(dir, "NotoSansKR.ttf");
  const conf = path.join(dir, "fonts.conf");
  try {
    await mkdir(dir, { recursive: true });
    try {
      await access(target);
    } catch {
      await copyFile(path.join(process.cwd(), "fonts", "NotoSansKR.ttf"), target);
    }
    try {
      await access(conf);
    } catch {
      await writeFile(conf, FONTCONFIG, "utf8");
    }
  } catch (error) {
    console.warn("font provisioning skipped:", (error as Error).message);
  }
}

export async function launchBrowser(): Promise<Browser> {
  if (runningOnServerless()) {
    const chromium = (await import("@sparticuz/chromium")).default;
    const executablePath = await chromium.executablePath();
    await ensureFonts();
    const { chromium: playwright } = await import("playwright-core");
    return playwright.launch({
      args: [...chromium.args, ...COMMON_ARGS],
      executablePath,
      headless: true,
    });
  }
  const { chromium } = await import("playwright");
  // Playwright defaults to the unsigned chrome-headless-shell build, which Windows
  // Application Control policies refuse to spawn ("spawn UNKNOWN"). The full Chromium
  // build launches fine and is what the product promises anyway ("real Chromium").
  try {
    return await chromium.launch({ headless: true, channel: "chromium", args: COMMON_ARGS });
  } catch (error) {
    console.warn("full chromium launch failed, falling back to headless shell:", (error as Error).message.split("\n")[0]);
    return await chromium.launch({ headless: true, args: COMMON_ARGS });
  }
}

export interface PageSession {
  viewport: Viewport;
  context: BrowserContext;
  page: Page;
  consoleErrors: string[];
  failedRequests: string[];
  close(): Promise<void>;
}

export async function openSession(browser: Browser, viewport: Viewport): Promise<PageSession> {
  const size = VIEWPORTS[viewport];
  const context = await browser.newContext({
    viewport: size,
    userAgent: viewport === "mobile" ? MOBILE_UA : DESKTOP_UA,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    isMobile: viewport === "mobile",
    hasTouch: viewport === "mobile",
    deviceScaleFactor: 1,
    colorScheme: "light",
    serviceWorkers: "block",
    extraHTTPHeaders: { "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7" },
  });
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (isObviouslyUnsafeRequestUrl(request.url())) {
      await route.abort("blockedbyclient");
      return;
    }
    if (request.resourceType() === "media") {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  const session: PageSession = {
    viewport,
    context,
    page: await context.newPage(),
    consoleErrors,
    failedRequests,
    close: async () => {
      await context.close().catch(() => undefined);
    },
  };
  const wire = (page: Page) => {
    page.on("console", (message) => {
      if (message.type() === "error" && consoleErrors.length < 30) consoleErrors.push(message.text().slice(0, 240));
    });
    page.on("pageerror", (error) => {
      if (consoleErrors.length < 30) consoleErrors.push(`Uncaught: ${error.message.slice(0, 240)}`);
    });
    page.on("requestfailed", (request) => {
      const failure = request.failure()?.errorText ?? "";
      if (failure.includes("blockedbyclient") || failure.includes("ERR_ABORTED")) return;
      if (failedRequests.length < 30) failedRequests.push(`${request.method()} ${request.url().slice(0, 160)} (${failure})`);
    });
    page.on("response", (response) => {
      if (response.status() >= 400 && response.request().resourceType() !== "document" && failedRequests.length < 30) {
        failedRequests.push(`${response.status()} ${response.url().slice(0, 160)}`);
      }
    });
  };
  wire(session.page);
  context.on("page", (popup) => {
    wire(popup);
    session.page = popup;
  });
  return session;
}

export interface NavigationResult {
  status: number | null;
  loadMs: number;
}

export async function navigate(session: PageSession, url: string, timeoutMs = 20_000): Promise<NavigationResult> {
  const started = Date.now();
  const page = session.page;
  let response;
  try {
    response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  } catch (error) {
    const message = (error as Error).message;
    if (/ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_SSL|ERR_CERT|net::/.test(message)) {
      throw new Error(`사이트에 연결하지 못했습니다 (${message.match(/net::[A-Z_]+/)?.[0] ?? "connection error"}).`);
    }
    if (/Timeout/i.test(message)) {
      throw new Error(`사이트가 ${Math.round(timeoutMs / 1000)}초 안에 응답하지 않았습니다.`);
    }
    throw error;
  }
  const loadMs = Date.now() - started;
  await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  return { status: response?.status() ?? null, loadMs };
}

export interface Screenshot {
  base64: string;
  width: number;
  height: number;
  url: string;
  /** The frame carries no detail — a single flat colour, whatever that colour is. */
  blank: boolean;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A JPEG of a single flat colour costs almost nothing beyond its own headers, and the cost
 * is the same whether that colour is black, white or a dimmed backdrop. Measured at the
 * quality 55 this file captures with:
 *
 *   1280x800 solid (black/white/gray/dim) 6757B · one line of text 7949B · real page 24-77KB
 *    390x844 solid                        2745B · one line of text 3937B · real page 23KB
 *
 * which fits `845 + 0.0058 * pixels` almost exactly. Flagging at 1.12x of that keeps a page
 * holding a single sentence out of it while still catching every uniform frame; a page that
 * shows nothing but a loading spinner does trip it, which is the honest answer anyway.
 */
function looksBlank(bytes: number, width: number, height: number): boolean {
  return bytes < (900 + 0.0058 * width * height) * 1.12;
}

/** Chromium can hand back the frame from before a scroll; wait until a new one is painted. */
async function waitForPaint(page: Page): Promise<void> {
  await page
    .evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    .catch(() => undefined);
}

/**
 * Chromium refuses to capture while the renderer is swapping documents
 * ("Protocol error (Page.captureScreenshot): Unable to capture screenshot"), which used to
 * abort the whole visit right after a click that started a navigation. Settle first, retry a
 * few times, and return null rather than losing the run over one missing photo. A frame that
 * comes back blank buys one extra wait-and-retake before we accept it as what the customer
 * really saw.
 */
export async function screenshotJpeg(session: PageSession, quality = 55): Promise<Screenshot | null> {
  let blankShot: Screenshot | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // A popup may have replaced session.page between attempts, so re-read it every time.
    const page = session.page;
    if (page.isClosed()) return blankShot;
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 6_000 }).catch(() => undefined);
      await waitForPaint(page);
      const buffer = await page.screenshot({ type: "jpeg", quality, fullPage: false, animations: "disabled", caret: "hide", timeout: 15_000 });
      const size = page.viewportSize() ?? VIEWPORTS[session.viewport];
      const shot: Screenshot = {
        base64: buffer.toString("base64"),
        width: size.width,
        height: size.height,
        url: page.url(),
        blank: looksBlank(buffer.length, size.width, size.height),
      };
      if (!shot.blank || blankShot) {
        if (shot.blank) console.warn(`screenshot still blank after a retake (${buffer.length}B at ${size.width}x${size.height})`);
        return shot;
      }
      blankShot = shot;
      await sleep(800);
    } catch (error) {
      const message = (error as Error).message.split("\n")[0];
      if (attempt === 2) {
        console.warn("screenshot skipped after 3 attempts:", message);
        return blankShot;
      }
      await sleep(600 * (attempt + 1));
    }
  }
  return blankShot;
}

export interface InventoryItem {
  i: number;
  tag: string;
  role: string;
  text: string;
  href: string | null;
  type: string | null;
  inViewport: boolean;
}

/**
 * Runs after every action, so it can land while the page is still swapping documents
 * ("Execution context was destroyed"). One retry after the document settles, then an empty
 * inventory — the planner simply sees nothing clickable instead of the run dying.
 */
export async function inventory(session: PageSession, limit = 70): Promise<InventoryItem[]> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await collectInventory(session, limit);
    } catch (error) {
      if (attempt === 1) {
        console.warn("inventory failed:", (error as Error).message.split("\n")[0]);
        return [];
      }
      await session.page.waitForLoadState("domcontentloaded", { timeout: 6_000 }).catch(() => undefined);
      await sleep(500);
    }
  }
  return [];
}

async function collectInventory(session: PageSession, limit: number): Promise<InventoryItem[]> {
  const page = session.page;
  const items = await page.evaluate((max) => {
    const selector = "a[href], button, input, select, textarea, summary, [role='button'], [role='link'], [role='tab'], [role='menuitem'], [role='checkbox'], [role='radio'], [role='switch'], [onclick], [tabindex]:not([tabindex='-1'])";
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const seen = new Set<HTMLElement>();
    const results: { i: number; tag: string; role: string; text: string; href: string | null; type: string | null; inViewport: boolean; top: number; left: number }[] = [];
    const clean = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
    const nameOf = (el: HTMLElement) => {
      const aria = clean(el.getAttribute("aria-label"));
      if (aria) return aria;
      const labelled = clean(el.getAttribute("aria-labelledby"));
      if (labelled) {
        const text = labelled.split(/\s+/).map((id) => clean(document.getElementById(id)?.textContent)).join(" ").trim();
        if (text) return text;
      }
      const inner = clean(el.innerText);
      if (inner) return inner;
      const img = el.querySelector("img[alt]");
      const alt = clean(img?.getAttribute("alt"));
      if (alt) return alt;
      const value = clean((el as HTMLInputElement).value);
      if (value && (el as HTMLInputElement).type !== "password") return value;
      return clean(el.getAttribute("placeholder")) || clean(el.getAttribute("title")) || clean(el.getAttribute("name"));
    };
    let index = 0;
    for (const el of nodes) {
      if (seen.has(el)) continue;
      seen.add(el);
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) continue;
      if (rect.bottom < -2000 || rect.top > window.innerHeight * 4) continue;
      const tag = el.tagName.toLowerCase();
      if (tag === "input" && (el as HTMLInputElement).type === "hidden") continue;
      const text = nameOf(el).slice(0, 60);
      if (!text && tag !== "input" && tag !== "textarea" && tag !== "select") continue;
      if (tag === "a" && (el as HTMLAnchorElement).target === "_blank") (el as HTMLAnchorElement).target = "_self";
      index += 1;
      el.setAttribute("data-cs-idx", String(index));
      let href: string | null = null;
      if (tag === "a") {
        try {
          const url = new URL((el as HTMLAnchorElement).href, location.href);
          href = url.origin === location.origin ? url.pathname + url.search : url.href;
          href = href.slice(0, 80);
        } catch {
          href = null;
        }
      }
      results.push({
        i: index,
        tag,
        role: el.getAttribute("role") ?? "",
        text,
        href,
        type: tag === "input" ? (el as HTMLInputElement).type : null,
        inViewport: rect.top < window.innerHeight && rect.bottom > 0 && rect.left < window.innerWidth && rect.right > 0,
        top: rect.top,
        left: rect.left,
      });
    }
    results.sort((a, b) => Number(b.inViewport) - Number(a.inViewport) || a.top - b.top || a.left - b.left);
    return results.slice(0, max).map(({ top: _top, left: _left, ...rest }) => rest);
  }, limit);
  return items;
}

export function formatInventory(items: InventoryItem[]): string {
  return items
    .map((item) => {
      const bits = [`#${item.i}`, item.tag + (item.type ? `[${item.type}]` : ""), item.role ? `role=${item.role}` : "", JSON.stringify(item.text)];
      if (item.href) bits.push(`→ ${item.href}`);
      if (!item.inViewport) bits.push("(화면 밖, 스크롤 필요)");
      return bits.filter(Boolean).join(" ");
    })
    .join("\n");
}

export async function collectFacts(session: PageSession, requestedUrl: string, navigation: NavigationResult): Promise<PageFacts> {
  const page = session.page;
  const evaluated = await page.evaluate(() => {
    const clean = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
    const visible = (el: Element) => {
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const meta = (name: string) =>
      document.querySelector<HTMLMetaElement>(`meta[name='${name}']`)?.content ?? document.querySelector<HTMLMetaElement>(`meta[property='${name}']`)?.content ?? null;
    const images = Array.from(document.images).filter(visible);
    const imgMissingAlt = images.filter((img) => !img.hasAttribute("alt") && img.getAttribute("role") !== "presentation").length;
    const controls = Array.from(document.querySelectorAll<HTMLElement>("a[href], button, [role='button'], input[type='submit'], input[type='button']")).filter(visible);
    const accessibleName = (el: HTMLElement) => {
      const aria = clean(el.getAttribute("aria-label")) || clean(el.getAttribute("aria-labelledby"));
      const text = clean(el.innerText) || clean(el.getAttribute("title")) || clean(el.querySelector("img")?.getAttribute("alt")) || clean((el as HTMLInputElement).value);
      const svgTitle = clean(el.querySelector("svg title")?.textContent);
      return Boolean(aria || text || svgTitle);
    };
    const controlsMissingName = controls.filter((el) => !accessibleName(el)).length;
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")).filter(
      (el) => visible(el) && !["hidden", "submit", "button", "image", "reset"].includes((el as HTMLInputElement).type),
    );
    const hasLabel = (el: HTMLElement) => {
      if (clean(el.getAttribute("aria-label")) || clean(el.getAttribute("aria-labelledby"))) return true;
      if (el.id && document.querySelector(`label[for='${CSS.escape(el.id)}']`)) return true;
      if (el.closest("label")) return true;
      return Boolean(clean(el.getAttribute("placeholder")) || clean(el.getAttribute("title")));
    };
    const inputsMissingLabel = inputs.filter((el) => !hasLabel(el)).length;
    const smallTapTargets = controls.filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.top < window.innerHeight * 2 && (rect.width < 40 || rect.height < 40) && rect.width < 120;
    }).length;
    let tinyTextCount = 0;
    let sampled = 0;
    const walker = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
    const checked = new Set<Element>();
    while (sampled < 900) {
      const node = walker.nextNode();
      if (!node) break;
      const parent = node.parentElement;
      if (!parent || checked.has(parent) || !clean(node.textContent)) continue;
      checked.add(parent);
      sampled += 1;
      if (!visible(parent)) continue;
      const size = parseFloat(getComputedStyle(parent).fontSize);
      if (size > 0 && size < 12) tinyTextCount += 1;
    }
    const bodyText = clean(document.body?.innerText).slice(0, 1600);
    const title = clean(document.title);
    const botBlocked =
      /access denied|attention required|just a moment|are you (a )?human|verify you are|captcha|403 forbidden|request blocked|접근이 차단|비정상적인 접근/i.test(`${title} ${bodyText.slice(0, 400)}`) ||
      (/cloudfront/i.test(bodyText) && /could not be satisfied|request blocked/i.test(bodyText));
    return {
      title,
      metaDescription: clean(meta("description")) || null,
      viewportMeta: Boolean(document.querySelector("meta[name='viewport']")),
      lang: document.documentElement.getAttribute("lang"),
      h1Count: document.querySelectorAll("h1").length,
      imgCount: images.length,
      imgMissingAlt,
      controlCount: controls.length,
      controlsMissingName,
      inputCount: inputs.length,
      inputsMissingLabel,
      overflowPx: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      smallTapTargets,
      tinyTextCount,
      favicon: Boolean(document.querySelector("link[rel~='icon'], link[rel='shortcut icon'], link[rel='apple-touch-icon']")),
      ogTitle: Boolean(meta("og:title")),
      ogImage: Boolean(meta("og:image")),
      textSample: bodyText,
      wordCount: bodyText ? bodyText.split(/\s+/).length : 0,
      domNodes: document.getElementsByTagName("*").length,
      botBlocked,
    };
  });
  const finalUrl = page.url();
  const status = navigation.status;
  return {
    requestedUrl,
    finalUrl,
    status,
    https: finalUrl.startsWith("https://"),
    loadMs: navigation.loadMs,
    consoleErrors: [...session.consoleErrors],
    failedRequests: [...session.failedRequests],
    ...evaluated,
    botBlocked: evaluated.botBlocked || status === 403 || status === 429 || status === 503,
  };
}

const DANGEROUS_TEXT = /(결제|구매|주문|삭제|탈퇴|송금|이체|환불|취소하기|checkout|purchase|buy now|pay now|payment|delete|remove|unsubscribe|deactivate)/i;
const SAFE_KEYS = new Set(["Enter", "Escape", "Tab", "ArrowDown", "ArrowUp", "PageDown", "End", "Home"]);

export interface ActionOutcome {
  status: StepStatus;
  note: string | null;
  targetDescription: string | null;
  urlAfter: string;
  /** scroll only: did the screen move, was it held down, or is there simply nothing below? */
  scrollResult?: "moved" | "blocked" | "nothing";
}

function describe(item: InventoryItem | undefined): string | null {
  if (!item) return null;
  return `${item.tag}${item.type ? `[${item.type}]` : ""} "${item.text}"`;
}

/**
 * Playwright's own English message ("page.waitForTimeout: Target page, context or browser
 * has been closed") used to land in the step log and in the jury prompt, where it was read
 * as a defect of the site: 11st.co.kr got "자바스크립트 리소스 오류를 고치세요" for a popup
 * our own driver had closed. Say what the customer saw instead; keep the raw text when the
 * cause is unknown rather than inventing one.
 */
function humanError(full: string): string | null {
  // Playwright puts "…intercepts pointer events" in the call log, several lines below the
  // headline "Timeout 7000ms exceeded" — reading only the first line turned two blocked
  // clicks on musinsa.com into a meaningless "제한 시간 안에 반응하지 않았습니다". Match the
  // whole message, and keep the specific causes ahead of the generic timeout.
  if (/intercepts pointer events/i.test(full)) return "팝업이나 다른 요소가 가려서 누르지 못했습니다";
  if (/Target page, context or browser has been closed|Target closed/i.test(full)) return "누르자마자 창이 닫혀 다음 화면을 보지 못했습니다";
  if (/element is not visible|outside of the viewport/i.test(full)) return "화면에 보이지 않는 자리에 있어 누를 수 없었습니다";
  if (/not attached to the DOM|detached|element is not stable/i.test(full)) return "누르려는 순간 화면이 바뀌어 사라졌습니다";
  if (/net::|ERR_[A-Z_]+/.test(full)) return "페이지를 불러오지 못했습니다";
  if (/Timeout .*exceeded/i.test(full)) return "제한 시간 안에 반응하지 않았습니다";
  return null;
}

/**
 * A click that dumps the customer on Chromium's own error page is not a completed step.
 * Reporting it as "완료" made the jury describe a working link and hid the dead end.
 */
function landedOnErrorPage(url: string): boolean {
  return url.startsWith("chrome-error://") || url.startsWith("chrome://network-error");
}

function syntheticText(item: InventoryItem, requested: string): string | null {
  const hint = `${item.text} ${item.type ?? ""}`.toLowerCase();
  if (item.type === "password" || /password|비밀번호|card|카드|cvc|cvv|주민|계좌/.test(hint)) return null;
  if (item.type === "email" || /e-?mail|이메일|메일/.test(hint)) return "test@cheotsonnim.app";
  if (item.type === "tel" || /phone|tel|전화|휴대/.test(hint)) return "01000000000";
  if (/이름|name/.test(hint) && !/user|아이디|id/.test(hint)) return "김첫손";
  return requested.slice(0, 80);
}

export async function performAction(session: PageSession, action: PlannedAction, items: InventoryItem[]): Promise<ActionOutcome> {
  const page = session.page;
  const before = page.url();
  const item = action.target !== undefined ? items.find((entry) => entry.i === action.target) : undefined;
  const settle = async () => {
    await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
    await page.waitForTimeout(600);
  };
  try {
    if (action.type === "scroll") {
      const height = (page.viewportSize() ?? VIEWPORTS[session.viewport]).height;
      // scrollHeight tells us whether there was anywhere to go: a one-screen page that does
      // not move is not the same story as a modal holding the page down, and calling both
      // "팝업에 막혀" mislabels every short landing page.
      const metrics = () =>
        page
          .evaluate(() => {
            const el = document.scrollingElement ?? document.documentElement;
            return { y: window.scrollY || el.scrollTop || 0, room: Math.max(0, el.scrollHeight - el.clientHeight) };
          })
          .catch(() => null);
      const before = await metrics();
      await page.mouse.wheel(0, Math.round(height * 0.85));
      await page.waitForTimeout(700);
      const after = await metrics();
      let scrollResult: ActionOutcome["scrollResult"] = "moved";
      if (before && after) {
        if (Math.abs(after.y - before.y) >= 8) scrollResult = "moved";
        else if (before.room <= 8) scrollResult = "nothing";
        else scrollResult = "blocked";
      }
      const note = {
        moved: "한 화면 아래로 스크롤",
        blocked: "화면이 내려가지 않았습니다(팝업이 화면을 붙잡고 있는 것 같습니다)",
        nothing: "더 내려갈 내용이 없습니다(한 화면에 다 들어옵니다)",
      }[scrollResult];
      return { status: "done", note, targetDescription: null, urlAfter: page.url(), scrollResult };
    }
    if (action.type === "back") {
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 10_000 }).catch(() => undefined);
      await settle();
      return { status: "done", note: "이전 페이지로", targetDescription: null, urlAfter: page.url() };
    }
    if (action.type === "press") {
      const key = action.key ?? "Enter";
      if (!SAFE_KEYS.has(key)) return { status: "skipped_safety", note: `허용되지 않은 키: ${key}`, targetDescription: null, urlAfter: before };
      const protectedForm = await page.evaluate(() => Boolean(document.activeElement?.closest("form")?.querySelector("input[type='password'], input[autocomplete*='cc-']")));
      if (key === "Enter" && protectedForm) return { status: "skipped_safety", note: "비밀번호·카드 정보가 있는 폼은 제출하지 않습니다", targetDescription: null, urlAfter: before };
      await page.keyboard.press(key);
      await settle();
      if (landedOnErrorPage(page.url())) {
        return { status: "failed", note: `${key} 키를 눌렀지만 페이지가 열리지 않았습니다(브라우저 오류 화면)`, targetDescription: null, urlAfter: page.url() };
      }
      return { status: "done", note: `${key} 키 입력`, targetDescription: null, urlAfter: page.url() };
    }
    if (!item) return { status: "not_found", note: `#${action.target ?? "?"} 요소를 찾지 못함`, targetDescription: null, urlAfter: before };
    const locator = page.locator(`[data-cs-idx="${item.i}"]`).first();
    if (action.type === "click") {
      if (DANGEROUS_TEXT.test(item.text) || DANGEROUS_TEXT.test(item.href ?? "")) {
        return { status: "skipped_safety", note: "결제·삭제·탈퇴처럼 되돌리기 어려운 행동은 손님이 하지 않습니다", targetDescription: describe(item), urlAfter: before };
      }
      await locator.scrollIntoViewIfNeeded({ timeout: 4_000 }).catch(() => undefined);
      await locator.click({ timeout: 7_000 });
      await settle();
      if (landedOnErrorPage(page.url())) {
        return { status: "failed", note: "링크를 눌렀지만 페이지가 열리지 않았습니다(브라우저 오류 화면)", targetDescription: describe(item), urlAfter: page.url() };
      }
      return { status: "done", note: null, targetDescription: describe(item), urlAfter: page.url() };
    }
    if (action.type === "type") {
      if (!["input", "textarea"].includes(item.tag) && !item.role.includes("textbox")) {
        return { status: "failed", note: "입력창이 아닌 요소", targetDescription: describe(item), urlAfter: before };
      }
      const value = syntheticText(item, action.text ?? "");
      if (value === null) return { status: "skipped_safety", note: "비밀번호·카드·주민번호 입력창에는 아무것도 입력하지 않습니다", targetDescription: describe(item), urlAfter: before };
      await locator.scrollIntoViewIfNeeded({ timeout: 4_000 }).catch(() => undefined);
      await locator.click({ timeout: 5_000 }).catch(() => undefined);
      await locator.fill(value, { timeout: 5_000 });
      await page.waitForTimeout(400);
      return { status: "done", note: `"${value}" 입력`, targetDescription: describe(item), urlAfter: page.url() };
    }
    return { status: "failed", note: "알 수 없는 행동", targetDescription: describe(item), urlAfter: before };
  } catch (error) {
    const full = (error as Error).message;
    let urlAfter = before;
    try {
      urlAfter = page.url();
    } catch {
      // the page went away with the error; the address before the action is the honest one
    }
    return { status: "failed", note: humanError(full) ?? full.split("\n")[0].slice(0, 160), targetDescription: describe(item), urlAfter };
  }
}

/** Same retry contract as screenshotJpeg: a missing card thumbnail must never kill a visit. */
export async function thumbnail(session: PageSession): Promise<string | null> {
  const page = session.page;
  if (page.isClosed()) return null;
  const original = page.viewportSize() ?? VIEWPORTS[session.viewport];
  try {
    await page.setViewportSize({ width: 640, height: 400 });
    // Resizing re-triggers entrance animations and lazy images; 250ms gave a blank card on
    // toss.im (3KB vs 13KB), 800ms is enough for every site measured.
    await sleep(800);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await page.waitForLoadState("domcontentloaded", { timeout: 6_000 }).catch(() => undefined);
        const buffer = await page.screenshot({ type: "jpeg", quality: 42, animations: "disabled", timeout: 15_000 });
        return buffer.toString("base64");
      } catch (error) {
        if (attempt === 2) {
          console.warn("thumbnail skipped after 3 attempts:", (error as Error).message.split("\n")[0]);
          return null;
        }
        await sleep(600 * (attempt + 1));
      }
    }
    return null;
  } catch (error) {
    console.warn("thumbnail failed:", (error as Error).message.split("\n")[0]);
    return null;
  } finally {
    await page.setViewportSize(original).catch(() => undefined);
  }
}
