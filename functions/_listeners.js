// Live listener count (privacy-safe), shared by /api/listen and /api/listeners.
// Leading underscore = not routed.
//
// While a player is actually playing it sends {sid, platform, playing:true} about once a
// minute. `sid` is a random code the PLAYER makes up each time playback starts; it lives
// only in the player's memory and is never tied to an account, device or IP. The server
// keeps one row per playing session (sid, platform, last_seen_ms) and nothing else:
// no IP, user agent, country or device id. playing:false deletes the row at once, and
// rows not seen for 3 minutes are cleared out by later calls.
// For charts, only per-minute TOTALS are kept (listen_minutes); no per-session history.

export const PLATFORMS = ['web', 'ios', 'android'];
export const LIVE_WINDOW_MS = 150000;   // counted if seen in the last 150 s (players ping every 60 s, so one late ping is fine)
export const DROP_AFTER_MS = 180000;    // rows older than this are deleted
export const SID_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function countStatement(env, now = Date.now()) {
  return env.DB.prepare(
    'SELECT platform, COUNT(*) AS n FROM listen_sessions WHERE last_seen_ms >= ?1 GROUP BY platform'
  ).bind(now - LIVE_WINDOW_MS);
}

export function countsFrom(rows) {
  const out = { total: 0, web: 0, ios: 0, android: 0 };
  for (const r of rows || []) {
    if (PLATFORMS.includes(r.platform)) { out[r.platform] = r.n; out.total += r.n; }
  }
  return out;
}

// Cheap cleanup: stale sessions, and expired rate-limit buckets of the listen pings
// (those buckets hold a salted, per-minute hash of the IP; drop them once their minute is over).
export function cleanupStatements(env, now = Date.now()) {
  return [
    env.DB.prepare('DELETE FROM listen_sessions WHERE last_seen_ms < ?1').bind(now - DROP_AFTER_MS),
    env.DB.prepare("DELETE FROM hits WHERE win < ?1 AND bucket LIKE 'listen:%'").bind(now),
  ];
}

// Totals for the minute that just ended, written once (INSERT OR IGNORE: the first call in a
// new minute wins, later ones are no-ops). Returns null when this isolate already wrote it.
let lastSnapMinute = 0;
export function minuteSnapshot(env, now = Date.now()) {
  const minute = Math.floor(now / 60000);
  if (minute === lastSnapMinute) return null;
  lastSnapMinute = minute;
  return env.DB.prepare(
    `INSERT OR IGNORE INTO listen_minutes(minute_ms, web, ios, android)
     SELECT ?1,
            COALESCE(SUM(platform='web'), 0), COALESCE(SUM(platform='ios'), 0), COALESCE(SUM(platform='android'), 0)
       FROM listen_sessions WHERE last_seen_ms >= ?2`
  ).bind((minute - 1) * 60000, now - LIVE_WINDOW_MS);
}
