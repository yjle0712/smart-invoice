-- =====================================================================
-- SMART INVOICE — 6 : protection des séries de numérotation
-- Une fois qu'une série a servi (au moins une facture validée), son compteur
-- et son format ne peuvent plus être modifiés à la main : seule la
-- validation fait avancer le compteur. Pour changer de format, créez une
-- nouvelle série. Avant la première facture, le numéro de départ est libre
-- (reprise d'une numérotation existante).
-- =====================================================================

create or replace function public.guard_number_series()
returns trigger language plpgsql as $$
declare
  v_internal boolean := coalesce(current_setting('smart_invoice.internal', true), '') = 'on'
                        and current_user in ('postgres', 'supabase_admin');
begin
  if v_internal then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    -- Suppression en cascade de l'entreprise elle-même : autorisée
    if not exists (select 1 from companies where id = old.company_id) then return old; end if;
    if exists (select 1 from invoices where series_id = old.id) then
      raise exception 'Série utilisée par des factures : elle ne peut pas être supprimée.';
    end if;
    if old.is_default then raise exception 'La série par défaut ne peut pas être supprimée.'; end if;
    return old;
  end if;
  new.company_id := old.company_id;
  if exists (select 1 from invoices where series_id = old.id and status <> 'draft') then
    if new.next_seq <> old.next_seq or new.current_year is distinct from old.current_year then
      raise exception 'Le compteur d''une série déjà utilisée ne peut pas être modifié manuellement.';
    end if;
    if new.format <> old.format or new.reset_yearly <> old.reset_yearly then
      raise exception 'Série déjà utilisée : créez une nouvelle série pour changer de format.';
    end if;
  end if;
  return new;
end $$;

create trigger t_guard_series before update or delete on public.number_series
  for each row execute function public.guard_number_series();

-- Une seule série par défaut : bascule atomique
create or replace function public.set_default_series(p_series uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare v_company uuid;
begin
  select company_id into v_company from number_series where id = p_series;
  if v_company is null then raise exception 'Série introuvable.'; end if;
  update number_series set is_default = false where company_id = v_company and is_default and id <> p_series;
  update number_series set is_default = true where id = p_series;
end $$;
revoke all on function public.set_default_series(uuid) from public, anon;
grant execute on function public.set_default_series(uuid) to authenticated;

create policy series_delete on public.number_series for delete to authenticated
  using (public.has_role(company_id, array['admin']::public.member_role[]));
