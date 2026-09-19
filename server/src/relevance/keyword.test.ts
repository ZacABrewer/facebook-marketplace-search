import { test } from "node:test";
import assert from "node:assert/strict";
import { keywordScore, isAmbiguous, tokenize } from "./keyword.js";

test("tokenize strips stop words and punctuation", () => {
  assert.deepEqual(tokenize("Kayak for sale, the best!"), ["kayak", "sale", "best"]);
});

test("exact item ranks above accessory", () => {
  const item = keywordScore("kayak", "Kayak - great condition", "Selling my kayak");
  const rack = keywordScore("kayak", "Kayak rack / mount", "Rack only, kayak not included");
  assert.ok(item.score > 0.9, `item ${item.score}`);
  assert.ok(rack.score < 0.5, `rack ${rack.score}`);
  assert.ok(["rack", "mount"].includes(rack.accessoryHit ?? ""));
});

test("want ads are demoted", () => {
  const iso = keywordScore("kayak", "ISO kayak", "Looking for a kayak");
  assert.ok(iso.score < 0.5);
});

test("multi-word queries score partial matches", () => {
  const r = keywordScore("standing desk", "Electric desk, adjustable", "Standing height desk");
  assert.ok(r.score > 0.5 && r.score < 1);
  assert.ok(isAmbiguous(r.score));
});

test("plural and prefix matching", () => {
  assert.ok(keywordScore("bike", "Mountain bikes for sale", null).score >= 0.9);
});
