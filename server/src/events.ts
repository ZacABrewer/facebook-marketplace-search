import { EventEmitter } from "node:events";

/** Process-wide event bus; the SSE endpoint forwards these to the browser. */
export const events = new EventEmitter();
events.setMaxListeners(100);

export type EventName = "job" | "listings" | "relevance" | "notification" | "watch";
