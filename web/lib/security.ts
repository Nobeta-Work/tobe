import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { promisify } from "node:util";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WebConfig } from "./config.ts";

const scrypt = promisify(scryptCallback);
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export class AccessControl {
  private readonly sessions = new Map<string, number>();
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  constructor(private config: WebConfig) {}

  get passwordRequired(): boolean { return Boolean(this.config.passwordHash); }

  updateConfig(config: WebConfig): void {
    this.config = config;
  }

  clientIp(request: IncomingMessage): string {
    if (this.config.trustProxy) {
      const forwarded = request.headers["x-forwarded-for"];
      const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
      if (first?.trim()) return normalizeIp(first.trim());
    }
    return normalizeIp(request.socket.remoteAddress || "");
  }

  isIpAllowed(ip: string): boolean {
    if (this.config.allowedIps.length === 0) return true;
    return this.config.allowedIps.some((rule) => matchesIpRule(ip, rule.trim()));
  }

  isAuthenticated(request: IncomingMessage): boolean {
    if (!this.passwordRequired) return true;
    const token = parseCookies(request.headers.cookie || "").tobe_web_session;
    if (!token) return false;
    const expires = this.sessions.get(token);
    if (!expires || expires <= Date.now()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  async login(ip: string, password: string): Promise<string | null> {
    const failure = this.failures.get(ip);
    if (failure && failure.resetAt > Date.now() && failure.count >= 8) return null;
    const expected = Buffer.from(this.config.passwordHash, "hex");
    const actual = await scrypt(password, this.config.passwordSalt, expected.length) as Buffer;
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) {
      this.failures.delete(ip);
      const token = randomBytes(32).toString("base64url");
      this.sessions.set(token, Date.now() + SESSION_TTL_MS);
      return token;
    }
    const current = failure && failure.resetAt > Date.now() ? failure : { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
    current.count += 1;
    this.failures.set(ip, current);
    return null;
  }

  issueSession(): string {
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(token, Date.now() + SESSION_TTL_MS);
    return token;
  }

  logout(request: IncomingMessage): void {
    const token = parseCookies(request.headers.cookie || "").tobe_web_session;
    if (token) this.sessions.delete(token);
  }

  setSessionCookie(response: ServerResponse, token: string): void {
    response.setHeader("Set-Cookie", `tobe_web_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`);
  }

  clearSessionCookie(response: ServerResponse): void {
    response.setHeader("Set-Cookie", "tobe_web_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
  }
}

function parseCookies(header: string): Record<string, string> {
  return Object.fromEntries(header.split(";").map((part) => part.trim().split("=", 2)).filter(([key]) => Boolean(key)));
}

function normalizeIp(ip: string): string {
  const zoneIndex = ip.indexOf("%");
  const withoutZone = zoneIndex >= 0 ? ip.slice(0, zoneIndex) : ip;
  return withoutZone.startsWith("::ffff:") ? withoutZone.slice(7) : withoutZone;
}

function matchesIpRule(ip: string, rule: string): boolean {
  if (!rule.includes("/")) return isIP(normalizeIp(rule)) > 0 && normalizeIp(rule) === ip;
  const [networkRaw, prefixRaw] = rule.split("/", 2);
  if (!networkRaw || !prefixRaw) return false;
  const network = normalizeIp(networkRaw);
  const version = isIP(ip);
  if (version === 0 || version !== isIP(network)) return false;
  const prefix = Number(prefixRaw);
  const bytes = version === 4 ? 4 : 16;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bytes * 8) return false;
  const ipBytes = addressBytes(ip, version);
  const networkBytes = addressBytes(network, version);
  const full = Math.floor(prefix / 8);
  const remaining = prefix % 8;
  for (let index = 0; index < full; index += 1) if (ipBytes[index] !== networkBytes[index]) return false;
  if (remaining === 0) return true;
  const mask = (0xff << (8 - remaining)) & 0xff;
  return ((ipBytes[full] ?? 0) & mask) === ((networkBytes[full] ?? 0) & mask);
}

export function isValidIpRule(rule: string): boolean {
  const trimmed = rule.trim();
  if (!trimmed.includes("/")) return isIP(normalizeIp(trimmed)) > 0;
  const [networkRaw, prefixRaw] = trimmed.split("/", 2);
  if (!networkRaw || !prefixRaw) return false;
  const version = isIP(normalizeIp(networkRaw));
  const prefix = Number(prefixRaw);
  return version > 0 && Number.isInteger(prefix) && prefix >= 0 && prefix <= (version === 4 ? 32 : 128);
}

function addressBytes(value: string, version: number): number[] {
  if (version === 4) return value.split(".").map(Number);
  const [leftRaw, rightRaw = ""] = value.split("::", 2);
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  const missing = 8 - left.length - right.length;
  const groups = [...left, ...Array(Math.max(0, missing)).fill("0"), ...right].map((group) => Number.parseInt(group || "0", 16));
  return groups.flatMap((group) => [group >> 8, group & 0xff]);
}

export function makeEtag(content: string): string {
  return `\"${createHash("sha256").update(content).digest("base64url")}\"`;
}
