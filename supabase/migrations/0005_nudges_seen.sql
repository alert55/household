-- Household — delivering a nudge
--
-- 0004 gave a nudge somewhere to live. This is how it reaches the person it was
-- meant for, and how the sender finds out it landed.
--
-- `seen_at` means "they know", not "hide it". A nudge stays on the recipient's
-- board until the occurrence is dealt with — marking it seen only tells the
-- sender they can stop wondering.

-- The update policy from 0004 was too loose: it decided which ROWS a recipient
-- could touch but said nothing about what they could write, so a recipient could
-- have rewritten who nudged them. WITH CHECK cannot express "these columns did
-- not change", so the honest fix is to take direct writes away entirely and
-- offer one function that does the only legitimate thing.
drop policy if exists nudge_seen on nudge;

create or replace function public.mark_nudges_seen()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  touched integer;
begin
  update nudge n
     set seen_at = now()
   where n.seen_at is null
     and n.to_member_id in (
       select m.id from member m where m.user_id = auth.uid()
     );

  get diagnostics touched = row_count;
  return touched;
end;
$$;

-- Security definer here is safe precisely because the only rows it can reach are
-- ones addressed to the caller. It is granted to authenticated users; nothing
-- else may write to nudge at all now.
revoke execute on function public.mark_nudges_seen() from public;
grant execute on function public.mark_nudges_seen() to authenticated;
