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
