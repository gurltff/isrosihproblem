import type { Inspection } from "./api";
import brief from "../../../shared/vision_brief.json";

/** The visual inspection brief lives in shared/vision_brief.json, read by the server too. */
export const CHECKLIST: string[] = brief.checklist;
export const SYSTEM: string = brief.system;
export const SCHEMA = brief.schema;

export const MODEL = "claude-opus-5";

export function userText(expected?: string) {
  return (
    `Inspect this part. Checklist items, in this order:\n${CHECKLIST.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n` +
    (expected ? `Expected part for this lot: ${expected}.` : "No expected part was given.")
  );
}

const clamp = (v: number) => Math.min(1, Math.max(0, Number(v) || 0));

export function tidy(data: Inspection): Inspection {
  for (const f of data.findings ?? []) {
    f.confidence = clamp(f.confidence);
    const b = f.box;
    b.x = clamp(b.x);
    b.y = clamp(b.y);
    b.w = Math.min(clamp(b.w), 1 - b.x);
    b.h = Math.min(clamp(b.h), 1 - b.y);
  }
  return data;
}

async function toBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Hosted demo only: call Claude straight from the browser with a key the
 * user typed in (kept in this browser's storage, never in the site).
 */
export async function inspectWithClaudeInBrowser(image: Blob, apiKey: string, expected?: string): Promise<Inspection> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const params = {
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: await toBase64(image) } },
          { type: "text", text: userText(expected) },
        ],
      },
    ],
  };
  // `fallbacks` is newer than this SDK's typings; the request shape follows the API docs.
  const response = await client.beta.messages.create(params as unknown as Parameters<typeof client.beta.messages.create>[0]);
  const msg = response as unknown as { stop_reason: string; content: { type: string; text?: string }[] };
  if (msg.stop_reason === "refusal") throw new Error("Claude declined to inspect this image.");
  const text = msg.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("Claude returned no result.");
  return { ...tidy(JSON.parse(text)), engine: "claude", model: MODEL };
}

const KEY = "sentinel.anthropicKey";
export const savedKey = () => {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};
export const saveKey = (k: string) => {
  try {
    if (k) localStorage.setItem(KEY, k);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
};
