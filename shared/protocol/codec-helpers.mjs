// Copyright (c) 2026 KingPepe Team. All Rights Reserved.
import {createHash} from "node:crypto";
export function messageDigestHex(input) {
  return sha256Hex(asBytes(input, "message"));
}

export function hexToBytes(hex, label = "hex") {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || /[^0-9a-f]/iu.test(hex)) {
    throw new Error(`${label}:InvalidHex`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes) {
  return Array.from(asBytes(bytes, "bytes"), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hashJson(value) {
  return sha256Hex(Buffer.from(stableJson(value), "utf8"));
}

export function stableJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

export function isHash32Hex(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

export function normalizeHex(value, label = "hex") {
  if (typeof value !== "string") {
    throw new Error(`${label}:ExpectedString`);
  }
  const normalized = value.toLowerCase();
  hexToBytes(normalized, label);
  return normalized;
}

function asBytes(value, label) {
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string') return hexToBytes(value,label);
  throw new Error(`${label}:ExpectedBytes`);
}
function sha256Hex(bytes) {return createHash('sha256').update(bytes).digest('hex');}
