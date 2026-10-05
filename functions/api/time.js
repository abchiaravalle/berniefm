import { json } from '../_lib.js';

// Server clock for client time-sync (no D1, no cache). Clients take the
// min-RTT sample of a few calls to estimate their offset from station time.
export async function onRequestGet() {
  return json({ now: Date.now() });
}
