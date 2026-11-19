import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const supportedTarget = 'x86_64-pc-windows-msvc';
export function requireTarget(target) {
  if (target !== supportedTarget) throw new Error(`Unsupported engine target ${target}. Clip-Clip-Go currently bundles engines only for ${supportedTarget}.`);
  return target;
}
export function sidecarName(name, target) { requireTarget(target); return `${name}-${target}.exe`; }
export function inside(root, ...parts) {
  const result = path.resolve(root, ...parts);
  if (!result.startsWith(path.resolve(root) + path.sep)) throw new Error('Refusing a path outside the project-owned directory.');
  return result;
}
export async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function verifyHash(file, expected) {
  const actual = await sha256(file);
  if (actual !== expected) throw new Error(`SHA-256 mismatch for ${file}. Expected ${expected}; got ${actual}. Refusing to use or extract it.`);
}
export function encoderNames(text) {
  return new Set(text.split(/\r?\n/).flatMap(line => {
    const words = line.trim().split(/\s+/);
    return /^[VA].{5}$/.test(words[0]) && words[1] && words[1] !== '=' ? [words[1]] : [];
  }));
}
// Read PE import names directly; no dumpbin, system SDK discovery or extra tools needed.
export async function peImports(file) {
  const bytes = await readFile(file);
  if (bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('Engine is not a Windows executable.');
  const pe = bytes.readUInt32LE(0x3c);
  if (bytes.toString('ascii', pe, pe + 4) !== 'PE\0\0' || bytes.readUInt16LE(pe + 4) !== 0x8664) throw new Error('Engine is not Windows x64 (AMD64).');
  const sections = bytes.readUInt16LE(pe + 6);
  const optionalSize = bytes.readUInt16LE(pe + 20);
  const optional = pe + 24;
  if (bytes.readUInt16LE(optional) !== 0x20b) throw new Error('Expected a PE32+ x64 executable.');
  const sectionBase = optional + optionalSize;
  const offset = rva => {
    for (let i = 0; i < sections; i++) {
      const start = sectionBase + i * 40;
      const address = bytes.readUInt32LE(start + 12);
      const size = Math.max(bytes.readUInt32LE(start + 8), bytes.readUInt32LE(start + 16));
      if (rva >= address && rva < address + size) return bytes.readUInt32LE(start + 20) + rva - address;
    }
    throw new Error('Invalid PE import address.');
  };
  const ascii = rva => { const start = offset(rva); return bytes.toString('ascii', start, bytes.indexOf(0, start)); };
  const imports = [];
  const importRva = bytes.readUInt32LE(optional + 112 + 8);
  if (importRva) for (let entry = offset(importRva); bytes.readUInt32LE(entry + 12) !== 0; entry += 20) imports.push(ascii(bytes.readUInt32LE(entry + 12)));
  const delayRva = bytes.readUInt32LE(optional + 112 + 13 * 8);
  if (delayRva) for (let entry = offset(delayRva); bytes.readUInt32LE(entry + 4) !== 0; entry += 32) imports.push(ascii(bytes.readUInt32LE(entry + 4)));
  return [...new Set(imports)].sort();
}
