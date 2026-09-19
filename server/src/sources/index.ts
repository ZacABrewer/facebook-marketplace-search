import { config } from "../config.js";
import { demoSource } from "./demo.js";
import { facebookSource } from "./facebook.js";
import type { SourceAdapter } from "../types.js";

export function getSource(name: string = config.source): SourceAdapter {
  return name === "facebook" ? facebookSource : demoSource;
}
