-- =====================================================================
-- SMART INVOICE — MISE À JOUR DU 20/10/2026
-- Devis + toutes les mises à jour précédentes (numérotation par client, mode de paiement,
-- modèles FERCIM / NOVASTRO / NORD, clients et produits communs, bons BL / BC…).
-- SANS perte de données : copiez TOUT ce fichier dans Supabase → SQL Editor → Run.
-- Peut être relancé sans risque.
-- =====================================================================
-- =====================================================================
-- SMART INVOICE — 9 : N° de bon de livraison sur les factures
-- =====================================================================
alter table public.invoices add column if not exists delivery_note_ref text;
create index if not exists invoices_delivery_note_idx on public.invoices (company_id, delivery_note_ref) where delivery_note_ref is not null;

create or replace function public.save_invoice_draft(p_invoice uuid, p_company uuid, p_header jsonb, p_lines jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := p_invoice;
  v_line jsonb;
  v_pos integer := 0;
begin
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'Lignes invalides.'; end if;

  if v_id is null then
    insert into invoices (company_id, series_id, issue_date, due_date, client_id, order_ref, delivery_note_ref, payment_terms, goods_nature, notes, template_id)
    values (
      p_company,
      nullif(p_header ->> 'series_id', '')::uuid,
      coalesce(nullif(p_header ->> 'issue_date', '')::date, current_date),
      nullif(p_header ->> 'due_date', '')::date,
      nullif(p_header ->> 'client_id', '')::uuid,
      nullif(trim(p_header ->> 'order_ref'), ''),
      nullif(trim(p_header ->> 'delivery_note_ref'), ''),
      nullif(trim(p_header ->> 'payment_terms'), ''),
      nullif(trim(p_header ->> 'goods_nature'), ''),
      nullif(trim(p_header ->> 'notes'), ''),
      nullif(p_header ->> 'template_id', '')::uuid
    ) returning id into v_id;
  else
    update invoices set
      series_id = nullif(p_header ->> 'series_id', '')::uuid,
      issue_date = coalesce(nullif(p_header ->> 'issue_date', '')::date, issue_date),
      due_date = nullif(p_header ->> 'due_date', '')::date,
      client_id = nullif(p_header ->> 'client_id', '')::uuid,
      order_ref = nullif(trim(p_header ->> 'order_ref'), ''),
      delivery_note_ref = nullif(trim(p_header ->> 'delivery_note_ref'), ''),
      payment_terms = nullif(trim(p_header ->> 'payment_terms'), ''),
      goods_nature = nullif(trim(p_header ->> 'goods_nature'), ''),
      notes = nullif(trim(p_header ->> 'notes'), ''),
      template_id = nullif(p_header ->> 'template_id', '')::uuid
    where id = v_id and company_id = p_company;
    if not found then raise exception 'Brouillon introuvable.'; end if;
    delete from invoice_lines where invoice_id = v_id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_pos := v_pos + 1;
    insert into invoice_lines (invoice_id, company_id, position, product_id, designation, unit, quantity,
                               unit_price_ttc, vat_rate_bp, discount_bp, price_override_reason)
    values (
      v_id, p_company, v_pos,
      nullif(v_line ->> 'product_id', '')::uuid,
      v_line ->> 'designation',
      nullif(v_line ->> 'unit', ''),
      (v_line ->> 'quantity')::numeric,
      (v_line ->> 'unit_price_ttc')::bigint,
      (v_line ->> 'vat_rate_bp')::integer,
      coalesce((v_line ->> 'discount_bp')::integer, 0),
      nullif(trim(v_line ->> 'price_override_reason'), '')
    );
  end loop;
  return v_id;
end $$;


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


-- =====================================================================
-- SMART INVOICE — 11 : clients, fournisseurs et produits communs à plusieurs entreprises
-- Copie (sans doublon) d'une entreprise vers une autre. Rejouable sans erreur.
-- Les droits habituels s'appliquent (fonction SECURITY INVOKER) :
--   lecture de la source = membre ; ajout de clients = membre ; ajout de produits = admin / comptable.
-- Un élément déjà présent dans l'entreprise cible n'est jamais modifié
-- (même ICE ou même nom pour un client, même référence pour un produit).
-- =====================================================================

create or replace function public.copy_master_data(
  p_source uuid,
  p_target uuid,
  p_parties boolean default true,
  p_products boolean default true,
  p_party_ids uuid[] default null,
  p_product_ids uuid[] default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  r record;
  v_parties integer := 0;
  v_products integer := 0;
  v_skipped integer := 0;
  v_cat uuid;
  v_errors text[] := '{}';
begin
  if p_source = p_target then raise exception 'Choisissez deux entreprises différentes.'; end if;
  if not is_member(p_source) or not is_member(p_target) then raise exception 'Entreprise introuvable.'; end if;

  if p_parties then
    for r in
      select * from parties s
      where s.company_id = p_source and not s.archived
        and (p_party_ids is null or s.id = any (p_party_ids))
        and not exists (
          select 1 from parties t
          where t.company_id = p_target and t.kind = s.kind
            and ((s.ice is not null and t.ice = s.ice)
              or (s.ice is null and lower(trim(t.name)) = lower(trim(s.name))))
        )
    loop
      begin
        insert into parties (company_id, kind, name, ice, if_number, rc, address, city, phone, email, payment_terms, notes)
        values (p_target, r.kind, r.name, r.ice, r.if_number, r.rc, r.address, r.city, r.phone, r.email, r.payment_terms, r.notes);
        v_parties := v_parties + 1;
      exception when others then
        v_skipped := v_skipped + 1;
        v_errors := array_append(v_errors, r.name || ' : ' || sqlerrm);
      end;
    end loop;
  end if;

  if p_products then
    if not can_manage(p_target) then
      raise exception 'Seuls un administrateur ou un comptable peuvent ajouter des produits au catalogue.';
    end if;
    for r in
      select s.*, c.name as category_name from products s
      left join product_categories c on c.id = s.category_id
      where s.company_id = p_source and s.active
        and (p_product_ids is null or s.id = any (p_product_ids))
        and not exists (select 1 from products t where t.company_id = p_target and lower(t.reference) = lower(s.reference))
    loop
      begin
        v_cat := null;
        if r.category_name is not null then
          insert into product_categories (company_id, name) values (p_target, r.category_name)
          on conflict (company_id, name) do nothing;
          select id into v_cat from product_categories where company_id = p_target and name = r.category_name;
        end if;
        insert into products (company_id, reference, designation, category_id, unit, unit_price_ttc, vat_rate_bp)
        values (p_target, r.reference, r.designation, v_cat, r.unit, r.unit_price_ttc, r.vat_rate_bp);
        v_products := v_products + 1;
      exception when others then
        v_skipped := v_skipped + 1;
        v_errors := array_append(v_errors, r.reference || ' : ' || sqlerrm);
      end;
    end loop;
  end if;

  return jsonb_build_object('parties', v_parties, 'products', v_products, 'skipped', v_skipped, 'errors', to_jsonb(v_errors[1:10]));
end $$;

revoke all on function public.copy_master_data(uuid, uuid, boolean, boolean, uuid[], uuid[]) from public, anon;
grant execute on function public.copy_master_data(uuid, uuid, boolean, boolean, uuid[], uuid[]) to authenticated;


-- =====================================================================
-- SMART INVOICE — 12 : mode de paiement sur les factures + modèles FERCIM / NOVASTRO / NORD
-- Rejouable sans erreur.
-- =====================================================================
alter table public.invoices add column if not exists payment_method text;
alter table public.invoices drop constraint if exists invoices_payment_method_check;
alter table public.invoices add constraint invoices_payment_method_check check (
  payment_method is null or payment_method in ('virement','cheque','especes','effet','carte','prelevement','versement','autre'));

-- Nouveaux modèles de facture
alter table public.invoice_templates drop constraint if exists invoice_templates_base_check;
alter table public.invoice_templates add constraint invoice_templates_base_check check (base in (
  'classic','minimal','modern','elegant','clean','stripe','compact','gray','accent','boxed','corporate','fercim','novastro','nord','entete'));

-- Le brouillon enregistre aussi le mode de paiement
create or replace function public.save_invoice_draft(p_invoice uuid, p_company uuid, p_header jsonb, p_lines jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := p_invoice;
  v_line jsonb;
  v_pos integer := 0;
begin
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'Lignes invalides.'; end if;

  if v_id is null then
    insert into invoices (company_id, series_id, issue_date, due_date, client_id, order_ref, delivery_note_ref, payment_terms, payment_method, goods_nature, notes, template_id)
    values (
      p_company,
      nullif(p_header ->> 'series_id', '')::uuid,
      coalesce(nullif(p_header ->> 'issue_date', '')::date, current_date),
      nullif(p_header ->> 'due_date', '')::date,
      nullif(p_header ->> 'client_id', '')::uuid,
      nullif(trim(p_header ->> 'order_ref'), ''),
      nullif(trim(p_header ->> 'delivery_note_ref'), ''),
      nullif(trim(p_header ->> 'payment_terms'), ''),
      nullif(trim(p_header ->> 'payment_method'), ''),
      nullif(trim(p_header ->> 'goods_nature'), ''),
      nullif(trim(p_header ->> 'notes'), ''),
      nullif(p_header ->> 'template_id', '')::uuid
    ) returning id into v_id;
  else
    update invoices set
      series_id = nullif(p_header ->> 'series_id', '')::uuid,
      issue_date = coalesce(nullif(p_header ->> 'issue_date', '')::date, issue_date),
      due_date = nullif(p_header ->> 'due_date', '')::date,
      client_id = nullif(p_header ->> 'client_id', '')::uuid,
      order_ref = nullif(trim(p_header ->> 'order_ref'), ''),
      delivery_note_ref = nullif(trim(p_header ->> 'delivery_note_ref'), ''),
      payment_terms = nullif(trim(p_header ->> 'payment_terms'), ''),
      payment_method = nullif(trim(p_header ->> 'payment_method'), ''),
      goods_nature = nullif(trim(p_header ->> 'goods_nature'), ''),
      notes = nullif(trim(p_header ->> 'notes'), ''),
      template_id = nullif(p_header ->> 'template_id', '')::uuid
    where id = v_id and company_id = p_company;
    if not found then raise exception 'Brouillon introuvable.'; end if;
    delete from invoice_lines where invoice_id = v_id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_pos := v_pos + 1;
    insert into invoice_lines (invoice_id, company_id, position, product_id, designation, unit, quantity,
                               unit_price_ttc, vat_rate_bp, discount_bp, price_override_reason)
    values (
      v_id, p_company, v_pos,
      nullif(v_line ->> 'product_id', '')::uuid,
      v_line ->> 'designation',
      nullif(v_line ->> 'unit', ''),
      (v_line ->> 'quantity')::numeric,
      (v_line ->> 'unit_price_ttc')::bigint,
      (v_line ->> 'vat_rate_bp')::integer,
      coalesce((v_line ->> 'discount_bp')::integer, 0),
      nullif(trim(v_line ->> 'price_override_reason'), '')
    );
  end loop;
  return v_id;
end $$;



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


-- =====================================================================
-- SMART INVOICE — 14 : Devis
-- Numérotation propre (DV0001/2026…), mêmes calculs que les factures,
-- transformation en facture brouillon en un clic. Rejouable sans erreur.
-- =====================================================================

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  number text not null,
  seq integer not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'refused', 'invoiced')),
  issue_date date not null default current_date,
  valid_until date,
  client_id uuid references public.parties (id),
  client_snapshot jsonb,
  payment_terms text,
  payment_method text check (payment_method is null or payment_method in ('virement','cheque','especes','effet','carte','prelevement','versement','autre')),
  notes text,
  template_id uuid references public.invoice_templates (id) on delete set null,
  total_ht bigint not null default 0,
  total_vat bigint not null default 0,
  total_ttc bigint not null default 0,
  vat_breakdown jsonb not null default '[]'::jsonb,
  invoice_id uuid references public.invoices (id) on delete set null,
  is_demo boolean not null default false,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, number),
  constraint quote_valid_after_issue check (valid_until is null or valid_until >= issue_date)
);
create index if not exists quotes_list_idx on public.quotes (company_id, issue_date desc);

create table if not exists public.quote_lines (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  position integer not null default 0,
  product_id uuid references public.products (id) on delete set null,
  designation text not null check (length(trim(designation)) > 0),
  unit text,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price_ttc bigint not null check (unit_price_ttc >= 0),
  vat_rate_bp integer not null check (vat_rate_bp between 0 and 10000),
  discount_bp integer not null default 0 check (discount_bp between 0 and 10000),
  total_ttc bigint not null default 0,
  total_ht bigint not null default 0
);
create index if not exists quote_lines_quote_idx on public.quote_lines (quote_id, position);

alter table public.quotes enable row level security;
alter table public.quote_lines enable row level security;
drop policy if exists quotes_select on public.quotes;
drop policy if exists quotes_update on public.quotes;
drop policy if exists quotes_delete on public.quotes;
drop policy if exists quote_lines_select on public.quote_lines;
-- Création et modification du contenu : uniquement par save_quote (calculs côté serveur).
create policy quotes_select on public.quotes for select to authenticated using (public.is_member(company_id));
create policy quotes_update on public.quotes for update to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));
create policy quotes_delete on public.quotes for delete to authenticated using (public.is_member(company_id) and status <> 'invoiced');
create policy quote_lines_select on public.quote_lines for select to authenticated using (public.is_member(company_id));

-- Mise à jour directe : seul le statut (envoyé / accepté / refusé) peut changer, jamais vers « transformé ».
create or replace function public.guard_quote()
returns trigger language plpgsql as $$
begin
  if current_user in ('postgres', 'supabase_admin') then return new; end if;
  if old.status = 'invoiced' then raise exception 'Devis déjà transformé en facture : il ne peut plus être modifié.'; end if;
  if new.status = 'invoiced' then raise exception 'Utilisez « Transformer en facture ».'; end if;
  if (to_jsonb(new) - array['status','updated_at']) is distinct from (to_jsonb(old) - array['status','updated_at']) then
    raise exception 'Modifiez le devis avec l''éditeur.';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists t_guard_quote on public.quotes;
create trigger t_guard_quote before update on public.quotes for each row execute function public.guard_quote();

drop trigger if exists t_audit on public.quotes;
create trigger t_audit after insert or update or delete on public.quotes for each row execute function public.audit();

/** Crée ou modifie un devis (en-tête + lignes) ; numéro attribué à la création. */
create or replace function public.save_quote(p_quote uuid, p_company uuid, p_header jsonb, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_quote;
  v_company companies%rowtype;
  v_q quotes%rowtype;
  v_client parties%rowtype;
  v_snapshot jsonb;
  v_issue date := coalesce(nullif(p_header ->> 'issue_date', '')::date, current_date);
  v_year integer;
  v_seq integer;
  v_line jsonb;
  v_pos integer := 0;
  v_ttc bigint;
  v_rate integer;
  v_breakdown jsonb;
begin
  if not is_member(p_company) then raise exception 'Entreprise introuvable.'; end if;
  select * into v_company from companies where id = p_company;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Ajoutez au moins une ligne au devis.'; end if;

  if nullif(p_header ->> 'client_id', '') is not null then
    select * into v_client from parties where id = (p_header ->> 'client_id')::uuid and company_id = p_company and kind = 'client';
    if not found then raise exception 'Client introuvable.'; end if;
    v_snapshot := jsonb_build_object('name', v_client.name, 'ice', v_client.ice, 'if_number', v_client.if_number,
      'rc', v_client.rc, 'address', v_client.address, 'city', v_client.city);
  end if;

  if v_id is null then
    v_year := extract(year from v_issue)::integer;
    insert into delivery_note_counters (company_id, kind, year, last_seq) values (p_company, 'DV', v_year, 1)
    on conflict (company_id, kind, year) do update set last_seq = delivery_note_counters.last_seq + 1
    returning last_seq into v_seq;
    insert into quotes (company_id, number, seq, issue_date, is_demo, created_by)
    values (p_company, 'DV' || lpad(v_seq::text, 4, '0') || '/' || v_year, v_seq, v_issue, v_company.is_demo, auth.uid())
    returning id into v_id;
  else
    select * into v_q from quotes where id = v_id and company_id = p_company;
    if not found then raise exception 'Devis introuvable.'; end if;
    if v_q.status = 'invoiced' then raise exception 'Devis déjà transformé en facture : il ne peut plus être modifié.'; end if;
    delete from quote_lines where quote_id = v_id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_pos := v_pos + 1;
    v_rate := (v_line ->> 'vat_rate_bp')::integer;
    if not (v_rate = any (v_company.vat_rates_bp)) then
      raise exception 'Taux de TVA % %% non configuré pour cette entreprise.', v_rate / 100.0;
    end if;
    v_ttc := round((v_line ->> 'quantity')::numeric * (v_line ->> 'unit_price_ttc')::bigint
                   * (10000 - coalesce((v_line ->> 'discount_bp')::integer, 0)) / 10000.0)::bigint;
    insert into quote_lines (quote_id, company_id, position, product_id, designation, unit, quantity, unit_price_ttc, vat_rate_bp, discount_bp, total_ttc, total_ht)
    values (v_id, p_company, v_pos,
      (select id from products where id = nullif(v_line ->> 'product_id', '')::uuid and company_id = p_company),
      v_line ->> 'designation', nullif(v_line ->> 'unit', ''), (v_line ->> 'quantity')::numeric,
      (v_line ->> 'unit_price_ttc')::bigint, v_rate, coalesce((v_line ->> 'discount_bp')::integer, 0),
      v_ttc, ht_from_ttc(v_ttc, v_rate));
  end loop;

  -- Mêmes règles d'arrondi que les factures
  with g as (
    select vat_rate_bp, sum(total_ttc) as ttc,
           case when v_company.rounding_mode = 'per_line' then sum(total_ht) else ht_from_ttc(sum(total_ttc)::bigint, vat_rate_bp) end as ht
    from quote_lines where quote_id = v_id group by vat_rate_bp
  )
  select coalesce(jsonb_agg(jsonb_build_object('vat_rate_bp', vat_rate_bp, 'base_ht', ht, 'vat', ttc - ht, 'ttc', ttc) order by vat_rate_bp desc), '[]'::jsonb)
  into v_breakdown from g;

  update quotes set
    issue_date = v_issue,
    valid_until = nullif(p_header ->> 'valid_until', '')::date,
    client_id = v_client.id,
    client_snapshot = v_snapshot,
    payment_terms = nullif(trim(p_header ->> 'payment_terms'), ''),
    payment_method = nullif(trim(p_header ->> 'payment_method'), ''),
    notes = nullif(trim(p_header ->> 'notes'), ''),
    template_id = (select id from invoice_templates where id = nullif(p_header ->> 'template_id', '')::uuid and company_id = p_company),
    vat_breakdown = v_breakdown,
    total_ttc = coalesce((select sum((e ->> 'ttc')::bigint) from jsonb_array_elements(v_breakdown) e), 0),
    total_ht = coalesce((select sum((e ->> 'base_ht')::bigint) from jsonb_array_elements(v_breakdown) e), 0),
    total_vat = coalesce((select sum((e ->> 'vat')::bigint) from jsonb_array_elements(v_breakdown) e), 0),
    updated_at = now()
  where id = v_id;
  return v_id;
end $$;

/** Transforme un devis en facture brouillon (numéro attribué plus tard, à la validation de la facture). */
create or replace function public.convert_quote_to_invoice(p_quote uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_q quotes%rowtype;
  v_inv uuid;
  v_series uuid;
begin
  select * into v_q from quotes where id = p_quote;
  if not found or not is_member(v_q.company_id) then raise exception 'Devis introuvable.'; end if;
  if v_q.status = 'invoiced' then
    if v_q.invoice_id is not null then return v_q.invoice_id; end if;
    raise exception 'Devis déjà transformé.';
  end if;
  if v_q.status = 'refused' then raise exception 'Devis refusé : repassez-le « envoyé » ou « accepté » avant de le transformer.'; end if;
  if v_q.client_id is null then raise exception 'Choisissez d''abord le client du devis.'; end if;

  select default_series_id into v_series from parties where id = v_q.client_id;
  insert into invoices (company_id, series_id, issue_date, client_id, payment_terms, payment_method, notes, template_id, created_by)
  values (v_q.company_id, v_series, current_date, v_q.client_id, v_q.payment_terms, v_q.payment_method,
          coalesce(v_q.notes || E'\n', '') || 'Selon devis ' || v_q.number || ' du ' || to_char(v_q.issue_date, 'DD/MM/YYYY') || '.',
          v_q.template_id, auth.uid())
  returning id into v_inv;

  -- Les contrôles habituels des lignes de facture s'appliquent (taux, remises, prix hors catalogue).
  insert into invoice_lines (invoice_id, company_id, position, product_id, designation, unit, quantity, unit_price_ttc, vat_rate_bp, discount_bp, price_override_reason)
  select v_inv, l.company_id, l.position, l.product_id, l.designation, l.unit, l.quantity, l.unit_price_ttc, l.vat_rate_bp, l.discount_bp,
         case when p.id is not null and p.unit_price_ttc <> l.unit_price_ttc then 'Prix accepté au devis ' || v_q.number end
  from quote_lines l left join products p on p.id = l.product_id
  where l.quote_id = v_q.id order by l.position;

  update quotes set status = 'invoiced', invoice_id = v_inv, updated_at = now() where id = v_q.id;
  return v_inv;
end $$;

revoke all on function public.save_quote(uuid, uuid, jsonb, jsonb) from public, anon;
revoke all on function public.convert_quote_to_invoice(uuid) from public, anon;
grant execute on function public.save_quote(uuid, uuid, jsonb, jsonb) to authenticated;
grant execute on function public.convert_quote_to_invoice(uuid) to authenticated;

select 'Mise à jour terminée avec succès' as resultat;
