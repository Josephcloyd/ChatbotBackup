import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOllamaGenerateRequestBody,
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

test("disables model thinking for structured generate requests", () => {
  const body = JSON.parse(buildOllamaGenerateRequestBody("prompt", "qwen3:8b")) as {
    model: string;
    prompt: string;
    think?: boolean;
    format?: string;
    stream?: boolean;
  };
  assert.equal(body.model, "qwen3:8b");
  assert.equal(body.prompt, "prompt");
  assert.equal(body.think, false);
  assert.equal(body.format, "json");
  assert.equal(body.stream, false);
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
