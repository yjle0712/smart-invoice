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
