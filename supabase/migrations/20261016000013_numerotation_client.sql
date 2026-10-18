-- =====================================================================
-- SMART INVOICE — 13 : numérotation propre à chaque client
-- Un client peut être rattaché à une série (ex. MATA{SEQ:4}/{YYYY}) : ses factures
-- reçoivent alors les numéros de cette série, toujours dans l'ordre et sans trou,
-- attribués à la validation. Rejouable sans erreur.
-- =====================================================================
alter table public.parties add column if not exists default_series_id uuid references public.number_series (id) on delete set null;

-- La série d'un client doit appartenir à la même entreprise.
create or replace function public.check_party_series()
returns trigger language plpgsql as $$
begin
  if new.default_series_id is not null and not exists (
    select 1 from number_series where id = new.default_series_id and company_id = new.company_id) then
    raise exception 'Série de numérotation introuvable pour cette entreprise.';
  end if;
  return new;
end $$;
drop trigger if exists t_party_series on public.parties;
create trigger t_party_series before insert or update of default_series_id on public.parties
  for each row execute function public.check_party_series();
