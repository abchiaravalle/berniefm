import { json, stationState } from '../_lib.js';

// Live timeline straight from D1. Players normally read the published copy at
// https://media.bcradio.net/state/now.json and only call this when that copy is
// running out (which also extends the schedule and republishes it).
export async function onRequestGet({ env }) {
  return json(await stationState(env));
}
