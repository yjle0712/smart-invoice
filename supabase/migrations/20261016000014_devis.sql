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
