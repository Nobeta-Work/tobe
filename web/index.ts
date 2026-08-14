import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { AgentHost } from "./agent/host.ts";
import { hashPassword, loadWebConfig, saveWebConfig, type WebConfig } from "./lib/config.ts";
import { PUBLIC_DIR } from "./lib/paths.ts";
import { AccessControl, isValidIpRule } from "./lib/security.ts";
import { getAdapter, HttpError, listAdapters, saveAdapter } from "./modules/awareness.ts";
import { listMemory, readMemory, saveMemory } from "./modules/memory.ts";

let config = await loadWebConfig();
const access = new AccessControl(config);
const agent = new AgentHost();
const eventClients = new Set<ServerResponse>();

agent.on("event", (event: unknown) => broadcast(event));

const server = createServer((request, response) => {
  void handle(request, response).catch((error: unknown) => handleError(response, error));
});

server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"));
server.listen(config.port, config.host, () => {
  console.log(`ToBe Web listening on http://${displayHost(config.host)}:${config.port}`);
  console.log(config.allowedIps.length ? `IP whitelist: ${config.allowedIps.join(", ")}` : "IP whitelist: open access");
  console.log(access.passwordRequired ? "Password authentication: enabled" : "Password authentication: disabled");
});

for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  void agent.shutdown().finally(() => server.close(() => process.exit(0)));
});

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  setSecurityHeaders(response);
  const ip = access.clientIp(request);
  if (!access.isIpAllowed(ip)) throw new HttpError(403, "当前 IP 不在访问白名单中");
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(request, response, url, ip);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") throw new HttpError(405, "Method not allowed");
  await serveStatic(response, url.pathname, request.method === "HEAD");
}

async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL, ip: string): Promise<void> {
  if (isCrossSiteMutation(request)) throw new HttpError(403, "Cross-site request rejected");

  if (request.method === "GET" && url.pathname === "/api/auth/session") {
    json(response, 200, { passwordRequired: access.passwordRequired, authenticated: access.isAuthenticated(request) });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    if (!access.passwordRequired) { json(response, 200, { authenticated: true }); return; }
    const body = await readJson(request) as { password?: unknown };
    const token = await access.login(ip, typeof body.password === "string" ? body.password : "");
    if (!token) throw new HttpError(401, "密码错误或尝试次数过多");
    access.setSessionCookie(response, token);
    json(response, 200, { authenticated: true });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    access.logout(request);
    access.clearSessionCookie(response);
    json(response, 200, { authenticated: false });
    return;
  }
  if (!access.isAuthenticated(request)) throw new HttpError(401, "需要登录");

  if (request.method === "PUT" && url.pathname === "/api/access") {
    const body = await readJson(request) as { passwordEnabled?: unknown; password?: unknown; allowedIps?: unknown };
    const passwordEnabled = body.passwordEnabled === true;
    const password = typeof body.password === "string" ? body.password : "";
    if (!Array.isArray(body.allowedIps) || !body.allowedIps.every((value) => typeof value === "string")) throw new HttpError(400, "IP 白名单必须是文本列表");
    const allowedIps = [...new Set(body.allowedIps.map((value) => value.trim()).filter(Boolean))];
    const invalidRule = allowedIps.find((rule) => !isValidIpRule(rule));
    if (invalidRule) throw new HttpError(400, `IP 或 CIDR 格式无效: ${invalidRule}`);
    const wasPasswordRequired = access.passwordRequired;
    let next: WebConfig = { ...config, allowedIps };
    if (!passwordEnabled) next = { ...next, passwordHash: "", passwordSalt: "" };
    else if (password) {
      const credentials = await hashPassword(password);
      next = { ...next, passwordHash: credentials.hash, passwordSalt: credentials.salt };
    } else if (!next.passwordHash) throw new HttpError(400, "启用密码访问时必须填写新密码");
    await saveWebConfig(next);
    config = next;
    access.updateConfig(next);
    if (!wasPasswordRequired && passwordEnabled) access.setSessionCookie(response, access.issueSession());
    if (!passwordEnabled) access.clearSessionCookie(response);
    json(response, 200, { passwordEnabled: access.passwordRequired, allowedIps, currentIp: ip });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/bootstrap") {
    const [adapters, memory] = await Promise.all([listAdapters(), listMemory()]);
    json(response, 200, {
      agent: agent.snapshot(), adapters, memory, sessionName: "tobe",
      access: { passwordEnabled: access.passwordRequired, allowedIps: config.allowedIps, currentIp: ip },
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/events") { openEventStream(request, response); return; }
  if (request.method === "POST" && url.pathname === "/api/agent/start") { json(response, 200, await agent.start()); return; }
  if (request.method === "POST" && url.pathname === "/api/agent/stop") { json(response, 200, await agent.stop()); return; }
  if (request.method === "POST" && url.pathname === "/api/agent/abort") { await agent.abort(); json(response, 200, { aborted: true }); return; }
  if (request.method === "GET" && url.pathname === "/api/agent/state") { json(response, 200, await agent.refreshState()); return; }
  if (request.method === "GET" && url.pathname === "/api/agent/messages") { json(response, 200, { messages: await agent.messages() }); return; }
  if (request.method === "POST" && url.pathname === "/api/agent/prompt") {
    const body = await readJson(request) as { message?: unknown };
    await agent.prompt(typeof body.message === "string" ? body.message : "");
    json(response, 202, { accepted: true });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/adapters") { json(response, 200, { adapters: await listAdapters() }); return; }
  const adapterMatch = /^\/api\/adapters\/([a-z0-9-]+)$/.exec(url.pathname);
  if (adapterMatch?.[1] && request.method === "GET") { json(response, 200, await getAdapter(adapterMatch[1])); return; }
  if (adapterMatch?.[1] && request.method === "PUT") { json(response, 200, await saveAdapter(adapterMatch[1], await readJson(request))); return; }

  if (request.method === "GET" && url.pathname === "/api/memory") { json(response, 200, { entries: await listMemory() }); return; }
  const memoryMatch = /^\/api\/memory\/(.+)$/.exec(url.pathname);
  if (memoryMatch?.[1]) {
    const id = decodeURIComponent(memoryMatch[1]);
    if (request.method === "GET") { json(response, 200, await readMemory(id)); return; }
    if (request.method === "PUT") {
      const body = await readJson(request) as { content?: unknown };
      await saveMemory(id, body.content);
      json(response, 200, { saved: true });
      return;
    }
  }
  throw new HttpError(404, "API 不存在");
}

function openEventStream(request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.write(`event: ready\ndata: ${JSON.stringify({ type: "agent.state", data: agent.snapshot() })}\n\n`);
  eventClients.add(response);
  const keepAlive = setInterval(() => response.write(": keep-alive\n\n"), 20_000);
  request.on("close", () => { clearInterval(keepAlive); eventClients.delete(response); });
}

function broadcast(event: unknown): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of eventClients) client.write(payload);
}

async function serveStatic(response: ServerResponse, pathname: string, headOnly: boolean): Promise<void> {
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const clean = normalize(relative);
  if (clean.startsWith("..") || clean.includes(":")) throw new HttpError(404, "Not found");
  const path = join(PUBLIC_DIR, clean);
  let fileStat;
  try { fileStat = await stat(path); } catch { throw new HttpError(404, "Not found"); }
  if (!fileStat.isFile()) throw new HttpError(404, "Not found");
  response.writeHead(200, { "Content-Type": mimeType(path), "Content-Length": fileStat.size, "Cache-Control": "no-cache" });
  if (headOnly) response.end(); else createReadStream(path).pipe(response);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body, "utf8") > 1_100_000) throw new HttpError(413, "请求内容过大");
  }
  try { return body ? JSON.parse(body) as unknown : {}; }
  catch { throw new HttpError(400, "JSON 格式无效"); }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const value = JSON.stringify(body);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(value) });
  response.end(value);
}

function handleError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) { response.end(); return; }
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Internal server error";
  if (status >= 500) console.error(error);
  json(response, status, { error: message });
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: https://nobeta.cn; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function isCrossSiteMutation(request: IncomingMessage): boolean {
  return request.method !== "GET" && request.method !== "HEAD" && request.headers["sec-fetch-site"] === "cross-site";
}

function mimeType(path: string): string {
  return ({ ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" } as Record<string, string>)[extname(path)] || "application/octet-stream";
}

function displayHost(host: string): string { return host === "0.0.0.0" ? "localhost" : host; }
