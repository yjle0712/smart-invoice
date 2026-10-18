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
