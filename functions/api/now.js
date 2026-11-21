import { json, stationState } from '../_lib.js';
import { extraCh, channelState } from '../_channels.js';

// Live timeline straight from D1. Players normally read the published copy at
// https://media.bcradio.net/state/now.json and only call this when that copy is
// running out (which also extends the schedule and republishes it).
// ?ch=christmas|classic: that Christmas channel's timeline (state/now-<id>.json), with "ch".
// Any other ch, or a channel that is off right now: the main timeline with "ch":"mixed".
// No ch: the main timeline exactly as before.
export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams.get('ch');
  if (q === null) return json(await stationState(env));
  const ch = extraCh(q);
  const st = ch ? await channelState(env, ch) : null;
  if (st) return json(st);
  return json({ ...(await stationState(env)), ch: 'mixed' });
}
