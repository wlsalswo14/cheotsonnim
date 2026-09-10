import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class UnsafeUrlError extends Error {}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => acc * 256 + Number(part), 0) >>> 0;
}

function inRange(ip: number, cidr: string): boolean {
  const [base, bitsText] = cidr.split("/");
  const bits = Number(bitsText);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0);
}

const PRIVATE_V4 = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const n = ipv4ToInt(address);
    return PRIVATE_V4.some((cidr) => inRange(n, cidr));
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("fe80")) return true;
    if (lower.startsWith("::ffff:")) return isPrivateAddress(lower.slice(7));
    return false;
  }
  return true;
}

const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal", "instance-data"]);

export function normalizeInputUrl(raw: string): URL {
  let text = raw.trim();
  if (!text) throw new UnsafeUrlError("주소를 입력해 주세요.");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new UnsafeUrlError("올바른 웹 주소가 아닙니다.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError("http 또는 https 주소만 방문할 수 있습니다.");
  if (url.username || url.password) throw new UnsafeUrlError("아이디와 비밀번호가 포함된 주소는 방문하지 않습니다.");
  if (url.port && !["80", "443"].includes(url.port)) throw new UnsafeUrlError("80, 443 포트만 방문할 수 있습니다.");
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) {
    throw new UnsafeUrlError("공개된 인터넷 주소만 방문할 수 있습니다.");
  }
  url.hash = "";
  return url;
}

export async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new UnsafeUrlError("내부 네트워크 주소는 방문하지 않습니다.");
    return;
  }
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new UnsafeUrlError("주소를 찾을 수 없습니다. 도메인을 확인해 주세요.");
  }
  if (addresses.length === 0) throw new UnsafeUrlError("주소를 찾을 수 없습니다.");
  for (const entry of addresses) {
    if (isPrivateAddress(entry.address)) throw new UnsafeUrlError("내부 네트워크로 연결되는 주소는 방문하지 않습니다.");
  }
}

/** Fast synchronous check for request-time filtering inside the browser route handler. */
export function isObviouslyUnsafeRequestUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return true;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:" && url.protocol !== "data:" && url.protocol !== "blob:") return true;
  if (url.protocol === "data:" || url.protocol === "blob:") return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return true;
  if (isIP(host) && isPrivateAddress(host)) return true;
  return false;
}
