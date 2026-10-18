\set ON_ERROR_STOP 1
\set QUIET 1
set role authenticated;
select t.as_user('11111111-1111-1111-1111-111111111111');
select set_config('t.a', (select id::text from companies where legal_name = 'ALPHA SARL'), false);
select set_config('t.p', save_invoice_draft(null, current_setting('t.a')::uuid, '{"payment_method":"cheque"}'::jsonb, '[]'::jsonb)::text, false);
select t.ok((select payment_method from invoices where id = current_setting('t.p')::uuid) = 'cheque', 'mode de paiement enregistré');
select save_invoice_draft(current_setting('t.p')::uuid, current_setting('t.a')::uuid, '{"payment_method":"especes"}'::jsonb, '[]'::jsonb);
select t.ok((select payment_method from invoices where id = current_setting('t.p')::uuid) = 'especes', 'mode de paiement modifié');
select t.fails($$select save_invoice_draft(null, current_setting('t.a')::uuid, '{"payment_method":"bitcoin"}'::jsonb, '[]'::jsonb)$$, 'payment_method', 'mode inconnu refusé');
insert into invoice_templates (company_id, name, base) values (current_setting('t.a')::uuid, 'Novastro', 'novastro'), (current_setting('t.a')::uuid, 'Fercim', 'fercim');
select t.ok((select count(*) from invoice_templates where base in ('novastro','fercim')) = 2, 'modèles FERCIM et NOVASTRO acceptés');
reset role;
\echo 'MODE DE PAIEMENT : OK'
