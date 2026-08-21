import type { AdapterActionDefinition } from "../../../adapter.ts";
import type { IIroseConfig } from "../config.ts";
import type { IIroseClient } from "../scripts/client.ts";

export const MUSIC_ACTIONS: readonly AdapterActionDefinition[] = [
  {
    action: "request_music",
    mode: "interact",
    description: "Search by song name and play the first result in the current IIROSE room.",
    parameters: { name: "non-empty song name, required" },
  },
];

interface NeteaseSong {
  id: number;
  name: string;
  duration: number;
  fee?: number;
  artists?: Array<{ name?: string }>;
  album?: { picUrl?: string; blurPicUrl?: string };
}

export interface RequestedSong {
  id: number;
  name: string;
  singer: string;
  cover: string;
  duration: number;
  url: string;
  link: string;
}

/** 搜索与 IIROSE 双帧点播。既供 Agent action 使用，也供本地 music 插件调用。 */
export async function requestMusic(client: IIroseClient, config: IIroseConfig, name: string): Promise<RequestedSong> {
  const keyword = name.trim();
  if (!keyword) throw new Error("Music name cannot be empty");
  const endpoint = new URL(config.plugins.music.searchEndpoint);
  endpoint.search = new URLSearchParams({ s: keyword, type: "1", limit: "1", offset: "0" }).toString();
  const response = await fetch(endpoint, {
    headers: { "user-agent": "Mozilla/5.0", referer: "https://music.163.com/" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Music search failed with HTTP ${response.status}`);
  const payload = await response.json() as { result?: { songs?: NeteaseSong[] } };
  const song = payload.result?.songs?.[0];
  if (!song) throw new Error(`No music result for: ${keyword}`);

  const music = config.plugins.music;
  const stream = new URL(music.streamEndpoint);
  stream.search = new URLSearchParams({
    platform: music.source,
    id: String(song.id),
    quality: String(music.quality),
    vip: String(song.fee ?? 0),
  }).toString();
  stream.hash = ".mp3";
  const result: RequestedSong = {
    id: song.id,
    name: song.name,
    singer: song.artists?.[0]?.name || "未知歌手",
    cover: song.album?.picUrl || song.album?.blurPicUrl || "http://r.iirose.com/i/26/3/6/4/5918-8B.png",
    duration: Math.ceil(song.duration / 1000),
    url: stream.toString(),
    link: `https://music.163.com/#/song?id=${song.id}`,
  };
  const messageId = `${Date.now()}`;
  const card = JSON.stringify({
    m: `m__4@0>${escapeEntity(result.name)}>${escapeEntity(result.singer)}>${result.cover}>${music.color}>${music.bitRate}`,
    mc: music.color,
    i: messageId,
  });
  const media = `&1${JSON.stringify({
    s: removeHttp(result.url),
    d: result.duration,
    c: removeHttp(result.cover),
    n: result.name,
    r: result.singer,
    b: "@0",
    o: removeHttp(result.link),
    l: "",
  })}`;
  await client.send(card);
  await client.send(media);
  return result;
}

function escapeEntity(value: string): string {
  return value.replace(/[<>&"']/g, (character) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}

function removeHttp(url: string): string { return url.startsWith("http") ? url.slice(4) : url; }
