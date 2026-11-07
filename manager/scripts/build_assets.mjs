// Copy the self-hosted ffmpeg.wasm (from node_modules, pinned versions) into assets/ff/<ver>/.
// The core .wasm is 32 MB and Workers static assets max out at 25 MiB per file, so it is split
// into two parts; the browser joins them (convert.js). Run: npm install && npm run assets
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VER = '0.12.10';
// sha256 of @ffmpeg/core@0.12.10 dist/esm/ffmpeg-core.wasm (checked against the npm tarball)
const WASM_SHA256 = process.env.FF_WASM_SHA256 || '9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7';
const out = path.join(ROOT, 'public/assets/ff', VER);
fs.rmSync(path.join(ROOT, 'public/assets/ff'), { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'ffmpeg'), { recursive: true });
fs.mkdirSync(path.join(out, 'core'), { recursive: true });

const ffDir = path.join(ROOT, 'node_modules/@ffmpeg/ffmpeg/dist/esm');
for (const f of fs.readdirSync(ffDir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(ffDir, f), path.join(out, 'ffmpeg', f));
const coreDir = path.join(ROOT, 'node_modules/@ffmpeg/core/dist/esm');
fs.copyFileSync(path.join(coreDir, 'ffmpeg-core.js'), path.join(out, 'core/ffmpeg-core.js'));
const wasm = fs.readFileSync(path.join(coreDir, 'ffmpeg-core.wasm'));
const sha = crypto.createHash('sha256').update(wasm).digest('hex');
if (WASM_SHA256 && sha !== WASM_SHA256) throw new Error('ffmpeg-core.wasm checksum mismatch ' + sha);
const half = Math.ceil(wasm.length / 2);
fs.writeFileSync(path.join(out, 'core/ffmpeg-core.wasm.0'), wasm.subarray(0, half));
fs.writeFileSync(path.join(out, 'core/ffmpeg-core.wasm.1'), wasm.subarray(half));
fs.writeFileSync(path.join(out, 'core/manifest.json'), JSON.stringify({ version: VER, bytes: wasm.length, sha256: sha, parts: ['ffmpeg-core.wasm.0', 'ffmpeg-core.wasm.1'] }));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/@ffmpeg/core/package.json'), 'utf8'));
if (pkg.version !== VER) throw new Error('expected @ffmpeg/core ' + VER + ', found ' + pkg.version);
console.log('ffmpeg.wasm', VER, wasm.length, 'bytes sha256', sha, '->', path.relative(ROOT, out));
