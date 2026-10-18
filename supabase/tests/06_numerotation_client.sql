\set ON_ERROR_STOP 1
\set QUIET 1
set role authenticated;
select t.as_user('11111111-1111-1111-1111-111111111111');
select set_config('t.a', (select id::text from companies where legal_name = 'ALPHA SARL'), false);
insert into number_series (company_id, name, format, next_seq, reset_yearly) values (current_setting('t.a')::uuid, 'Client MATA', 'MATA{SEQ:4}/{YYYY}', 13, false);
insert into parties (company_id, kind, name, ice, default_series_id) values (current_setting('t.a')::uuid, 'client', 'MATA MATERIAUX', '002861686000022',
  (select id from number_series where name = 'Client MATA'));
select set_config('t.f', save_invoice_draft(null, current_setting('t.a')::uuid,
  jsonb_build_object('issue_date', '2027-06-01', 'client_id', (select id from parties where name = 'MATA MATERIAUX'), 'series_id', (select id from number_series where name = 'Client MATA')),
  jsonb_build_array(jsonb_build_object('designation', 'Ciment', 'quantity', 1, 'unit_price_ttc', 12000, 'vat_rate_bp', 2000)))::text, false);
select t.ok(validate_invoice(current_setting('t.f')::uuid) = 'MATA0013/2027', 'numéro propre au client : MATA0013/2027');
select t.ok((select next_seq from number_series where name = 'Client MATA') = 14, 'série du client avance de 1');
-- Série d'une autre entreprise refusée
select t.as_user('44444444-4444-4444-4444-444444444444');
select set_config('t.b', (select company_id::text from company_members where user_id = auth.uid() limit 1), false);
insert into number_series (company_id, name, format) values (current_setting('t.b')::uuid, 'Autre', 'X{SEQ:3}');
select set_config('t.s', (select id::text from number_series where name = 'Autre'), false);
select t.as_user('11111111-1111-1111-1111-111111111111');
select t.fails($$update parties set default_series_id = current_setting('t.s')::uuid where name = 'MATA MATERIAUX'$$, 'introuvable', 'série d''une autre entreprise refusée');
reset role;
\echo 'NUMÉROTATION PAR CLIENT : OK'
