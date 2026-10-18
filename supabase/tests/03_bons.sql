-- Scénarios des bons de livraison / commande (après 01_scenarios.sql)
\set ON_ERROR_STOP 1
\set QUIET 1
set role authenticated;
select t.as_user('33333333-3333-3333-3333-333333333333');
select set_config('t.a', (select id::text from companies where legal_name = 'ALPHA SARL'), false);
select set_config('t.f', save_invoice_draft(null, current_setting('t.a')::uuid,
  jsonb_build_object('issue_date', '2027-05-04', 'client_id', (select id from parties where name = 'CLIENT UN'), 'order_ref', 'CMD-BL-1'),
  jsonb_build_array(
    jsonb_build_object('designation', 'Article A', 'quantity', 3, 'unit_price_ttc', 12000, 'vat_rate_bp', 2000),
    jsonb_build_object('designation', 'Article B', 'quantity', 1.5, 'unit_price_ttc', 1000, 'vat_rate_bp', 1400)))::text, false);

-- BL créé par un simple utilisateur
select set_config('t.bl', create_note_from_invoice(current_setting('t.f')::uuid, 'BL')::text, false);
select t.ok((select number from delivery_notes where id = current_setting('t.bl')::uuid) = 'BL0001/2027', 'numéro BL0001/2027');
select t.ok((select count(*) from delivery_note_lines where note_id = current_setting('t.bl')::uuid) = 2, 'lignes copiées');
select t.ok((select show_prices from delivery_notes where id = current_setting('t.bl')::uuid) = false, 'BL sans prix par défaut');
select t.ok((select client_snapshot ->> 'name' from delivery_notes where id = current_setting('t.bl')::uuid) = 'CLIENT UN', 'client repris');
select t.ok((select delivery_note_ref from invoices where id = current_setting('t.f')::uuid) = 'BL0001/2027', 'n° de BL reporté sur la facture brouillon');
select t.ok(create_note_from_invoice(current_setting('t.f')::uuid, 'BL') = current_setting('t.bl')::uuid, 'pas de doublon : même BL renvoyé');

-- BC : numérotation séparée, prix affichés
select set_config('t.bc', create_note_from_invoice(current_setting('t.f')::uuid, 'BC')::text, false);
select t.ok((select number || '|' || show_prices from delivery_notes where id = current_setting('t.bc')::uuid) = 'BC0001/2027|true', 'BC0001/2027 avec prix');
select t.ok((select total_ttc from delivery_notes where id = current_setting('t.bc')::uuid) = (select total_ttc from invoices where id = current_setting('t.f')::uuid), 'total repris');

-- Modifications limitées
update delivery_notes set notes = 'Livré au dépôt', show_prices = true where id = current_setting('t.bl')::uuid;
select t.ok((select notes from delivery_notes where id = current_setting('t.bl')::uuid) = 'Livré au dépôt', 'observations modifiables');
select t.fails($$update delivery_notes set number = 'BL9999/2027' where id = current_setting('t.bl')::uuid$$, 'modifiables', 'numéro non modifiable');
select t.fails($$insert into delivery_notes (company_id, kind, number, seq) values (current_setting('t.a')::uuid, 'BL', 'BLX', 1)$$, 'row-level security', 'création directe interdite');

-- Suppression : utilisateur non, administrateur oui
delete from delivery_notes where id = current_setting('t.bc')::uuid;
select t.ok((select count(*) from delivery_notes where id = current_setting('t.bc')::uuid) = 1, 'utilisateur ne supprime pas');

-- Autre entreprise : invisible et interdit
select t.as_user('44444444-4444-4444-4444-444444444444');
select t.ok((select count(*) from delivery_notes) = 0, 'bons invisibles pour une autre entreprise');
select t.fails($$select create_note_from_invoice(current_setting('t.f')::uuid, 'BL')$$, 'introuvable', 'création refusée hors entreprise');

select t.as_user('11111111-1111-1111-1111-111111111111');
delete from delivery_notes where id = current_setting('t.bc')::uuid;
select t.ok((select count(*) from delivery_notes where id = current_setting('t.bc')::uuid) = 0, 'administrateur supprime');
select t.ok((select count(*) from audit_log where table_name = 'delivery_notes') >= 3, 'journalisé');

-- Facture sans client / sans lignes
select set_config('t.vide', save_invoice_draft(null, current_setting('t.a')::uuid, '{}'::jsonb, '[]'::jsonb)::text, false);
select t.fails($$select create_note_from_invoice(current_setting('t.vide')::uuid, 'BL')$$, 'client', 'facture sans client refusée');

-- Facture validée : BL créé, la facture ne change pas
select validate_invoice(current_setting('t.f')::uuid);
select set_config('t.bc2', create_note_from_invoice(current_setting('t.f')::uuid, 'BC')::text, false);
select t.ok((select number || '|' || coalesce(invoice_number, '') from delivery_notes where id = current_setting('t.bc2')::uuid) like 'BC0002/2027|%', 'BC suivant après validation (BC0002)');

reset role;
\echo 'SCÉNARIOS BONS : OK'
