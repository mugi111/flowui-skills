import assert from "node:assert/strict";
import test from "node:test";

import { limitText, redactLog, redactUrl, redactValue } from "./redaction.js";

test("redacts default and configured sensitive object fields recursively", () => {
  const value = redactValue(
    { password: "do-not-store", profile: { employeeCode: "A-42", refresh_token: "also-private" } },
    { sensitiveKeys: ["employeeCode"] },
  );

  assert.deepEqual(value, { password: "[REDACTED]", profile: { employeeCode: "[REDACTED]", refresh_token: "[REDACTED]" } });
});

test("redacts sensitive URL query parameters", () => {
  const value = redactUrl("https://example.test/profile?token=private&view=summary&account=123", { sensitiveQueryParameters: ["account"] });

  assert.equal(value, "https://example.test/profile?token=%5BREDACTED%5D&view=summary&account=%5BREDACTED%5D");
});

test("log output cannot expose nested secret values", () => {
  const output = redactLog({ error: { authorization: "Bearer private-token" }, message: "request failed" });

  assert.match(output, /REDACTED/);
  assert.doesNotMatch(output, /private-token/);
});

test("limits text by UTF-8 byte size without splitting a code point", () => {
  assert.deepEqual(limitText("abcあ", 4), { text: "abc", truncated: true, omittedCharacters: 1 });
  assert.deepEqual(limitText("abc", 3), { text: "abc", truncated: false, omittedCharacters: 0 });
});
