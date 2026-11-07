// Control Room settings. Renaming the manager = change APP_NAME here (the page title and
// header are filled in from it). The hostname lives in wrangler.jsonc (route + CANONICAL_HOST)
// and in the Cloudflare Access app (scripts/setup_access.py).
export const APP_NAME = 'Control Room';
export const APP_TAGLINE = 'BC Radio · bcradio.net';
export const DEFAULT_TZ = 'America/Los_Angeles';
// Same five groups the station's album picker (functions/api/catalog.js) knows about.
export const SECTIONS = ['Albums', 'Singles', 'Silent Partner', 'Collaborations', 'Rarities & demos'];
// Self-hosted ffmpeg.wasm (built into assets/ff/<version>/ by scripts/build_assets.mjs).
export const FF_VERSION = '0.12.10';
export const PART_SIZE = 8 * 1024 * 1024;   // R2 multipart part size (min 5 MiB, Worker body limit 100 MB)
export const MAX_SONG_BYTES = 300 * 1024 * 1024;
