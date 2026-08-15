import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { permissionDeclaration } from "../../engine.ts";
import { ParticipationClassifier, directlyAddressesBot } from "./classifier.ts";
import { MonthlyMessageLog, type MessageLogEntry } from "./message-log.ts";
import { ActivePlugin } from "./plugins/active.ts";
import { parseIncomingFrame } from "./protocol.ts";
import { uploadIIroseMedia } from "./scripts/upload-media.ts";
import type { IIroseConfig } from "./config.ts";

const entry = (index: number): MessageLogEntry => ({
  receivedAt: new Date(2026, 7, 16).getTime(), timestamp: index, source: "room",
  eventType: "message.public", userId: `u${index}`, username: `U${index}`,
  text: `message ${index}`, isAdmin: false, mentioned: false, reply: false,
});

test("IIROSE trigger classifier uses the most recent ten messages and private policy", () => {
  const classifier = new ParticipationClassifier();
  assert.equal(classifier.assess([{ isAdmin: false }], { triggered: false, private: false, isAdmin: false }).trust, "off");
  assert.equal(classifier.assess([{ isAdmin: false }], { triggered: true, private: false, isAdmin: false }).trust, "low");
  assert.equal(classifier.assess([{ isAdmin: false }, { isAdmin: true }], { triggered: true, private: false, isAdmin: true }).trust, "medium");
  assert.equal(classifier.assess([{ isAdmin: true }], { triggered: true, private: false, isAdmin: true }).trust, "high");
  assert.equal(classifier.assess([], { triggered: true, private: true, isAdmin: false }).trust, "off");
  assert.equal(classifier.assess([], { triggered: true, private: true, isAdmin: true }).trust, "high");
  assert.equal(directlyAddressesBot("hello [*ToBe*]", "ToBe", ""), true);
  assert.equal(directlyAddressesBot("菲比你好", "ToBe", "菲比"), true);
});

test("monthly log uses YYYYMM and reads 1-based ranges from the newest message", async () => {
  const directory = await mkdtemp(join(tmpdir(), "iirose-log-"));
  try {
    const log = new MonthlyMessageLog(directory);
    for (let index = 1; index <= 20; index += 1) await log.append(entry(index));
    assert.equal(log.fileName(entry(1).receivedAt), "202608");
    assert.ok((await readFile(join(directory, "202608"), "utf8")).includes("message 20"));
    assert.deepEqual((await log.range(11, 20, entry(1).receivedAt)).map((item) => item.timestamp), [1,2,3,4,5,6,7,8,9,10]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("active plugin, room switch parsing, and engine permissions follow the contract", () => {
  const active = new ActivePlugin({ level: "low", longWindowMs: 100, shortWindowMs: 10 });
  active.shouldTrigger("room", true, 1_000);
  assert.equal(active.shouldTrigger("room", false, 1_050), true);
  assert.equal(active.shouldTrigger("room", false, 1_101), false);

  const frame = '"1700000000000>avatar>Admin>\'2room-2>unused>color>x>y>uid-admin>title>room-1>n';
  assert.equal(parseIncomingFrame(frame, "room-1")[0]?.targetRoomId, "room-2");
  assert.deepEqual(permissionDeclaration("low").allowedToolClasses, ["response", "retrieval_media"]);
  assert.equal(permissionDeclaration("medium").workspaceWrite, false);
  assert.equal(permissionDeclaration("high").workspaceWrite, true);
});

test("official IIROSE upload uses uid/i and f[] then joins the returned path", async () => {
  let request: Request | undefined;
  const fetchMock: typeof fetch = async (input, init) => {
    request = new Request(input, init);
    return new Response("i/26/8/16/6/4317-RI.png", { status: 200 });
  };
  const config = {
    credentials: { uid: "69ff206c035f1" },
    media: {
      uploadEndpoint: "https://f.iirose.com/lib/php/system/file_upload.php",
      publicBaseUrl: "http://r.iirose.com/", timeoutMs: 1000, maxBytes: 1024,
    },
  } as IIroseConfig;
  const uploaded = await uploadIIroseMedia(config, {
    artifact: {
      version: 1, id: "image:123456789abc", kind: "image", mimeType: "image/png",
      fileName: "test.png", size: 4, sha256: "x", origin: { type: "generated" },
    },
    data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  }, fetchMock);
  assert.equal(uploaded.url, "http://r.iirose.com/i/26/8/16/6/4317-RI.png");
  assert.ok(request);
  const form = await request.formData();
  assert.equal(form.get("i"), "69ff206c035f1");
  assert.equal((form.get("f[]") as File).name, "test.png");
});

test("official IIROSE upload accepts the m/ path returned for audio", async () => {
  const config = {
    credentials: { uid: "69ff206c035f1" },
    media: {
      uploadEndpoint: "https://f.iirose.com/lib/php/system/file_upload.php",
      publicBaseUrl: "http://r.iirose.com/", timeoutMs: 1000, maxBytes: 1024,
    },
  } as IIroseConfig;
  const uploaded = await uploadIIroseMedia(config, {
    artifact: {
      version: 1, id: "audio:123456789abc", kind: "audio", mimeType: "audio/wav",
      fileName: "test.wav", size: 4, sha256: "x", origin: { type: "generated" },
    }, data: new Uint8Array([0x52, 0x49, 0x46, 0x46]),
  }, async () => new Response("m/26/8/16/6/5132-LW.wav", { status: 200 }));
  assert.equal(uploaded.url, "http://r.iirose.com/m/26/8/16/6/5132-LW.wav");
});
