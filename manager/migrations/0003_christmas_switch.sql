-- Christmas switch, 2026-11-21. ADDITIVE ONLY: two new nullable columns on features.
-- NULL (every existing row) = the rules that were live before, unchanged (manager/test/sched_equiv.mjs).
--   gap_min - the period's songs may come back after this many minutes instead of the station-wide 6 h;
--             with mode 'only' it also means "on repeat" (shuffled cycles, no fallback to normal rotation)
--   pace    - 'unlock'/'more': spread the period's songs through the hour, about 1 in every `pace` songs,
--             never two in a row (the Control Room's "Mixed in")
-- Run once: wrangler d1 execute bcradio --remote --file manager/migrations/0003_christmas_switch.sql
ALTER TABLE features ADD COLUMN gap_min INTEGER;
ALTER TABLE features ADD COLUMN pace INTEGER;
