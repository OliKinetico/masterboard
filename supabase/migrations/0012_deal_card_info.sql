-- 0012: per-deal derived card data for the kanban/list/analytics surfaces.
-- security_invoker so RLS on deals/offers/stage_history applies to the caller.

create view public.deal_card_info
with (security_invoker = true) as
select
  d.id as deal_id,
  (
    select o.enterprise_value
    from public.offers o
    where o.deal_id = d.id and o.status in ('made','accepted')
    order by o.made_on desc, o.created_at desc
    limit 1
  ) as latest_offer_ev,
  (
    select max(sh.moved_at)
    from public.stage_history sh
    where sh.deal_id = d.id
  ) as last_stage_change_at,
  (
    select max(i.occurred_on)
    from public.interactions i
    where i.deal_id = d.id
  ) as last_interaction_on
from public.deals d;
