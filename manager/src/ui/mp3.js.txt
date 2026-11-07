// Reads the first MP3 frame + its Info (LAME) tag and checks the file is what the station
// plays: MPEG-1 Layer III, CBR 128 kbps, 44.1 kHz, two channels, no ID3 tag. Returns the
// exact decoded length, the same number ffprobe reports for the library files:
// (frames * 1152 - encoder delay - padding) / 44100.
export function parseMp3(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (b.length < 200) return { ok: false, why: 'file is too short' };
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return { ok: false, why: 'has an ID3 tag (station files have none)' };
  const h = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  if ((h & 0xFFE00000) >>> 0 !== 0xFFE00000) return { ok: false, why: 'not an MP3 file' };
  const version = (h >>> 19) & 3, layer = (h >>> 17) & 3, crc = ((h >>> 16) & 1) === 0;
  const br = (h >>> 12) & 15, sr = (h >>> 10) & 3, mode = (h >>> 6) & 3;
  if (version !== 3 || layer !== 1) return { ok: false, why: 'not MPEG-1 Layer III' };
  if (br !== 9) return { ok: false, why: 'not 128 kbps' };
  if (sr !== 0) return { ok: false, why: 'not 44.1 kHz' };
  if (mode === 3) return { ok: false, why: 'mono (station files are stereo)' };
  let p = 4 + (crc ? 2 : 0) + 32;
  const tag = String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]);
  if (tag === 'Xing') return { ok: false, why: 'variable bit rate (station files are constant 128 kbps)' };
  if (tag !== 'Info') return { ok: false, why: 'no Info header (needed for exact length)' };
  const u32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  const flags = u32(p + 4); p += 8;
  let frames = null, bytes = null;
  if (flags & 1) { frames = u32(p); p += 4; }
  if (flags & 2) { bytes = u32(p); p += 4; }
  if (flags & 4) p += 100;
  if (flags & 8) p += 4;
  if (!frames) return { ok: false, why: 'Info header has no frame count' };
  const v = (b[p + 21] << 16) | (b[p + 22] << 8) | b[p + 23];
  const delay = v >>> 12, pad = v & 0xfff;
  const samples = frames * 1152 - delay - pad;
  if (samples <= 0 || delay > 3000 || pad > 3000) return { ok: false, why: 'bad encoder delay/padding' };
  const firstLen = Math.floor(144 * 128000 / 44100) + ((h >>> 9) & 1);
  return {
    ok: true, frames, bytes, delay, pad, samples, mode,
    dur_ms: Math.round(samples * 1000 / 44100),
    expect_bytes: Math.round(firstLen + frames * 144 * 128000 / 44100),
  };
}
