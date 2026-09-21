/**
 * Cross-check a listing against the user's search using Claude: the photo,
 * title and description are judged together so accessories, parts, want-ads
 * and look-alikes are filtered out of results.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { config, hasClaudeCredentials } from "../config.js";
import type { Listing } from "../types.js";

const Verdict = z.object({
  is_match: z.boolean().describe("true only if the listing is the actual item the user is searching for"),
  confidence: z.number().min(0).max(1),
  category: z
    .enum(["item", "accessory", "part", "want_ad", "service", "different_item", "unclear"])
    .describe("what the listing actually is"),
  reason: z.string().describe("one short sentence"),
});
export type LlmVerdict = z.infer<typeof Verdict>;

const SYSTEM = `You verify whether an online marketplace listing is the item a shopper searched for.
The shopper wants the item itself, not accessories, parts, cases, mounts, repair services, rentals, or "wanted"/"looking for" posts.
Look at the photo when one is provided; sellers often write vague titles. A different brand or model of the same kind of item still counts as a match.
Be strict about accessories: a "kayak rack" is not a kayak, "iPhone case" is not an iPhone.`;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export function llmAvailable(): boolean {
  return config.verifyMode !== "off" && hasClaudeCredentials();
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" } | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": config.userAgent } });
    clearTimeout(t);
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(ct)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 4_500_000) return null;
    return { data: buf.toString("base64"), mediaType: ct as "image/jpeg" };
  } catch {
    return null;
  }
}

export async function verifyListing(query: string, listing: Listing): Promise<LlmVerdict> {
  const content: Anthropic.ContentBlockParam[] = [];
  const img = listing.imageUrls[0] ? await fetchImageAsBase64(listing.imageUrls[0]) : null;
  if (img) {
    content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
  }
  content.push({
    type: "text",
    text: [
      `Search query: "${query}"`,
      `Listing title: ${listing.title}`,
      `Price: ${listing.isFree ? "Free" : listing.price == null ? "unknown" : `$${listing.price}`}`,
      `Description: ${(listing.description ?? "").slice(0, 1500) || "(none)"}`,
      img ? "The listing photo is attached." : "No photo was available.",
      "Is this listing the item the shopper searched for?",
    ].join("\n"),
  });

  const response = await getClient().messages.parse({
    model: config.claudeModel,
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    output_config: { effort: "low", format: zodOutputFormat(Verdict) },
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal" || !response.parsed_output) {
    return { is_match: false, confidence: 0, category: "unclear", reason: "Verifier could not classify this listing." };
  }
  return response.parsed_output;
}
