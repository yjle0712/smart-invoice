\set ON_ERROR_STOP 1
\set QUIET 1
set role authenticated;
select t.as_user('11111111-1111-1111-1111-111111111111');
select set_config('t.a', (select id::text from companies where legal_name = 'ALPHA SARL'), false);
select set_config('t.f', save_invoice_draft(null, current_setting('t.a')::uuid,
  jsonb_build_object('issue_date', '2027-09-01', 'client_id', (select id from parties where name = 'CLIENT UN' and company_id = current_setting('t.a')::uuid), 'delivery_note_ref', 'BL-210-26'),
  '[{"designation":"x","quantity":1,"unit_price_ttc":100,"vat_rate_bp":2000}]'::jsonb)::text, false);
select set_config('t.bl', create_note_from_invoice(current_setting('t.f')::uuid, 'BL')::text, false);
select t.ok((select number from delivery_notes where id = current_setting('t.bl')::uuid) = 'BL-210-26', 'BL prend le n° saisi sur la facture');
select set_config('t.f2', save_invoice_draft(null, current_setting('t.a')::uuid,
  jsonb_build_object('issue_date', '2027-09-02', 'client_id', (select id from parties where name = 'CLIENT UN' and company_id = current_setting('t.a')::uuid), 'delivery_note_ref', 'BL-210-26'),
  '[{"designation":"x","quantity":1,"unit_price_ttc":100,"vat_rate_bp":2000}]'::jsonb)::text, false);
select t.fails($$select create_note_from_invoice(current_setting('t.f2')::uuid, 'BL')$$, 'existe déjà', 'doublon de n° BL refusé');
update delivery_notes set number = 'BL-211-26' where id = current_setting('t.bl')::uuid;
select t.ok((select number from delivery_notes where id = current_setting('t.bl')::uuid) = 'BL-211-26', 'n° du bon corrigeable');
select t.fails($$update delivery_notes set total_ttc = 1 where id = current_setting('t.bl')::uuid$$, 'modifiables', 'montants protégés');
reset role;
\echo 'BL MANUEL : OK'
