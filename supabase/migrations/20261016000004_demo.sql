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
