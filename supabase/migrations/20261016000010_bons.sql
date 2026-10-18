-- =====================================================================
-- SMART INVOICE — 10 : Bons de livraison (BL) et bons de commande (BC)
-- Un bon est créé en un clic à partir d'une facture : il reprend le client
-- et les lignes de la facture et reçoit son propre numéro (BL0001/2026…).
-- Rejouable sans erreur (mise à jour d'une installation existante).
-- =====================================================================

create table if not exists public.delivery_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null check (kind in ('BL', 'BC')),
  number text not null,
  seq integer not null,
  issue_date date not null default current_date,
  invoice_id uuid references public.invoices (id) on delete set null,
  invoice_number text,
  client_id uuid references public.parties (id),
  client_snapshot jsonb,
  order_ref text,
  notes text,
  show_prices boolean not null default false,
  total_ht bigint not null default 0,
  total_vat bigint not null default 0,
  total_ttc bigint not null default 0,
  vat_breakdown jsonb not null default '[]'::jsonb,
  is_demo boolean not null default false,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, kind, number)
);
create index if not exists delivery_notes_list_idx on public.delivery_notes (company_id, kind, issue_date desc);
create index if not exists delivery_notes_invoice_idx on public.delivery_notes (invoice_id);

create table if not exists public.delivery_note_lines (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.delivery_notes (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  position integer not null default 0,
  designation text not null,
  unit text,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price_ttc bigint not null default 0,
  vat_rate_bp integer not null default 0,
  discount_bp integer not null default 0,
  total_ttc bigint not null default 0
);
create index if not exists delivery_note_lines_note_idx on public.delivery_note_lines (note_id, position);

-- Compteurs : une suite par entreprise, par type et par année (sans trou).
create table if not exists public.delivery_note_counters (
  company_id uuid not null references public.companies (id) on delete cascade,
  kind text not null,
  year integer not null,
  last_seq integer not null default 0,
  primary key (company_id, kind, year)
);

alter table public.delivery_notes enable row level security;
alter table public.delivery_note_lines enable row level security;
alter table public.delivery_note_counters enable row level security;

drop policy if exists notes_select on public.delivery_notes;
drop policy if exists notes_update on public.delivery_notes;
drop policy if exists notes_delete on public.delivery_notes;
drop policy if exists note_lines_select on public.delivery_note_lines;
drop policy if exists note_counters_select on public.delivery_note_counters;
-- Lecture : membres. Création : uniquement par la fonction ci-dessous.
-- Modification (date, observations, affichage des prix) : membres. Suppression : admin / comptable.
create policy notes_select on public.delivery_notes for select to authenticated using (public.is_member(company_id));
create policy notes_update on public.delivery_notes for update to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));
create policy notes_delete on public.delivery_notes for delete to authenticated using (public.can_manage(company_id));
create policy note_lines_select on public.delivery_note_lines for select to authenticated using (public.is_member(company_id));
create policy note_counters_select on public.delivery_note_counters for select to authenticated using (public.is_member(company_id));

-- Seuls la date, les observations et l'affichage des prix sont modifiables.
create or replace function public.guard_delivery_note()
returns trigger language plpgsql as $$
begin
  if current_user in ('postgres', 'supabase_admin') then return new; end if;
  if (new.company_id, new.kind, new.number, new.seq, new.invoice_id, new.invoice_number, new.client_id,
      new.client_snapshot, new.total_ttc, new.total_ht, new.total_vat, new.vat_breakdown, new.is_demo, new.created_by, new.created_at)
     is distinct from
     (old.company_id, old.kind, old.number, old.seq, old.invoice_id, old.invoice_number, old.client_id,
      old.client_snapshot, old.total_ttc, old.total_ht, old.total_vat, old.vat_breakdown, old.is_demo, old.created_by, old.created_at) then
    raise exception 'Seuls la date, les observations et l''affichage des prix d''un bon sont modifiables.';
  end if;
  return new;
end $$;
drop trigger if exists t_guard_delivery_note on public.delivery_notes;
create trigger t_guard_delivery_note before update on public.delivery_notes
  for each row execute function public.guard_delivery_note();

drop trigger if exists t_audit on public.delivery_notes;
create trigger t_audit after insert or update or delete on public.delivery_notes
  for each row execute function public.audit();

/**
 * Crée le bon (BL ou BC) d'une facture et renvoie son id.
 * Si un bon du même type existe déjà pour cette facture, renvoie celui-ci (pas de doublon).
 * Pour un BL créé depuis un brouillon sans n° de BL, le numéro est reporté sur la facture.
 */
create or replace function public.create_note_from_invoice(p_invoice uuid, p_kind text, p_show_prices boolean default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_inv invoices%rowtype;
  v_existing uuid;
  v_client parties%rowtype;
  v_snapshot jsonb;
  v_year integer;
  v_seq integer;
  v_number text;
  v_id uuid;
begin
  if p_kind not in ('BL', 'BC') then raise exception 'Type de bon invalide.'; end if;
  select * into v_inv from invoices where id = p_invoice;
  if not found or not is_member(v_inv.company_id) then raise exception 'Facture introuvable.'; end if;
  if v_inv.status = 'cancelled' then raise exception 'Facture annulée : aucun bon ne peut être créé.'; end if;
  if v_inv.client_id is null then raise exception 'Choisissez d''abord le client de la facture.'; end if;
  if not exists (select 1 from invoice_lines where invoice_id = v_inv.id) then
    raise exception 'La facture ne contient aucune ligne.';
  end if;

  select id into v_existing from delivery_notes
  where invoice_id = v_inv.id and kind = p_kind order by created_at limit 1;
  if v_existing is not null then return v_existing; end if;

  if v_inv.client_snapshot is not null then
    v_snapshot := v_inv.client_snapshot;
  else
    select * into v_client from parties where id = v_inv.client_id;
    v_snapshot := jsonb_build_object('name', v_client.name, 'ice', v_client.ice, 'if_number', v_client.if_number,
      'rc', v_client.rc, 'address', v_client.address, 'city', v_client.city);
  end if;

  -- Numérotation : verrou sur le compteur → pas de doublon même avec plusieurs utilisateurs.
  v_year := extract(year from v_inv.issue_date)::integer;
  insert into delivery_note_counters (company_id, kind, year, last_seq) values (v_inv.company_id, p_kind, v_year, 1)
  on conflict (company_id, kind, year) do update set last_seq = delivery_note_counters.last_seq + 1
  returning last_seq into v_seq;
  v_number := p_kind || lpad(v_seq::text, 4, '0') || '/' || v_year::text;

  insert into delivery_notes (company_id, kind, number, seq, issue_date, invoice_id, invoice_number, client_id,
    client_snapshot, order_ref, show_prices, total_ht, total_vat, total_ttc, vat_breakdown, is_demo, created_by)
  values (v_inv.company_id, p_kind, v_number, v_seq, v_inv.issue_date, v_inv.id, v_inv.number, v_inv.client_id,
    v_snapshot, v_inv.order_ref, coalesce(p_show_prices, p_kind = 'BC'), v_inv.total_ht, v_inv.total_vat, v_inv.total_ttc,
    v_inv.vat_breakdown, v_inv.is_demo, auth.uid())
  returning id into v_id;

  insert into delivery_note_lines (note_id, company_id, position, designation, unit, quantity, unit_price_ttc, vat_rate_bp, discount_bp, total_ttc)
  select v_id, l.company_id, l.position, l.designation, l.unit, l.quantity, l.unit_price_ttc, l.vat_rate_bp, l.discount_bp, l.total_ttc
  from invoice_lines l where l.invoice_id = v_inv.id order by l.position;

  -- Le n° de BL apparaît sur la facture (brouillon seulement : une facture validée ne change plus).
  if p_kind = 'BL' and v_inv.status = 'draft' and coalesce(trim(v_inv.delivery_note_ref), '') = '' then
    update invoices set delivery_note_ref = v_number where id = v_inv.id;
  end if;

  return v_id;
end $$;

revoke all on function public.create_note_from_invoice(uuid, text, boolean) from public;
grant execute on function public.create_note_from_invoice(uuid, text, boolean) to authenticated;
grant select, update, delete on public.delivery_notes to authenticated;
grant select on public.delivery_note_lines, public.delivery_note_counters to authenticated;
