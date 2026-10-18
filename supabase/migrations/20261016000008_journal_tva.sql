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
