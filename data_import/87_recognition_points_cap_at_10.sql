-- Tightens recognition_points.points from "any positive integer" (file 86's
-- check (points > 0)) down to 1-10 -- app owner: "recognition points should
-- be between 1-10 for any activity". A single award should be a small,
-- meaningful nudge (like a quick "+3 for helping clean up"), not an
-- unbounded number a teacher could type in by accident; capping it keeps
-- the leaderboard (see teacher.js's renderRecognitionTab/renderInsightsTab)
-- meaningful as a running total rather than skewed by one huge one-off
-- entry.
--
-- Nothing already awarded needs fixing up here: the UI has only ever
-- offered a plain "1 or more" number input (see data_import/86's own
-- teacher.js changes), so no existing row can already be above 10 -- this
-- migration only tightens what future inserts/updates are allowed to be.
--
-- Safe to re-run: drop-then-add for the constraint.

alter table recognition_points drop constraint if exists recognition_points_points_check;
alter table recognition_points add constraint recognition_points_points_check check (points >= 1 and points <= 10);

-- CONFIRM: constraint is in place with the expected bounds.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'recognition_points'::regclass and conname = 'recognition_points_points_check';
