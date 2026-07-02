import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGooglePrivateKey } from "@/lib/google-credentials";

const pem = "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----\n";

test("normalizes common Google private-key secret formats", () => {
  assert.equal(normalizeGooglePrivateKey(pem), pem.trim());
  assert.equal(normalizeGooglePrivateKey(JSON.stringify(pem)), pem.trim());
  assert.equal(normalizeGooglePrivateKey(JSON.stringify({ private_key: pem })), pem.trim());
  assert.equal(normalizeGooglePrivateKey(Buffer.from(pem).toString("base64")), pem.trim());
});
