-- Applied to the owned project as migration 20261104194121.
-- Event reconciliation filters by company, source and the provider event ID.
-- Keep the JSON expression identical to the PostgREST predicate and retain id
-- ordering. No financial rows or access policies are modified.
set local lock_timeout = '5s';

create index if not exists idx_raw_company_source_event_id
  on public.financial_transactions_raw (
    company_id,
    source,
    ((raw_payload -> '__somus_detail' -> 'evento' ->> 'id')),
    id
  );

analyze public.financial_transactions_raw;
