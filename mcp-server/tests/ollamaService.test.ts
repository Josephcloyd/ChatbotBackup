import assert from "node:assert/strict";
import test from "node:test";
import {
  extractOllamaText,
  parseOllamaJson,
  parseOllamaResponseBody,
} from "../src/ollamaService.js";

test("extracts a non-streaming /api/generate response", () => {
  const payloads = parseOllamaResponseBody(
    JSON.stringify({ response: '{"ok":true}', done: true }),
  );
  assert.equal(extractOllamaText(payloads), '{"ok":true}');
});

test("extracts a non-streaming /api/chat response", () => {
  const payloads = parseOllamaResponseBody(
    JSON.stringify({ message: { content: '{"ok":true}' }, done: true }),
  );
  assert.equal(extractOllamaText(payloads), '{"ok":true}');
});

test("concatenates streamed NDJSON chunks and ignores the empty done chunk", () => {
  const payloads = parseOllamaResponseBody(
    [
      JSON.stringify({ response: '{"ok":', done: false }),
      JSON.stringify({ response: "true}", done: false }),
      JSON.stringify({ response: "", done: true }),
    ].join("\n"),
  );
  assert.equal(extractOllamaText(payloads), '{"ok":true}');
});

test("throws a descriptive error for an empty extracted response", () => {
  assert.throws(
    () => extractOllamaText([{ response: "", thinking: "reasoning", done: true }]),
    /Ollama returned an empty response body.*thinkingLength=9/,
  );
  assert.throws(() => parseOllamaJson(""), /extracted response text is empty/);
});
