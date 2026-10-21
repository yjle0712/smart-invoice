-- =====================================================================
-- SMART INVOICE — 15 : n° de BL saisi à la main
-- Si la facture porte un n° de bon de livraison, le BL créé depuis la facture prend ce numéro.
-- Le numéro d'un bon (BL / BC) peut aussi être corrigé sur sa fiche (sans doublon).
-- Rejouable sans erreur.
-- =====================================================================
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

  -- N° saisi à la main (champ « N° Bon de livraison » de la facture) : il est repris tel quel.
  v_number := case when p_kind = 'BL' then nullif(trim(v_inv.delivery_note_ref), '') end;
  if v_number is not null then
    if exists (select 1 from delivery_notes where company_id = v_inv.company_id and kind = p_kind and number = v_number) then
      raise exception 'Le bon de livraison n° % existe déjà.', v_number;
    end if;
    v_seq := 0;
  else
    -- Numérotation automatique : verrou sur le compteur → pas de doublon même avec plusieurs utilisateurs.
    v_year := extract(year from v_inv.issue_date)::integer;
    insert into delivery_note_counters (company_id, kind, year, last_seq) values (v_inv.company_id, p_kind, v_year, 1)
    on conflict (company_id, kind, year) do update set last_seq = delivery_note_counters.last_seq + 1
    returning last_seq into v_seq;
    v_number := p_kind || lpad(v_seq::text, 4, '0') || '/' || v_year::text;
  end if;

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


-- Le numéro d'un bon peut être corrigé (document non fiscal) ; le reste reste protégé.
create or replace function public.guard_delivery_note()
returns trigger language plpgsql as $$
begin
  if current_user in ('postgres', 'supabase_admin') then return new; end if;
  new.number := trim(new.number);
  if length(new.number) = 0 then raise exception 'Le numéro du bon est obligatoire.'; end if;
  if (new.company_id, new.kind, new.seq, new.invoice_id, new.invoice_number, new.client_id,
      new.client_snapshot, new.total_ttc, new.total_ht, new.total_vat, new.vat_breakdown, new.is_demo, new.created_by, new.created_at)
     is distinct from
     (old.company_id, old.kind, old.seq, old.invoice_id, old.invoice_number, old.client_id,
      old.client_snapshot, old.total_ttc, old.total_ht, old.total_vat, old.vat_breakdown, old.is_demo, old.created_by, old.created_at) then
    raise exception 'Seuls le numéro, la date, les observations et l''affichage des prix d''un bon sont modifiables.';
  end if;
  return new;
end $$;
