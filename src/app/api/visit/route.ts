import { NextRequest } from "next/server";

import { acquireSlot, checkRateLimit, queueDepth } from "@/lib/ratelimit";
import { findRecentByUrl } from "@/lib/store";
import type { VisitEvent } from "@/lib/types";
import { UnsafeUrlError, normalizeInputUrl } from "@/lib/url-safety";
import { runVisit } from "@/lib/visit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  return ip;
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: { url?: unknown; goal?: unknown; fresh?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }
  const rawUrl = typeof body.url === "string" ? body.url : "";
  const goal = typeof body.goal === "string" && body.goal.trim() ? body.goal.trim().slice(0, 120) : null;
  const fresh = body.fresh === true;

  let url: URL;
  try {
    url = normalizeInputUrl(rawUrl);
  } catch (error) {
    const message = error instanceof UnsafeUrlError ? error.message : "주소를 확인해 주세요.";
    return Response.json({ error: message }, { status: 400 });
  }

  if (!goal && !fresh) {
    const existing = await findRecentByUrl(url.toString()).catch(() => null);
    if (existing && Date.now() - new Date(existing.createdAt).getTime() < 6 * 60 * 60_000) {
      return Response.json({ existing: existing.id });
    }
  }

  const limit = checkRateLimit(clientKey(request));
  if (!limit.ok) {
    return Response.json({ error: `손님을 너무 자주 보내고 있어요. ${Math.ceil(limit.retryAfterSec / 60)}분 뒤에 다시 시도해 주세요.` }, { status: 429 });
  }
  if (queueDepth() >= 3) {
    return Response.json({ error: "지금 손님이 몰려 있어요. 1분 뒤에 다시 시도해 주세요." }, { status: 503 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: VisitEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          closed = true;
        }
      }, 10_000);
      let release: (() => void) | undefined;
      try {
        send({ t: "phase", phase: "queue", msg: "손님이 줄을 서는 중" });
        release = await acquireSlot();
        await runVisit({ url: url.toString(), goal, emit: send });
      } catch (error) {
        const message = error instanceof Error ? error.message : "알 수 없는 오류";
        console.error("visit failed:", message);
        send({ t: "error", message: message === "busy" ? "지금 손님이 몰려 있어요. 잠시 후 다시 시도해 주세요." : message });
      } finally {
        clearInterval(heartbeat);
        release?.();
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
