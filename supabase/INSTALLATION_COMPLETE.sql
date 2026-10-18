-- =====================================================================
-- SMART INVOICE — INSTALLATION COMPLÈTE EN UNE FOIS (Supabase → SQL Editor)
--
-- Copiez TOUT ce fichier dans le SQL Editor puis cliquez sur « Run ».
-- Il peut être relancé sans erreur : il supprime d'abord une éventuelle
-- installation partielle de Smart Invoice, puis recrée tout.
-- ⚠️ À utiliser pour l'INSTALLATION INITIALE : relancé plus tard, il
--    effacerait les données Smart Invoice (factures, clients, etc.).
--    Les comptes utilisateurs (Authentication) ne sont pas supprimés.
-- =====================================================================

-- ---------- Nettoyage d'une installation précédente ----------
drop trigger if exists on_auth_user_created on auth.users;
drop policy if exists assets_select on storage.objects;
drop policy if exists assets_insert on storage.objects;
drop policy if exists assets_update on storage.objects;
drop policy if exists assets_delete on storage.objects;

drop view if exists public.vat_journal cascade;
drop table if exists
  public.delivery_note_lines, public.delivery_notes, public.delivery_note_counters,
  public.vat_entries, public.pdf_imports,
  public.audit_log, public.payments, public.invoice_lines, public.invoices,
  public.invoice_templates, public.number_series, public.product_price_history,
  public.products, public.product_categories, public.parties, public.company_members,
  public.companies, public.profiles
  cascade;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array[
      'add_member_by_email','after_invoice_line','after_payment','audit','before_invoice_line','can_manage',
      'cancel_invoice','check_company_update','check_product_rate','correct_invoice','create_demo_company',
      'dashboard_stats','delete_demo_company','duplicate_invoice','format_invoice_number','guard_invoice',
      'guard_number_series','handle_new_user','has_role','ht_from_ttc','is_member','keep_one_admin',
      'on_company_created','on_payment','recompute_invoice','save_invoice_draft','set_default_series',
      'touch_updated_at','track_product_price','validate_invoice',
      'vat_entry_before','vat_declaration','vat_dashboard',
      'guard_delivery_note','create_note_from_invoice','copy_master_data','check_party_series'])
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $$;

drop type if exists public.member_role, public.invoice_status, public.party_kind, public.rounding_mode,
  public.vat_entry_kind, public.vat_entry_status cascade;

-- Profils des comptes déjà créés avant l'installation (recréés plus bas)


-- >>>>>>>>>> 20261016000001_schema.sql
-- =====================================================================
-- SMART INVOICE — 1/4 : schéma
-- Montants en centimes (bigint). Taux de TVA en points de base (2000 = 20 %).
-- =====================================================================

create extension if not exists pgcrypto;

create type public.member_role as enum ('admin', 'comptable', 'utilisateur');
create type public.invoice_status as enum ('draft', 'validated', 'partially_paid', 'paid', 'cancelled');
create type public.party_kind as enum ('client', 'supplier');
create type public.rounding_mode as enum ('per_rate', 'per_line');

-- ---------------------------------------------------------------------
-- Profils utilisateurs (miroir de auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Entreprises
-- ---------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null check (length(trim(legal_name)) > 0),
  ice text check (ice is null or ice ~ '^[0-9]{15}$'),
  if_number text,
  rc text,
  tp text,
  cnss text,
  address text,
  city text,
  phone text,
  email text,
  logo_path text,
  bank_name text,
  rib text,
  -- Affichage sur les factures (téléphone / e-mail / banque masqués par défaut)
  show_phone boolean not null default false,
  show_email boolean not null default false,
  show_bank boolean not null default false,
  -- Paramètres de facturation
  vat_rates_bp integer[] not null default '{2000,1400,1000,700,0}',
  default_vat_rate_bp integer not null default 2000,
  rounding_mode public.rounding_mode not null default 'per_rate',
  require_client_ice boolean not null default true,
  allow_discounts boolean not null default false,
  currency_label text not null default 'DH' check (currency_label in ('DH', 'DHS', 'MAD')),
  default_payment_terms text,
  default_due_days integer not null default 30 check (default_due_days between 0 and 365),
  legal_mentions text,
  default_template_id uuid,
  -- Données de démonstration : jamais mélangées avec les données réelles
  is_demo boolean not null default false,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint default_rate_in_list check (default_vat_rate_bp = any (vat_rates_bp))
);

create table public.company_members (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null default 'utilisateur',
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index on public.company_members (user_id);

-- ---------------------------------------------------------------------
-- Clients et fournisseurs
-- ---------------------------------------------------------------------
create table public.parties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind public.party_kind not null,
  name text not null check (length(trim(name)) > 0),
  ice text check (ice is null or ice ~ '^[0-9]{15}$'),
  if_number text,
  rc text,
  address text,
  city text,
  phone text,
  email text,
  payment_terms text,
  notes text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index parties_unique_ice on public.parties (company_id, kind, ice) where ice is not null;
create index on public.parties (company_id, kind, archived);

-- ---------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------
create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  unique (company_id, name)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  reference text not null check (length(trim(reference)) > 0),
  designation text not null check (length(trim(designation)) > 0),
  category_id uuid references public.product_categories (id) on delete set null,
  unit text not null default 'U',
  unit_price_ttc bigint not null check (unit_price_ttc >= 0),
  vat_rate_bp integer not null check (vat_rate_bp between 0 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, reference)
);

-- Historique des prix : toute modification de prix est tracée.
create table public.product_price_history (
  id bigserial primary key,
  product_id uuid not null references public.products (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  old_price_ttc bigint,
  new_price_ttc bigint not null,
  old_vat_rate_bp integer,
  new_vat_rate_bp integer not null,
  changed_by uuid references auth.users (id),
  changed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Séries de numérotation
-- ---------------------------------------------------------------------
create table public.number_series (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  format text not null default 'FA{SEQ:4}/{YYYY}',
  next_seq integer not null default 1 check (next_seq >= 1),
  reset_yearly boolean not null default true,
  current_year integer,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, name),
  constraint one_seq_token check (
    (length(format) - length(regexp_replace(format, '\{SEQ(:[0-9]{1,2})?\}', '', 'g'))) > 0
  )
);
create unique index number_series_one_default on public.number_series (company_id) where is_default;

-- ---------------------------------------------------------------------
-- Modèles de factures
-- ---------------------------------------------------------------------
create table public.invoice_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null,
  base text not null check (base in (
    'classic','minimal','modern','elegant','clean','stripe','compact','gray','accent','boxed','corporate','entete'
  )),
  settings jsonb not null default '{}'::jsonb,
  background_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);
alter table public.companies
  add constraint companies_default_template_fk
  foreign key (default_template_id) references public.invoice_templates (id) on delete set null;

-- ---------------------------------------------------------------------
-- Factures
-- ---------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  series_id uuid references public.number_series (id),
  number text,
  seq integer,
  status public.invoice_status not null default 'draft',
  issue_date date not null default current_date,
  due_date date,
  client_id uuid references public.parties (id),
  client_snapshot jsonb,
  company_snapshot jsonb,
  order_ref text,
  payment_terms text,
  goods_nature text,
  notes text,
  template_id uuid references public.invoice_templates (id) on delete set null,
  total_ht bigint not null default 0,
  total_vat bigint not null default 0,
  total_ttc bigint not null default 0,
  vat_breakdown jsonb not null default '[]'::jsonb,
  amount_paid bigint not null default 0 check (amount_paid >= 0),
  corrects_invoice_id uuid references public.invoices (id),
  is_demo boolean not null default false,
  validated_at timestamptz,
  validated_by uuid references auth.users (id),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id),
  cancel_reason text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint number_iff_not_draft check ((status = 'draft') = (number is null)),
  constraint due_after_issue check (due_date is null or due_date >= issue_date),
  constraint cancel_reason_required check (status <> 'cancelled' or length(trim(coalesce(cancel_reason, ''))) > 0)
);
create unique index invoices_unique_number on public.invoices (company_id, number) where number is not null;
create unique index invoices_unique_order_ref on public.invoices (company_id, order_ref)
  where order_ref is not null and status <> 'cancelled';
create index on public.invoices (company_id, status, issue_date desc);
create index on public.invoices (client_id);

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  position integer not null default 0,
  product_id uuid references public.products (id),
  designation text not null check (length(trim(designation)) > 0),
  unit text,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price_ttc bigint not null check (unit_price_ttc >= 0),
  catalog_price_ttc bigint,
  price_override_reason text,
  vat_rate_bp integer not null check (vat_rate_bp between 0 and 10000),
  discount_bp integer not null default 0 check (discount_bp between 0 and 10000),
  total_ttc bigint not null default 0,
  total_ht bigint not null default 0,
  total_vat bigint not null default 0
);
create index on public.invoice_lines (invoice_id, position);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  company_id uuid not null references public.companies (id) on delete cascade,
  amount bigint not null check (amount > 0),
  paid_at date not null default current_date,
  method text not null default 'virement' check (method in ('virement','cheque','especes','effet','carte','autre')),
  reference text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.payments (invoice_id);

-- ---------------------------------------------------------------------
-- Journal des opérations
-- ---------------------------------------------------------------------
create table public.audit_log (
  id bigserial primary key,
  company_id uuid references public.companies (id) on delete cascade,
  user_id uuid,
  table_name text not null,
  record_id uuid,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  at timestamptz not null default now()
);
create index on public.audit_log (company_id, at desc);
create index on public.audit_log (record_id);

-- >>>>>>>>>> 20261016000002_logic.sql
-- =====================================================================
-- SMART INVOICE — 2/4 : fonctions, déclencheurs et règles métier
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helpers d'appartenance (SECURITY DEFINER pour éviter la récursion RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_member(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from company_members where company_id = p_company and user_id = auth.uid());
$$;

create or replace function public.has_role(p_company uuid, p_roles public.member_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from company_members
    where company_id = p_company and user_id = auth.uid() and role = any (p_roles)
  );
$$;

create or replace function public.can_manage(p_company uuid)
returns boolean language sql stable as $$
  select public.has_role(p_company, array['admin','comptable']::public.member_role[]);
$$;

-- ---------------------------------------------------------------------
-- Profils : créés automatiquement à l'inscription
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', null))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger t_companies_touch before update on public.companies for each row execute function public.touch_updated_at();
create trigger t_parties_touch before update on public.parties for each row execute function public.touch_updated_at();
create trigger t_products_touch before update on public.products for each row execute function public.touch_updated_at();
create trigger t_templates_touch before update on public.invoice_templates for each row execute function public.touch_updated_at();
create trigger t_invoices_touch before update on public.invoices for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Nouvelle entreprise : le créateur devient administrateur,
-- une série de numérotation par défaut est créée.
-- ---------------------------------------------------------------------
create or replace function public.on_company_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    insert into company_members (company_id, user_id, role) values (new.id, auth.uid(), 'admin')
    on conflict do nothing;
  end if;
  insert into number_series (company_id, name, format, is_default)
  values (new.id, 'Factures', case when new.is_demo then 'DEMO-{SEQ:4}/{YYYY}' else 'FA{SEQ:4}/{YYYY}' end, true);
  return new;
end $$;

create trigger t_company_created after insert on public.companies
  for each row execute function public.on_company_created();

create or replace function public.check_company_update()
returns trigger language plpgsql as $$
begin
  if new.is_demo <> old.is_demo then
    raise exception 'Le statut « démonstration » d''une entreprise ne peut pas être modifié.';
  end if;
  if new.created_by is distinct from old.created_by then
    new.created_by := old.created_by;
  end if;
  return new;
end $$;
create trigger t_company_update before update on public.companies
  for each row execute function public.check_company_update();

-- Il doit toujours rester au moins un administrateur.
create or replace function public.keep_one_admin()
returns trigger language plpgsql as $$
declare v_company uuid := coalesce(old.company_id, new.company_id);
begin
  if not exists (select 1 from company_members where company_id = v_company and role = 'admin')
     and exists (select 1 from companies where id = v_company) then
    raise exception 'L''entreprise doit conserver au moins un administrateur.';
  end if;
  return null;
end $$;
create constraint trigger t_keep_one_admin after update or delete on public.company_members
  for each row execute function public.keep_one_admin();

-- Ajouter un membre par e-mail (l'utilisateur doit déjà avoir un compte).
create or replace function public.add_member_by_email(p_company uuid, p_email text, p_role public.member_role)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if not has_role(p_company, array['admin']::member_role[]) then
    raise exception 'Seul un administrateur peut ajouter des utilisateurs.';
  end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'Aucun compte avec cet e-mail. La personne doit d''abord créer son compte sur l''application.';
  end if;
  insert into company_members (company_id, user_id, role) values (p_company, v_user, p_role)
  on conflict (company_id, user_id) do update set role = excluded.role;
  return v_user;
end $$;

-- ---------------------------------------------------------------------
-- Catalogue : historique des prix
-- ---------------------------------------------------------------------
create or replace function public.track_product_price()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.unit_price_ttc <> old.unit_price_ttc or new.vat_rate_bp <> old.vat_rate_bp then
    insert into product_price_history (product_id, company_id, old_price_ttc, new_price_ttc, old_vat_rate_bp, new_vat_rate_bp, changed_by)
    values (new.id, new.company_id,
            case when tg_op = 'UPDATE' then old.unit_price_ttc end, new.unit_price_ttc,
            case when tg_op = 'UPDATE' then old.vat_rate_bp end, new.vat_rate_bp, auth.uid());
  end if;
  return null;
end $$;
create trigger t_product_price after insert or update on public.products
  for each row execute function public.track_product_price();

-- Le taux d'un produit doit faire partie des taux configurés de l'entreprise.
create or replace function public.check_product_rate()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from companies where id = new.company_id and new.vat_rate_bp = any (vat_rates_bp)) then
    raise exception 'Taux de TVA % %% non configuré pour cette entreprise.', new.vat_rate_bp / 100.0;
  end if;
  return new;
end $$;
create trigger t_product_rate before insert or update of vat_rate_bp on public.products
  for each row execute function public.check_product_rate();

-- ---------------------------------------------------------------------
-- Numérotation
-- ---------------------------------------------------------------------
create or replace function public.format_invoice_number(p_format text, p_seq integer, p_date date)
returns text language plpgsql immutable as $$
declare
  v text := p_format;
  v_pad integer;
  m text[];
begin
  v := replace(v, '{YYYY}', to_char(p_date, 'YYYY'));
  v := replace(v, '{YY}', to_char(p_date, 'YY'));
  v := replace(v, '{MM}', to_char(p_date, 'MM'));
  m := regexp_match(v, '\{SEQ(?::([0-9]{1,2}))?\}');
  if m is null then raise exception 'Format de numérotation invalide : %', p_format; end if;
  v_pad := coalesce(m[1]::integer, 1);
  return regexp_replace(v, '\{SEQ(:[0-9]{1,2})?\}', lpad(p_seq::text, greatest(v_pad, length(p_seq::text)), '0'));
end $$;

-- ---------------------------------------------------------------------
-- Calcul des lignes et des totaux (même algorithme que src/domain/vat.ts)
-- ---------------------------------------------------------------------
create or replace function public.ht_from_ttc(p_ttc bigint, p_rate integer)
returns bigint language sql immutable as $$
  select case when p_rate <= 0 then p_ttc else round(p_ttc::numeric * 10000 / (10000 + p_rate))::bigint end;
$$;

create or replace function public.recompute_invoice(p_invoice uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_mode rounding_mode;
  v_breakdown jsonb;
begin
  select c.rounding_mode into v_mode
  from invoices i join companies c on c.id = i.company_id where i.id = p_invoice;

  with g as (
    select vat_rate_bp,
           sum(total_ttc) as ttc,
           case when v_mode = 'per_line' then sum(total_ht) else ht_from_ttc(sum(total_ttc)::bigint, vat_rate_bp) end as ht
    from invoice_lines where invoice_id = p_invoice group by vat_rate_bp
  )
  select coalesce(jsonb_agg(jsonb_build_object('vat_rate_bp', vat_rate_bp, 'base_ht', ht, 'vat', ttc - ht, 'ttc', ttc)
                            order by vat_rate_bp desc), '[]'::jsonb)
  into v_breakdown from g;

  update invoices set
    vat_breakdown = v_breakdown,
    total_ttc = coalesce((select sum((e ->> 'ttc')::bigint) from jsonb_array_elements(v_breakdown) e), 0),
    total_ht  = coalesce((select sum((e ->> 'base_ht')::bigint) from jsonb_array_elements(v_breakdown) e), 0),
    total_vat = coalesce((select sum((e ->> 'vat')::bigint) from jsonb_array_elements(v_breakdown) e), 0)
  where id = p_invoice;
end $$;

-- Avant écriture d'une ligne : contrôles + calcul de la ligne.
create or replace function public.before_invoice_line()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_inv invoices%rowtype;
  v_company companies%rowtype;
  v_product products%rowtype;
begin
  select * into v_inv from invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if tg_op = 'DELETE' and (v_inv.id is null or not exists (select 1 from companies where id = old.company_id)) then
    return old; -- suppression en cascade (facture ou entreprise supprimée)
  end if;
  if tg_op = 'DELETE' and coalesce(current_setting('smart_invoice.internal', true), '') = 'on'
     and current_user in ('postgres', 'supabase_admin') then
    return old;
  end if;
  if v_inv.status <> 'draft' then
    raise exception 'Facture % validée : ses lignes ne peuvent plus être modifiées. Utilisez « Corriger ».', v_inv.number;
  end if;
  if tg_op = 'DELETE' then return old; end if;

  new.company_id := v_inv.company_id;
  select * into v_company from companies where id = v_inv.company_id;

  if not (new.vat_rate_bp = any (v_company.vat_rates_bp)) then
    raise exception 'Taux de TVA % %% non configuré pour cette entreprise.', new.vat_rate_bp / 100.0;
  end if;

  -- Prix catalogue : jamais modifié ; une dérogation doit être autorisée et justifiée.
  if new.product_id is not null then
    select * into v_product from products where id = new.product_id and company_id = v_inv.company_id;
    if not found then raise exception 'Produit introuvable pour cette entreprise.'; end if;
    new.catalog_price_ttc := v_product.unit_price_ttc;
    if new.unit_price_ttc <> v_product.unit_price_ttc then
      if not can_manage(v_inv.company_id) then
        raise exception 'Seuls un administrateur ou un comptable peuvent modifier un prix sur une facture.';
      end if;
      if length(trim(coalesce(new.price_override_reason, ''))) = 0 then
        raise exception 'Le motif de la modification de prix est obligatoire (ligne « % »).', new.designation;
      end if;
    else
      new.price_override_reason := null;
    end if;
  else
    new.catalog_price_ttc := null;
  end if;

  if new.discount_bp > 0 then
    if not v_company.allow_discounts then
      raise exception 'Les remises ne sont pas autorisées pour cette entreprise (voir Paramètres).';
    end if;
    if not can_manage(v_inv.company_id) then
      raise exception 'Seuls un administrateur ou un comptable peuvent accorder une remise.';
    end if;
  end if;

  new.total_ttc := round(new.quantity * new.unit_price_ttc * (10000 - new.discount_bp) / 10000.0)::bigint;
  new.total_ht := ht_from_ttc(new.total_ttc, new.vat_rate_bp);
  new.total_vat := new.total_ttc - new.total_ht;
  return new;
end $$;

create trigger t_invoice_line_before before insert or update or delete on public.invoice_lines
  for each row execute function public.before_invoice_line();

create or replace function public.after_invoice_line()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform recompute_invoice(coalesce(new.invoice_id, old.invoice_id));
  return null;
end $$;
create trigger t_invoice_line_after after insert or update or delete on public.invoice_lines
  for each row execute function public.after_invoice_line();

-- ---------------------------------------------------------------------
-- Verrouillage des factures validées
-- ---------------------------------------------------------------------
create or replace function public.guard_invoice()
returns trigger language plpgsql as $$
declare
  -- Mode interne : uniquement depuis les fonctions SECURITY DEFINER (propriétaire postgres)
  v_internal boolean := coalesce(current_setting('smart_invoice.internal', true), '') = 'on'
                        and current_user in ('postgres', 'supabase_admin');
begin
  if tg_op = 'DELETE' then
    -- Suppression en cascade de l'entreprise elle-même : autorisée
    if not exists (select 1 from companies where id = old.company_id) then return old; end if;
    if old.status <> 'draft' and not v_internal then
      raise exception 'Une facture validée (%) ne peut pas être supprimée. Utilisez « Annuler ».', old.number;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if not v_internal then
      new.status := 'draft';
      new.number := null; new.seq := null;
      new.validated_at := null; new.validated_by := null;
      new.cancelled_at := null; new.cancelled_by := null; new.cancel_reason := null;
      new.company_snapshot := null;
      new.amount_paid := 0;
    end if;
    new.is_demo := (select is_demo from companies where id = new.company_id);
    new.total_ht := 0; new.total_vat := 0; new.total_ttc := 0; new.vat_breakdown := '[]'::jsonb;
    return new;
  end if;

  -- UPDATE
  new.company_id := old.company_id;
  new.is_demo := old.is_demo;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if v_internal then return new; end if;

  -- Les totaux ne sont écrits que par recompute_invoice (SECURITY DEFINER, interne)
  if (new.total_ttc, new.total_ht, new.total_vat, new.vat_breakdown)
     is distinct from (old.total_ttc, old.total_ht, old.total_vat, old.vat_breakdown)
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'Les totaux sont calculés automatiquement.';
  end if;

  if old.status = 'draft' then
    if new.status <> 'draft' or new.number is not null or new.validated_at is not null then
      raise exception 'Utilisez « Valider » pour attribuer un numéro.';
    end if;
    if new.amount_paid <> 0 then raise exception 'Un brouillon ne peut pas recevoir de paiement.'; end if;
    return new;
  end if;

  raise exception 'La facture % est validée et ne peut plus être modifiée. Utilisez « Annuler » ou « Corriger ».', old.number;
end $$;

create trigger t_guard_invoice before insert or update or delete on public.invoices
  for each row execute function public.guard_invoice();

-- recompute_invoice est SECURITY DEFINER (propriétaire postgres) : ses écritures
-- de totaux passent le contrôle ci-dessus ; un utilisateur ne peut pas écrire de totaux.

-- ---------------------------------------------------------------------
-- Valider une facture : numéro définitif, séquentiel, sans trou ni doublon
-- ---------------------------------------------------------------------
create or replace function public.validate_invoice(p_invoice uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_inv invoices%rowtype;
  v_company companies%rowtype;
  v_client parties%rowtype;
  v_series number_series%rowtype;
  v_year integer;
  v_seq integer;
  v_number text;
  v_last_date date;
begin
  select * into v_inv from invoices where id = p_invoice for update;
  if not found then raise exception 'Facture introuvable.'; end if;
  if not can_manage(v_inv.company_id) then
    raise exception 'Seuls un administrateur ou un comptable peuvent valider une facture.';
  end if;
  if v_inv.status <> 'draft' then raise exception 'Cette facture est déjà validée (%).', v_inv.number; end if;
  if not exists (select 1 from invoice_lines where invoice_id = p_invoice) then
    raise exception 'La facture ne contient aucune ligne.';
  end if;
  if v_inv.total_ttc <= 0 then raise exception 'Le total TTC doit être supérieur à zéro.'; end if;

  select * into v_company from companies where id = v_inv.company_id;
  select * into v_client from parties where id = v_inv.client_id and company_id = v_inv.company_id and kind = 'client';
  if not found then raise exception 'Client manquant.'; end if;
  if v_client.archived then raise exception 'Le client « % » est archivé.', v_client.name; end if;
  if v_company.require_client_ice and v_client.ice is null then
    raise exception 'L''ICE du client « % » est obligatoire.', v_client.name;
  end if;

  if v_inv.series_id is null then
    select * into v_series from number_series where company_id = v_inv.company_id and is_default for update;
  else
    select * into v_series from number_series where id = v_inv.series_id and company_id = v_inv.company_id for update;
  end if;
  if not found then raise exception 'Aucune série de numérotation par défaut.'; end if;

  -- Chronologie : pas de facture antérieure à la dernière facture validée de la série.
  select max(issue_date) into v_last_date from invoices
  where series_id = v_series.id and status <> 'draft';
  if v_last_date is not null and v_inv.issue_date < v_last_date then
    raise exception 'Date (%) antérieure à la dernière facture validée de la série (%). La numérotation doit rester chronologique.',
      to_char(v_inv.issue_date, 'DD/MM/YYYY'), to_char(v_last_date, 'DD/MM/YYYY');
  end if;

  v_year := extract(year from v_inv.issue_date);
  v_seq := v_series.next_seq;
  -- Remise à 1 au changement d'année. Si la série n'a encore jamais servi (current_year vide),
  -- le numéro de départ choisi par l'utilisateur est respecté.
  if v_series.reset_yearly and v_series.current_year is not null and v_series.current_year <> v_year then
    if v_year < v_series.current_year then
      raise exception 'Année % antérieure à l''année en cours de la série (%).', v_year, v_series.current_year;
    end if;
    v_seq := 1;
  end if;
  v_number := format_invoice_number(v_series.format, v_seq, v_inv.issue_date);

  if exists (select 1 from invoices where company_id = v_inv.company_id and number = v_number) then
    raise exception 'Le numéro % existe déjà. Vérifiez la série de numérotation.', v_number;
  end if;

  perform set_config('smart_invoice.internal', 'on', true);
  update number_series set next_seq = v_seq + 1, current_year = v_year where id = v_series.id;
  update invoices set
    status = 'validated',
    series_id = v_series.id,
    number = v_number,
    seq = v_seq,
    due_date = coalesce(v_inv.due_date, v_inv.issue_date + v_company.default_due_days),
    validated_at = now(),
    validated_by = auth.uid(),
    client_snapshot = jsonb_build_object(
      'name', v_client.name, 'ice', v_client.ice, 'if_number', v_client.if_number, 'rc', v_client.rc,
      'address', v_client.address, 'city', v_client.city),
    company_snapshot = to_jsonb(v_company) - 'created_by' - 'created_at' - 'updated_at'
  where id = p_invoice;
  perform set_config('smart_invoice.internal', 'off', true);

  return v_number;
end $$;

-- ---------------------------------------------------------------------
-- Annuler une facture validée (le numéro est conservé, rien n'est supprimé)
-- ---------------------------------------------------------------------
create or replace function public.cancel_invoice(p_invoice uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_inv invoices%rowtype;
begin
  select * into v_inv from invoices where id = p_invoice for update;
  if not found then raise exception 'Facture introuvable.'; end if;
  if not can_manage(v_inv.company_id) then
    raise exception 'Seuls un administrateur ou un comptable peuvent annuler une facture.';
  end if;
  if v_inv.status = 'draft' then raise exception 'Un brouillon se supprime, il ne s''annule pas.'; end if;
  if v_inv.status = 'cancelled' then raise exception 'Facture déjà annulée.'; end if;
  if v_inv.amount_paid > 0 then
    raise exception 'La facture a reçu des paiements : annulez d''abord les paiements.';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Indiquez le motif de l''annulation.'; end if;
  perform set_config('smart_invoice.internal', 'on', true);
  update invoices set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = trim(p_reason)
  where id = p_invoice;
  perform set_config('smart_invoice.internal', 'off', true);
end $$;

-- Corriger : annule la facture et crée un brouillon copié qui la référence.
create or replace function public.correct_invoice(p_invoice uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_new uuid;
begin
  perform cancel_invoice(p_invoice, 'Correction : ' || coalesce(p_reason, ''));
  v_new := duplicate_invoice(p_invoice);
  update invoices set corrects_invoice_id = p_invoice where id = v_new;
  return v_new;
end $$;

-- Dupliquer : nouveau brouillon avec les mêmes lignes et les PRIX ACTUELS du catalogue
-- pour les lignes liées à un produit (un prix dérogatoire n'est jamais recopié en silence).
create or replace function public.duplicate_invoice(p_invoice uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_inv invoices%rowtype;
  v_new uuid;
begin
  select * into v_inv from invoices where id = p_invoice;
  if not found or not is_member(v_inv.company_id) then raise exception 'Facture introuvable.'; end if;
  insert into invoices (company_id, series_id, issue_date, client_id, payment_terms, goods_nature, notes, template_id, created_by)
  values (v_inv.company_id, v_inv.series_id, current_date, v_inv.client_id, v_inv.payment_terms, v_inv.goods_nature,
          v_inv.notes, v_inv.template_id, auth.uid())
  returning id into v_new;
  insert into invoice_lines (invoice_id, company_id, position, product_id, designation, unit, quantity, unit_price_ttc, vat_rate_bp, discount_bp)
  select v_new, l.company_id, l.position, l.product_id, l.designation, l.unit, l.quantity,
         coalesce(p.unit_price_ttc, l.unit_price_ttc), coalesce(p.vat_rate_bp, l.vat_rate_bp), 0
  from invoice_lines l left join products p on p.id = l.product_id
  where l.invoice_id = p_invoice order by l.position;
  return v_new;
end $$;

-- ---------------------------------------------------------------------
-- Paiements → statut payée / partiellement payée
-- ---------------------------------------------------------------------
create or replace function public.on_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_inv invoices%rowtype;
  v_paid bigint;
begin
  select * into v_inv from invoices where id = coalesce(new.invoice_id, old.invoice_id) for update;
  if tg_op in ('INSERT', 'UPDATE') then
    if v_inv.status in ('draft', 'cancelled') then
      raise exception 'Paiement impossible sur une facture en brouillon ou annulée.';
    end if;
    new.company_id := v_inv.company_id;
  end if;
  return coalesce(new, old);
end $$;
create trigger t_payment_before before insert or update or delete on public.payments
  for each row execute function public.on_payment();

create or replace function public.after_payment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := coalesce(new.invoice_id, old.invoice_id);
  v_total bigint;
  v_paid bigint;
begin
  select total_ttc into v_total from invoices where id = v_id;
  select coalesce(sum(amount), 0) into v_paid from payments where invoice_id = v_id;
  if v_paid > v_total then raise exception 'Le total des paiements dépasse le montant de la facture.'; end if;
  perform set_config('smart_invoice.internal', 'on', true);
  update invoices set
    amount_paid = v_paid,
    status = (case when v_paid = 0 then 'validated' when v_paid < v_total then 'partially_paid' else 'paid' end)::invoice_status
  where id = v_id and status <> 'cancelled';
  perform set_config('smart_invoice.internal', 'off', true);
  return null;
end $$;
create trigger t_payment_after after insert or update or delete on public.payments
  for each row execute function public.after_payment();

-- ---------------------------------------------------------------------
-- Journal des opérations (toutes les tables métier)
-- ---------------------------------------------------------------------
create or replace function public.audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_company uuid;
  v_id uuid;
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
begin
  v_company := coalesce((v_new ->> 'company_id')::uuid, (v_old ->> 'company_id')::uuid);
  if tg_table_name = 'companies' then v_company := coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid); end if;
  v_id := coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid);
  -- Évite de journaliser les recalculs automatiques des totaux
  if tg_op = 'UPDATE' and tg_table_name = 'invoices'
     and (v_old - array['total_ht','total_vat','total_ttc','vat_breakdown','updated_at'])
       = (v_new - array['total_ht','total_vat','total_ttc','vat_breakdown','updated_at']) then
    return null;
  end if;
  -- La suppression en cascade d'une entreprise ne journalise pas chaque ligne
  if tg_op = 'DELETE' and tg_table_name <> 'companies'
     and not exists (select 1 from companies where id = v_company) then
    return null;
  end if;
  insert into audit_log (company_id, user_id, table_name, record_id, action, old_data, new_data)
  values (case when tg_op = 'DELETE' and tg_table_name = 'companies' then null else v_company end,
          auth.uid(), tg_table_name, v_id, lower(tg_op), v_old, v_new);
  return null;
end $$;

create trigger t_audit after insert or update or delete on public.companies for each row execute function public.audit();
create trigger t_audit after insert or update or delete on public.company_members for each row execute function public.audit();
create trigger t_audit after insert or update or delete on public.parties for each row execute function public.audit();
create trigger t_audit after insert or update or delete on public.products for each row execute function public.audit();
create trigger t_audit after insert or update or delete on public.number_series for each row execute function public.audit();
create trigger t_audit after insert or update or delete on public.invoice_templates for each row execute function public.audit();
create trigger t_audit after insert or update or delete on public.invoices for each row execute function public.audit();
create trigger t_audit after insert or update or delete on public.invoice_lines for each row execute function public.audit();
create trigger t_audit after insert or update or delete on public.payments for each row execute function public.audit();

-- ---------------------------------------------------------------------
-- Tableau de bord (calculé depuis la base, filtré par entreprise et période)
-- ---------------------------------------------------------------------
create or replace function public.dashboard_stats(p_company uuid, p_from date, p_to date)
returns jsonb language sql stable security invoker set search_path = public as $$
  with inv as (
    select * from invoices
    where company_id = p_company and issue_date between p_from and p_to
  )
  select jsonb_build_object(
    'invoices_count', (select count(*) from inv where status not in ('draft', 'cancelled')),
    'drafts_count', (select count(*) from inv where status = 'draft'),
    'sales_ttc', (select coalesce(sum(total_ttc), 0) from inv where status not in ('draft', 'cancelled')),
    'sales_ht', (select coalesce(sum(total_ht), 0) from inv where status not in ('draft', 'cancelled')),
    'vat_collected', (select coalesce(sum(total_vat), 0) from inv where status not in ('draft', 'cancelled')),
    'paid', (select coalesce(sum(amount_paid), 0) from inv where status not in ('draft', 'cancelled')),
    'outstanding', (select coalesce(sum(total_ttc - amount_paid), 0) from inv where status in ('validated', 'partially_paid')),
    'overdue_count', (select count(*) from inv where status in ('validated', 'partially_paid') and due_date < current_date),
    'by_month', (
      select coalesce(jsonb_agg(jsonb_build_object('month', m, 'ttc', ttc, 'ht', ht, 'vat', vat) order by m), '[]'::jsonb)
      from (
        select to_char(issue_date, 'YYYY-MM') m, sum(total_ttc) ttc, sum(total_ht) ht, sum(total_vat) vat
        from inv where status not in ('draft', 'cancelled') group by 1
      ) s
    )
  );
$$;

-- >>>>>>>>>> 20261016000003_rls.sql
-- =====================================================================
-- SMART INVOICE — 3/4 : sécurité (RLS) et stockage
-- Chaque ligne appartient à une entreprise ; seuls ses membres y accèdent.
-- =====================================================================

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.parties enable row level security;
alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.product_price_history enable row level security;
alter table public.number_series enable row level security;
alter table public.invoice_templates enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.payments enable row level security;
alter table public.audit_log enable row level security;

-- Profils : soi-même et les membres des mêmes entreprises
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from public.company_members a join public.company_members b on a.company_id = b.company_id
    where a.user_id = auth.uid() and b.user_id = profiles.id)
);
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Entreprises
-- (À la création, l'application génère l'id côté client puis relit l'entreprise
--  une fois l'appartenance créée : pas besoin d'élargir cette règle.)
create policy companies_select on public.companies for select to authenticated using (public.is_member(id));
create policy companies_insert on public.companies for insert to authenticated with check (created_by = auth.uid());
create policy companies_update on public.companies for update to authenticated
  using (public.has_role(id, array['admin']::public.member_role[]))
  with check (public.has_role(id, array['admin']::public.member_role[]));
create policy companies_delete on public.companies for delete to authenticated
  using (is_demo and public.has_role(id, array['admin']::public.member_role[]));

-- Membres
create policy members_select on public.company_members for select to authenticated using (public.is_member(company_id));
create policy members_write on public.company_members for all to authenticated
  using (public.has_role(company_id, array['admin']::public.member_role[]))
  with check (public.has_role(company_id, array['admin']::public.member_role[]));

-- Clients / fournisseurs : tous les membres ; pas de suppression (archivage)
create policy parties_select on public.parties for select to authenticated using (public.is_member(company_id));
create policy parties_insert on public.parties for insert to authenticated with check (public.is_member(company_id));
create policy parties_update on public.parties for update to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

-- Catalogue : lecture par tous les membres, écriture admin / comptable
create policy categories_select on public.product_categories for select to authenticated using (public.is_member(company_id));
create policy categories_write on public.product_categories for all to authenticated
  using (public.can_manage(company_id)) with check (public.can_manage(company_id));

create policy products_select on public.products for select to authenticated using (public.is_member(company_id));
create policy products_insert on public.products for insert to authenticated with check (public.can_manage(company_id));
create policy products_update on public.products for update to authenticated
  using (public.can_manage(company_id)) with check (public.can_manage(company_id));

create policy price_history_select on public.product_price_history for select to authenticated using (public.is_member(company_id));

-- Séries et modèles
create policy series_select on public.number_series for select to authenticated using (public.is_member(company_id));
create policy series_insert on public.number_series for insert to authenticated with check (public.can_manage(company_id));
create policy series_update on public.number_series for update to authenticated
  using (public.has_role(company_id, array['admin']::public.member_role[]))
  with check (public.has_role(company_id, array['admin']::public.member_role[]));

create policy templates_select on public.invoice_templates for select to authenticated using (public.is_member(company_id));
create policy templates_write on public.invoice_templates for all to authenticated
  using (public.can_manage(company_id)) with check (public.can_manage(company_id));

-- Factures : tous les membres créent et modifient des brouillons ;
-- validation / annulation via fonctions contrôlées (rôle admin / comptable).
create policy invoices_select on public.invoices for select to authenticated using (public.is_member(company_id));
create policy invoices_insert on public.invoices for insert to authenticated with check (public.is_member(company_id));
create policy invoices_update on public.invoices for update to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));
create policy invoices_delete on public.invoices for delete to authenticated
  using (public.is_member(company_id) and status = 'draft');

create policy lines_select on public.invoice_lines for select to authenticated using (public.is_member(company_id));
create policy lines_insert on public.invoice_lines for insert to authenticated with check (
  exists (select 1 from public.invoices i where i.id = invoice_id and public.is_member(i.company_id))
);
create policy lines_update on public.invoice_lines for update to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));
create policy lines_delete on public.invoice_lines for delete to authenticated using (public.is_member(company_id));

create policy payments_select on public.payments for select to authenticated using (public.is_member(company_id));
create policy payments_insert on public.payments for insert to authenticated with check (
  exists (select 1 from public.invoices i where i.id = invoice_id and public.can_manage(i.company_id))
);
create policy payments_delete on public.payments for delete to authenticated using (public.can_manage(company_id));

-- Journal : lecture seule, admin / comptable
create policy audit_select on public.audit_log for select to authenticated using (public.can_manage(company_id));

-- Fonctions exposées
revoke all on function public.validate_invoice(uuid) from public, anon;
revoke all on function public.cancel_invoice(uuid, text) from public, anon;
revoke all on function public.correct_invoice(uuid, text) from public, anon;
revoke all on function public.duplicate_invoice(uuid) from public, anon;
revoke all on function public.add_member_by_email(uuid, text, public.member_role) from public, anon;
revoke all on function public.recompute_invoice(uuid) from public, anon, authenticated;
grant execute on function public.validate_invoice(uuid) to authenticated;
grant execute on function public.cancel_invoice(uuid, text) to authenticated;
grant execute on function public.correct_invoice(uuid, text) to authenticated;
grant execute on function public.duplicate_invoice(uuid) to authenticated;
grant execute on function public.add_member_by_email(uuid, text, public.member_role) to authenticated;

-- ---------------------------------------------------------------------
-- Stockage privé (logos, fonds de modèles) : dossier = id de l'entreprise
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('company-assets', 'company-assets', false)
on conflict (id) do nothing;

create policy assets_select on storage.objects for select to authenticated using (
  bucket_id = 'company-assets' and public.is_member(((storage.foldername(name))[1])::uuid)
);
create policy assets_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'company-assets' and public.can_manage(((storage.foldername(name))[1])::uuid)
);
create policy assets_update on storage.objects for update to authenticated using (
  bucket_id = 'company-assets' and public.can_manage(((storage.foldername(name))[1])::uuid)
);
create policy assets_delete on storage.objects for delete to authenticated using (
  bucket_id = 'company-assets' and public.can_manage(((storage.foldername(name))[1])::uuid)
);

-- >>>>>>>>>> 20261016000004_demo.sql
-- =====================================================================
-- SMART INVOICE — 4/4 : entreprise de démonstration
-- Crée une entreprise marquée is_demo = true, avec numérotation « DEMO-… ».
-- Ces données sont affichées avec le bandeau « DÉMONSTRATION » et un
-- filigrane « SANS VALEUR » sur les PDF. Elles ne sont jamais mélangées
-- aux entreprises réelles et peuvent être supprimées à tout moment.
-- =====================================================================

create or replace function public.create_demo_company()
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_company uuid;
  v_cat uuid;
  v_c1 uuid; v_c2 uuid;
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid;
  v_inv uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;

  v_company := gen_random_uuid();
  insert into companies (id, legal_name, ice, if_number, rc, tp, address, city, is_demo, legal_mentions)
  values (v_company, 'SOCIÉTÉ DÉMO SARL (fictive)', '000000000000000', '00000000', 'RC DEMO', 'TP DEMO',
          '1, rue de l''Exemple', 'Casablanca', true,
          'Document de démonstration — données fictives sans valeur comptable ni fiscale.');

  insert into product_categories (company_id, name) values (v_company, 'Alimentation') returning id into v_cat;

  insert into products (company_id, reference, designation, category_id, unit, unit_price_ttc, vat_rate_bp) values
    (v_company, 'DEMO-HUILE-5L', 'Huile de table 5 L (démo)', v_cat, 'U', 9500, 1000) returning id into v_p1;
  insert into products (company_id, reference, designation, category_id, unit, unit_price_ttc, vat_rate_bp) values
    (v_company, 'DEMO-THE-200G', 'Thé vert 200 g (démo)', v_cat, 'U', 2400, 2000) returning id into v_p2;
  insert into products (company_id, reference, designation, category_id, unit, unit_price_ttc, vat_rate_bp) values
    (v_company, 'DEMO-CAFE-1KG', 'Café moulu 1 kg (démo)', v_cat, 'KG', 11400, 1400) returning id into v_p3;
  insert into products (company_id, reference, designation, category_id, unit, unit_price_ttc, vat_rate_bp) values
    (v_company, 'DEMO-PAIN', 'Pain (démo, exonéré)', v_cat, 'U', 120, 0) returning id into v_p4;

  insert into parties (company_id, kind, name, ice, address, city, payment_terms) values
    (v_company, 'client', 'CLIENT DÉMO A (fictif)', '000000000000001', 'Adresse fictive A', 'Rabat', '30 jours')
    returning id into v_c1;
  insert into parties (company_id, kind, name, ice, address, city, payment_terms) values
    (v_company, 'client', 'CLIENT DÉMO B (fictif)', '000000000000002', 'Adresse fictive B', 'Marrakech', 'À réception')
    returning id into v_c2;
  insert into parties (company_id, kind, name, ice, address, city) values
    (v_company, 'supplier', 'FOURNISSEUR DÉMO (fictif)', '000000000000003', 'Adresse fictive C', 'Tanger');

  insert into invoices (company_id, issue_date, client_id, goods_nature, order_ref)
  values (v_company, current_date - 20, v_c1, 'Produits alimentaires', 'DEMO-CMD-001') returning id into v_inv;
  insert into invoice_lines (invoice_id, company_id, position, product_id, designation, unit, quantity, unit_price_ttc, vat_rate_bp) values
    (v_inv, v_company, 1, v_p1, 'Huile de table 5 L (démo)', 'U', 12, 9500, 1000),
    (v_inv, v_company, 2, v_p2, 'Thé vert 200 g (démo)', 'U', 30, 2400, 2000),
    (v_inv, v_company, 3, v_p4, 'Pain (démo, exonéré)', 'U', 50, 120, 0);
  perform validate_invoice(v_inv);

  insert into invoices (company_id, issue_date, client_id, goods_nature, order_ref)
  values (v_company, current_date - 5, v_c2, 'Produits alimentaires', 'DEMO-CMD-002') returning id into v_inv;
  insert into invoice_lines (invoice_id, company_id, position, product_id, designation, unit, quantity, unit_price_ttc, vat_rate_bp) values
    (v_inv, v_company, 1, v_p3, 'Café moulu 1 kg (démo)', 'KG', 8, 11400, 1400),
    (v_inv, v_company, 2, v_p2, 'Thé vert 200 g (démo)', 'U', 10, 2400, 2000);
  perform validate_invoice(v_inv);

  insert into invoices (company_id, issue_date, client_id, goods_nature)
  values (v_company, current_date, v_c1, 'Produits alimentaires') returning id into v_inv;
  insert into invoice_lines (invoice_id, company_id, position, product_id, designation, unit, quantity, unit_price_ttc, vat_rate_bp) values
    (v_inv, v_company, 1, v_p1, 'Huile de table 5 L (démo)', 'U', 3, 9500, 1000);

  return v_company;
end $$;

-- Supprimer une entreprise de démonstration (et seulement de démonstration).
create or replace function public.delete_demo_company(p_company uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from companies where id = p_company and is_demo) then
    raise exception 'Seule une entreprise de démonstration peut être supprimée.';
  end if;
  if not has_role(p_company, array['admin']::member_role[]) then
    raise exception 'Seul un administrateur peut supprimer l''entreprise de démonstration.';
  end if;
  -- Les factures validées sont protégées contre la suppression ; pour la démo uniquement,
  -- on passe par le mode interne.
  perform set_config('smart_invoice.internal', 'on', true);
  delete from payments where company_id = p_company;
  delete from invoice_lines where company_id = p_company;
  delete from invoices where company_id = p_company;
  delete from companies where id = p_company;
  perform set_config('smart_invoice.internal', 'off', true);
end $$;

revoke all on function public.create_demo_company() from public, anon;
revoke all on function public.delete_demo_company(uuid) from public, anon;
grant execute on function public.create_demo_company() to authenticated;
grant execute on function public.delete_demo_company(uuid) to authenticated;

-- >>>>>>>>>> 20261016000005_save_draft.sql
-- =====================================================================
-- SMART INVOICE — 5 : enregistrement atomique d'un brouillon
-- En-tête + lignes enregistrés dans une seule transaction (RLS appliquée :
-- SECURITY INVOKER). Les contrôles de prix, remises et taux restent ceux des
-- déclencheurs de invoice_lines.
-- =====================================================================

create or replace function public.save_invoice_draft(p_invoice uuid, p_company uuid, p_header jsonb, p_lines jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid := p_invoice;
  v_line jsonb;
  v_pos integer := 0;
begin
  if jsonb_typeof(p_lines) <> 'array' then raise exception 'Lignes invalides.'; end if;

  if v_id is null then
    insert into invoices (company_id, series_id, issue_date, due_date, client_id, order_ref, payment_terms, goods_nature, notes, template_id)
    values (
      p_company,
      nullif(p_header ->> 'series_id', '')::uuid,
      coalesce(nullif(p_header ->> 'issue_date', '')::date, current_date),
      nullif(p_header ->> 'due_date', '')::date,
      nullif(p_header ->> 'client_id', '')::uuid,
      nullif(trim(p_header ->> 'order_ref'), ''),
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

revoke all on function public.save_invoice_draft(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_invoice_draft(uuid, uuid, jsonb, jsonb) to authenticated;

-- >>>>>>>>>> 20261016000006_series_guard.sql
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

-- >>>>>>>>>> 20261016000007_members_profiles.sql
-- =====================================================================
-- SMART INVOICE — 7 : lien membres → profils (pour afficher e-mail et nom)
-- =====================================================================
alter table public.company_members
  add constraint company_members_profile_fk foreign key (user_id) references public.profiles (id) on delete cascade;

-- >>>>>>>>>> 20261016000008_journal_tva.sql
-- =====================================================================
-- SMART INVOICE — 8 : module Journal TVA
--  * pdf_imports  : suivi des imports PDF (progression, reprise, doublons de fichier)
--  * vat_entries  : factures d'achat / de vente extraites ou saisies, à contrôler puis valider
--  * vat_journal  : vue unifiée = factures validées de Smart Invoice + écritures validées
--  * vat_declaration() : préparation (non officielle) des données de déclaration
-- Montants en centimes, taux en points de base.
-- =====================================================================

create type public.vat_entry_kind as enum ('sale', 'purchase');
create type public.vat_entry_status as enum ('to_review', 'validated', 'rejected');

-- Paramètres fiscaux par entreprise (à vérifier avec le comptable)
alter table public.companies
  add column vat_period text not null default 'mensuel' check (vat_period in ('mensuel', 'trimestriel')),
  add column vat_regime text not null default 'encaissement' check (vat_regime in ('encaissement', 'debit')),
  add column default_purchase_rubrique text,
  add column extraction_settings jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------
-- Imports PDF
-- ---------------------------------------------------------------------
create table public.pdf_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  file_name text not null,
  file_hash text not null,
  file_size bigint not null default 0,
  storage_path text,
  default_kind public.vat_entry_kind not null default 'purchase',
  page_count integer not null default 0,
  pages_done integer not null default 0,
  ocr_pages integer not null default 0,
  invoices_found integer not null default 0,
  needs_review integer not null default 0,
  error_count integer not null default 0,
  status text not null default 'processing' check (status in ('processing', 'done', 'error', 'cancelled')),
  error_message text,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (company_id, file_hash)
);
create index on public.pdf_imports (company_id, created_at desc);

-- ---------------------------------------------------------------------
-- Écritures du journal TVA
-- ---------------------------------------------------------------------
create table public.vat_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  kind public.vat_entry_kind not null,
  status public.vat_entry_status not null default 'to_review',
  source text not null default 'manual' check (source in ('import', 'manual')),
  import_id uuid references public.pdf_imports (id) on delete set null,
  source_file text,
  page_from integer,
  page_to integer,
  invoice_number text,
  invoice_date date,
  party_id uuid references public.parties (id) on delete set null,
  party_name text,
  party_ice text check (party_ice is null or party_ice ~ '^[0-9]{15}$'),
  party_if text,
  goods_nature text,
  total_ht bigint,
  total_vat bigint,
  total_ttc bigint,
  -- Autres montants inclus dans le TTC (droits de timbre…) : TTC = HT + TVA + autres
  other_amount bigint not null default 0,
  vat_rate_bp integer check (vat_rate_bp is null or vat_rate_bp between 0 and 10000),
  -- Ventilation : [{ "rate_bp": 2000, "ht": 100000, "vat": 20000, "ttc": 120000 }]
  rates jsonb not null default '[]'::jsonb,
  payment_mode text check (payment_mode is null or payment_mode in ('especes', 'cheque', 'prelevement', 'virement', 'effet', 'compensation', 'carte', 'autre')),
  payment_date date,
  -- Achats : nature de la déduction et éligibilité
  deduction_type text not null default 'charges' check (deduction_type in ('charges', 'immobilisations')),
  rubrique text,
  deductible boolean not null default true,
  -- Traçabilité de l'extraction
  confidence jsonb not null default '{}'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  checks jsonb not null default '[]'::jsonb,
  dedup_key text,
  notes text,
  archived boolean not null default false,
  archive_reason text,
  validated_at timestamptz,
  validated_by uuid references auth.users (id),
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.vat_entries (company_id, kind, status, invoice_date);
create index on public.vat_entries (import_id);
create unique index vat_entries_dedup on public.vat_entries (company_id, dedup_key)
  where dedup_key is not null and status <> 'rejected' and not archived;

create trigger t_vat_entries_touch before update on public.vat_entries for each row execute function public.touch_updated_at();

-- Clé de doublon calculée en base : même sens + même tiers (ICE, sinon nom) + même numéro
create or replace function public.vat_entry_before()
returns trigger language plpgsql as $$
declare
  v_party text;
  v_core text[] := array['kind','invoice_number','invoice_date','party_name','party_ice','party_if','total_ht','total_vat','total_ttc','other_amount','vat_rate_bp','rates','deductible','deduction_type'];
begin
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id;
    new.created_by := old.created_by;
    -- Une écriture validée ne change pas silencieusement : il faut la repasser « à contrôler ».
    if old.status = 'validated' and new.status = 'validated'
       and exists (select 1 from unnest(v_core) c where (to_jsonb(new) -> c) is distinct from (to_jsonb(old) -> c)) then
      raise exception 'Écriture validée : repassez-la « à contrôler » avant de la modifier.';
    end if;
    if new.status = 'validated' and old.status <> 'validated' and not public.can_manage(new.company_id) then
      raise exception 'Seuls un administrateur ou un comptable peuvent valider une écriture.';
    end if;
  end if;

  v_party := lower(regexp_replace(coalesce(new.party_ice, new.party_name, ''), '\W+', '', 'g'));
  new.dedup_key := case when new.invoice_number is null or v_party = '' then null
    else new.kind::text || '|' || v_party || '|' || upper(regexp_replace(new.invoice_number, '\W+', '', 'g')) end;

  if new.status = 'validated' then
    if new.invoice_number is null or new.invoice_date is null or new.party_name is null
       or new.total_ht is null or new.total_vat is null or new.total_ttc is null then
      raise exception 'Validation impossible : numéro, date, tiers, HT, TVA et TTC sont obligatoires.';
    end if;
    if abs(new.total_ht + new.total_vat + new.other_amount - new.total_ttc) > 2 then
      raise exception 'Validation impossible : HT + TVA (+ autres montants) ≠ TTC.';
    end if;
    if new.vat_rate_bp is null and jsonb_array_length(new.rates) = 0 then
      if new.total_vat = 0 then new.vat_rate_bp := 0;
      else raise exception 'Validation impossible : indiquez le taux de TVA (ou la ventilation par taux).';
      end if;
    end if;
    if jsonb_array_length(new.rates) > 0 and abs((select sum((x ->> 'vat')::bigint) from jsonb_array_elements(new.rates) x) - new.total_vat) > 2 then
      raise exception 'Validation impossible : la ventilation par taux ne correspond pas au total de TVA.';
    end if;
    if new.validated_at is null or (tg_op = 'UPDATE' and old.status <> 'validated') then
      new.validated_at := now();
      new.validated_by := auth.uid();
    end if;
  else
    new.validated_at := null;
    new.validated_by := null;
  end if;
  return new;
end $$;
create trigger t_vat_entry_before before insert or update on public.vat_entries
  for each row execute function public.vat_entry_before();

create trigger t_audit after insert or update or delete on public.vat_entries for each row execute function public.audit();
create trigger t_audit after insert or update or delete on public.pdf_imports for each row execute function public.audit();

-- ---------------------------------------------------------------------
-- Journal unifié : ventes de Smart Invoice + écritures (ventes et achats)
-- ---------------------------------------------------------------------
create or replace view public.vat_journal with (security_invoker = true) as
  select
    'invoice'::text as source, i.id, i.company_id, 'sale'::public.vat_entry_kind as kind,
    case when i.status = 'cancelled' then 'rejected' else 'validated' end::text as status,
    i.number as invoice_number, i.issue_date as invoice_date,
    i.client_snapshot ->> 'name' as party_name, i.client_snapshot ->> 'ice' as party_ice, i.client_snapshot ->> 'if_number' as party_if,
    i.goods_nature, i.total_ht, i.total_vat, i.total_ttc, 0::bigint as other_amount,
    (select case when count(*) = 1 then max((e ->> 'vat_rate_bp')::int) end from jsonb_array_elements(i.vat_breakdown) e) as vat_rate_bp,
    (select coalesce(jsonb_agg(jsonb_build_object('rate_bp', (e ->> 'vat_rate_bp')::int, 'ht', (e ->> 'base_ht')::bigint, 'vat', (e ->> 'vat')::bigint, 'ttc', (e ->> 'ttc')::bigint)), '[]'::jsonb)
       from jsonb_array_elements(i.vat_breakdown) e) as rates,
    (select p.method from public.payments p where p.invoice_id = i.id order by p.paid_at desc limit 1) as payment_mode,
    (select max(p.paid_at) from public.payments p where p.invoice_id = i.id) as payment_date,
    i.amount_paid,
    'charges'::text as deduction_type, null::text as rubrique, true as deductible,
    null::text as source_file, null::integer as page_from, null::integer as page_to, false as archived, null::uuid as import_id
  from public.invoices i
  where i.status <> 'draft' and not i.is_demo
union all
  select
    'entry', v.id, v.company_id, v.kind, v.status::text, v.invoice_number, v.invoice_date, v.party_name, v.party_ice, v.party_if,
    v.goods_nature, v.total_ht, v.total_vat, v.total_ttc, v.other_amount, v.vat_rate_bp, v.rates, v.payment_mode, v.payment_date,
    case when v.payment_date is not null then v.total_ttc else 0 end,
    v.deduction_type, v.rubrique, v.deductible, v.source_file, v.page_from, v.page_to, v.archived, v.import_id
  from public.vat_entries v;

-- ---------------------------------------------------------------------
-- Préparation de la déclaration (indicative, NON officielle)
-- Régime « débit » : date de facture. Régime « encaissement » : date de paiement
-- (Smart Invoice : au prorata de chaque paiement ; écritures : date de paiement saisie).
-- ---------------------------------------------------------------------
create or replace function public.vat_declaration(p_company uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare
  v_regime text;
  v_result jsonb;
begin
  select vat_regime into v_regime from companies where id = p_company;
  if v_regime is null then raise exception 'Entreprise introuvable.'; end if;

  with
  -- Lignes par taux, avec la quote-part rattachée à la période
  inv_rates as (
    select i.id, (e ->> 'vat_rate_bp')::int as rate_bp, (e ->> 'base_ht')::bigint as ht, (e ->> 'vat')::bigint as vat, i.total_ttc, i.issue_date
    from invoices i, jsonb_array_elements(i.vat_breakdown) e
    where i.company_id = p_company and i.status in ('validated', 'partially_paid', 'paid') and not i.is_demo
  ),
  inv_part as (
    select r.rate_bp,
      case when v_regime = 'debit' then case when r.issue_date between p_from and p_to then r.ht else 0 end
           else coalesce((select sum(round(r.ht::numeric * p.amount / nullif(r.total_ttc, 0))) from payments p where p.invoice_id = r.id and p.paid_at between p_from and p_to), 0) end as ht,
      case when v_regime = 'debit' then case when r.issue_date between p_from and p_to then r.vat else 0 end
           else coalesce((select sum(round(r.vat::numeric * p.amount / nullif(r.total_ttc, 0))) from payments p where p.invoice_id = r.id and p.paid_at between p_from and p_to), 0) end as vat
    from inv_rates r
  ),
  entries as (
    select v.*, case when jsonb_array_length(v.rates) > 0 then v.rates
                     else jsonb_build_array(jsonb_build_object('rate_bp', coalesce(v.vat_rate_bp, -1), 'ht', v.total_ht, 'vat', v.total_vat)) end as r
    from vat_entries v
    where v.company_id = p_company and v.status = 'validated' and not v.archived
      and case when v_regime = 'debit' then v.invoice_date between p_from and p_to else v.payment_date between p_from and p_to end
  ),
  entry_rates as (
    select e.kind, e.deductible, e.deduction_type, (x ->> 'rate_bp')::int as rate_bp, (x ->> 'ht')::bigint as ht, (x ->> 'vat')::bigint as vat
    from entries e, jsonb_array_elements(e.r) x
  ),
  sales as (
    select rate_bp, sum(ht) ht, sum(vat) vat from (
      select rate_bp, ht, vat from inv_part
      union all select rate_bp, ht, vat from entry_rates where kind = 'sale'
    ) s group by rate_bp
  ),
  purchases as (
    select deduction_type, rate_bp, sum(ht) ht, sum(vat) vat
    from entry_rates where kind = 'purchase' and deductible group by deduction_type, rate_bp
  ),
  non_deductible as (
    select coalesce(sum(vat), 0) vat, coalesce(sum(ht), 0) ht from entry_rates where kind = 'purchase' and not deductible
  ),
  pending as (
    select
      (select count(*) from vat_entries where company_id = p_company and status = 'to_review' and not archived
         and coalesce(invoice_date, p_from) between p_from and p_to) as to_review,
      (select count(*) from vat_entries where company_id = p_company and status = 'validated' and not archived and v_regime = 'encaissement'
         and payment_date is null and invoice_date <= p_to) as unpaid_entries
  )
  select jsonb_build_object(
    'regime', v_regime, 'from', p_from, 'to', p_to,
    'sales', coalesce((select jsonb_agg(jsonb_build_object('rate_bp', rate_bp, 'ht', ht, 'vat', vat) order by rate_bp desc) from sales where ht <> 0 or vat <> 0), '[]'::jsonb),
    'purchases', coalesce((select jsonb_agg(jsonb_build_object('deduction_type', deduction_type, 'rate_bp', rate_bp, 'ht', ht, 'vat', vat) order by deduction_type, rate_bp desc) from purchases), '[]'::jsonb),
    'sales_ht', coalesce((select sum(ht) from sales), 0),
    'vat_collected', coalesce((select sum(vat) from sales), 0),
    'purchases_ht', coalesce((select sum(ht) from purchases), 0),
    'vat_deductible', coalesce((select sum(vat) from purchases), 0),
    'vat_non_deductible', (select vat from non_deductible),
    'net_vat', coalesce((select sum(vat) from sales), 0) - coalesce((select sum(vat) from purchases), 0),
    'to_review', (select to_review from pending),
    'unpaid_entries', (select unpaid_entries from pending)
  ) into v_result;
  return v_result;
end $$;

-- ---------------------------------------------------------------------
-- Sécurité
-- ---------------------------------------------------------------------
alter table public.pdf_imports enable row level security;
alter table public.vat_entries enable row level security;

create policy imports_select on public.pdf_imports for select to authenticated using (public.is_member(company_id));
create policy imports_insert on public.pdf_imports for insert to authenticated with check (public.is_member(company_id));
create policy imports_update on public.pdf_imports for update to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));
create policy imports_delete on public.pdf_imports for delete to authenticated using (public.can_manage(company_id));

create policy entries_select on public.vat_entries for select to authenticated using (public.is_member(company_id));
create policy entries_insert on public.vat_entries for insert to authenticated with check ((public.is_member(company_id) and status <> 'validated') or public.can_manage(company_id));
create policy entries_update on public.vat_entries for update to authenticated using (public.is_member(company_id)) with check (public.is_member(company_id));
create policy entries_delete on public.vat_entries for delete to authenticated using (public.can_manage(company_id) and status <> 'validated');

-- Les PDF importés sont stockés dans {entreprise}/imports/ : tout membre peut y déposer.
drop policy if exists assets_insert on storage.objects;
create policy assets_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'company-assets' and (
    public.can_manage(((storage.foldername(name))[1])::uuid)
    or ((storage.foldername(name))[2] = 'imports' and public.is_member(((storage.foldername(name))[1])::uuid))
  )
);

revoke all on function public.vat_declaration(uuid, date, date) from public, anon;
grant execute on function public.vat_declaration(uuid, date, date) to authenticated;
grant select on public.vat_journal to authenticated;

-- Tableau de bord : achats et TVA (complète dashboard_stats)
create or replace function public.vat_dashboard(p_company uuid, p_from date, p_to date)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'purchases_ht', coalesce((select sum(total_ht) from vat_entries where company_id = p_company and kind = 'purchase' and status = 'validated' and not archived and invoice_date between p_from and p_to), 0),
    'purchases_ttc', coalesce((select sum(total_ttc) from vat_entries where company_id = p_company and kind = 'purchase' and status = 'validated' and not archived and invoice_date between p_from and p_to), 0),
    'vat_deductible', coalesce((select sum(total_vat) from vat_entries where company_id = p_company and kind = 'purchase' and status = 'validated' and deductible and not archived and invoice_date between p_from and p_to), 0),
    'imported_sales_vat', coalesce((select sum(total_vat) from vat_entries where company_id = p_company and kind = 'sale' and status = 'validated' and not archived and invoice_date between p_from and p_to), 0),
    'to_review', (select count(*) from vat_entries where company_id = p_company and status = 'to_review' and not archived),
    'with_issues', (select count(*) from vat_entries where company_id = p_company and status = 'to_review' and not archived and jsonb_array_length(issues) > 0),
    'imports', coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select id, file_name, page_count, pages_done, invoices_found, needs_review, status, created_at from pdf_imports
        where company_id = p_company order by created_at desc limit 5) x), '[]'::jsonb)
  );
$$;
revoke all on function public.vat_dashboard(uuid, date, date) from public, anon;
grant execute on function public.vat_dashboard(uuid, date, date) to authenticated;

-- >>>>>>>>>> 20261016000009_bon_livraison.sql
-- =====================================================================
-- SMART INVOICE — 9 : N° de bon de livraison sur les factures
-- =====================================================================
alter table public.invoices add column delivery_note_ref text;
create index on public.invoices (company_id, delivery_note_ref) where delivery_note_ref is not null;

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


-- >>>>>>>>>> 20261016000010_bons.sql
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

-- >>>>>>>>>> 20261016000011_partage_entreprises.sql
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

-- >>>>>>>>>> 20261016000012_mode_paiement.sql
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


-- >>>>>>>>>> 20261016000013_numerotation_client.sql
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

-- >>>>>>>>>> Comptes existants : création de leur profil
insert into public.profiles (id, email)
select id, coalesce(email, '') from auth.users
on conflict (id) do nothing;

select 'Smart Invoice : installation terminée avec succès' as resultat;
