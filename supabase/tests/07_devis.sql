\set ON_ERROR_STOP 1
\set QUIET 1
set role authenticated;
select t.as_user('33333333-3333-3333-3333-333333333333');
select set_config('t.a', (select id::text from companies where legal_name = 'ALPHA SARL'), false);
select set_config('t.q', save_quote(null, current_setting('t.a')::uuid,
  jsonb_build_object('issue_date', '2027-07-01', 'valid_until', '2027-07-31', 'client_id', (select id from parties where name = 'CLIENT UN'), 'payment_method', 'cheque'),
  jsonb_build_array(
    jsonb_build_object('product_id', (select id from products where reference = 'P20'), 'designation', 'Produit 20 %', 'quantity', 2, 'unit_price_ttc', (select unit_price_ttc from products where reference = 'P20'), 'vat_rate_bp', 2000),
    jsonb_build_object('designation', 'Service', 'quantity', 1.5, 'unit_price_ttc', 1000, 'vat_rate_bp', 1400)))::text, false);
select t.ok((select number from quotes where id = current_setting('t.q')::uuid) = 'DV0001/2027', 'devis numéroté DV0001/2027');
select t.ok((select total_ttc from quotes where id = current_setting('t.q')::uuid) = 2 * (select unit_price_ttc from products where reference = 'P20') + 1500, 'total calculé côté serveur');
select t.ok((select jsonb_array_length(vat_breakdown) from quotes where id = current_setting('t.q')::uuid) = 2, 'ventilation par taux');
select t.fails($$update quotes set total_ttc = 1 where id = current_setting('t.q')::uuid$$, 'éditeur', 'totaux non modifiables directement');
update quotes set status = 'sent' where id = current_setting('t.q')::uuid;
select t.ok((select status from quotes where id = current_setting('t.q')::uuid) = 'sent', 'statut envoyé');
select t.fails($$update quotes set status = 'invoiced' where id = current_setting('t.q')::uuid$$, 'Transformer', 'statut transformé interdit en direct');
select t.fails($$select save_quote(null, current_setting('t.a')::uuid, '{}'::jsonb, '[]'::jsonb)$$, 'au moins une ligne', 'devis vide refusé');
-- Transformation
select set_config('t.i', convert_quote_to_invoice(current_setting('t.q')::uuid)::text, false);
select t.ok((select status from invoices where id = current_setting('t.i')::uuid) = 'draft', 'facture brouillon créée');
select t.ok((select total_ttc from invoices where id = current_setting('t.i')::uuid) = (select total_ttc from quotes where id = current_setting('t.q')::uuid), 'mêmes montants que le devis');
select t.ok((select payment_method from invoices where id = current_setting('t.i')::uuid) = 'cheque', 'mode de paiement repris');
select t.ok((select status from quotes where id = current_setting('t.q')::uuid) = 'invoiced', 'devis marqué transformé');
select t.ok(convert_quote_to_invoice(current_setting('t.q')::uuid) = current_setting('t.i')::uuid, 'pas de double facture');
select t.fails($$select save_quote(current_setting('t.q')::uuid, current_setting('t.a')::uuid, '{}'::jsonb, '[{"designation":"x","quantity":1,"unit_price_ttc":1,"vat_rate_bp":2000}]'::jsonb)$$, 'transformé', 'devis transformé non modifiable');
delete from quotes where id = current_setting('t.q')::uuid;
select t.ok((select count(*) from quotes where id = current_setting('t.q')::uuid) = 1, 'devis transformé non supprimable');
-- Deuxième devis : numéro suivant ; autre entreprise : invisible
select set_config('t.q2', save_quote(null, current_setting('t.a')::uuid, '{"issue_date":"2027-08-01"}'::jsonb, '[{"designation":"x","quantity":1,"unit_price_ttc":100,"vat_rate_bp":2000}]'::jsonb)::text, false);
select t.ok((select number from quotes where id = current_setting('t.q2')::uuid) = 'DV0002/2027', 'numéro suivant DV0002/2027');
select t.as_user('44444444-4444-4444-4444-444444444444');
select t.ok((select count(*) from quotes where company_id = current_setting('t.a')::uuid) = 0, 'devis invisibles hors entreprise');
select t.fails($$select convert_quote_to_invoice(current_setting('t.q2')::uuid)$$, 'introuvable', 'transformation refusée hors entreprise');
reset role;
\echo 'DEVIS : OK'
