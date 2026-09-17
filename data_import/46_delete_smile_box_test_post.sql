-- Removes the one test post created while verifying the new Smile Box
-- feature end-to-end on localhost ("Localhost test post - verifying end
-- to end (safe to delete)."). Scoped to that exact message text on
-- 2026-09-16 so it can't accidentally match a real post. smile_box_entries
-- has no delete policy for ordinary users by design ("final once
-- submitted") -- this is the admin-only SQL Editor path mentioned in that
-- table's own comment.

delete from smile_box_entries
where date = '2026-09-16'
  and message = 'Localhost test post - verifying end to end (safe to delete).';

-- Confirm: should return 0 rows
select count(*) as remaining
from smile_box_entries
where date = '2026-09-16'
  and message = 'Localhost test post - verifying end to end (safe to delete).';
