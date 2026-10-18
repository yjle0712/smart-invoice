-- Scénarios du module Journal TVA (à exécuter après 01_scenarios.sql)
\set ON_ERROR_STOP 1
\set QUIET 1
set role authenticated;
select t.as_user('11111111-1111-1111-1111-111111111111');
select set_config('t.a', (select id::text from companies where legal_name = 'ALPHA SARL'), false);
update companies set vat_regime = 'debit' where id = current_setting('t.a')::uuid;

-- Import
insert into pdf_imports (company_id, file_name, file_hash, page_count) values (current_setting('t.a')::uuid, 'achats.pdf', 'abc123', 3);
select t.fails($$insert into pdf_imports (company_id, file_name, file_hash) values (current_setting('t.a')::uuid, 'copie.pdf', 'abc123')$$, 'duplicate key', 'même fichier importé deux fois refusé');

-- Écriture d'achat à contrôler (utilisateur simple)
select t.as_user('33333333-3333-3333-3333-333333333333');
insert into vat_entries (company_id, kind, source, invoice_number, invoice_date, party_name, party_ice, total_ht, total_vat, total_ttc, vat_rate_bp, source_file, page_from, page_to)
values (current_setting('t.a')::uuid, 'purchase', 'import', 'F-2026/0458', '2026-03-12', 'MINOTERIE DU SUD SARL', '000999888000077', 1000000, 200000, 1200000, 2000, 'achats.pdf', 1, 1);
select t.ok((select dedup_key from vat_entries where invoice_number = 'F-2026/0458') = 'purchase|000999888000077|F20260458', 'clé de doublon');
select t.fails($$insert into vat_entries (company_id, kind, invoice_number, party_ice, party_name) values (current_setting('t.a')::uuid, 'purchase', 'F 2026-0458', '000999888000077', 'X')$$, 'duplicate key', 'doublon refusé (numéro normalisé)');
select t.fails($$update vat_entries set status = 'validated' where invoice_number = 'F-2026/0458'$$, 'administrateur ou un comptable', 'utilisateur ne valide pas');

-- Validation par le comptable
select t.as_user('22222222-2222-2222-2222-222222222222');
update vat_entries set status = 'validated', payment_mode = 'virement', payment_date = '2026-03-20' where invoice_number = 'F-2026/0458';
select t.ok((select status from vat_entries where invoice_number = 'F-2026/0458') = 'validated', 'écriture validée');
select t.fails($$update vat_entries set total_ht = 1 where invoice_number = 'F-2026/0458'$$, 'repassez', 'écriture validée non modifiable directement');
update vat_entries set payment_mode = 'cheque' where invoice_number = 'F-2026/0458';
select t.ok((select payment_mode from vat_entries where invoice_number = 'F-2026/0458') = 'cheque', 'mode de paiement modifiable');
delete from vat_entries where invoice_number = 'F-2026/0458';
select t.ok((select count(*) from vat_entries where invoice_number = 'F-2026/0458') = 1, 'écriture validée non supprimable (archivage)');

-- Validation incomplète refusée ; totaux incohérents refusés ; timbre accepté
insert into vat_entries (company_id, kind, invoice_number, invoice_date, party_name, total_ht, total_vat, total_ttc)
values (current_setting('t.a')::uuid, 'purchase', 'X-1', '2026-03-15', 'FOURNISSEUR X', 200000, 28000, 238000);
select t.fails($$update vat_entries set status = 'validated' where invoice_number = 'X-1'$$, 'HT + TVA', 'totaux incohérents refusés');
select t.fails($$update vat_entries set other_amount = 10000, status = 'validated' where invoice_number = 'X-1'$$, 'taux de TVA', 'taux obligatoire pour valider');
update vat_entries set other_amount = 10000, vat_rate_bp = 1400, status = 'validated' where invoice_number = 'X-1';
select t.ok((select status from vat_entries where invoice_number = 'X-1') = 'validated', 'droit de timbre pris en compte');
insert into vat_entries (company_id, kind, invoice_number, party_name) values (current_setting('t.a')::uuid, 'purchase', 'X-2', 'Y');
select t.fails($$update vat_entries set status = 'validated' where invoice_number = 'X-2'$$, 'obligatoires', 'champs obligatoires pour valider');
-- Achat non déductible
insert into vat_entries (company_id, kind, invoice_number, invoice_date, party_name, total_ht, total_vat, total_ttc, vat_rate_bp, deductible, status)
values (current_setting('t.a')::uuid, 'purchase', 'ND-1', '2026-03-16', 'RESTAURANT', 50000, 5000, 55000, 1000, false, 'validated');
-- Achat d'immobilisation à deux taux
insert into vat_entries (company_id, kind, invoice_number, invoice_date, party_name, total_ht, total_vat, total_ttc, deduction_type, status, rates)
values (current_setting('t.a')::uuid, 'purchase', 'IM-1', '2026-03-17', 'EQUIPEMENTS SA', 300000, 54000, 354000, 'immobilisations', 'validated',
        '[{"rate_bp":2000,"ht":200000,"vat":40000,"ttc":240000},{"rate_bp":1400,"ht":100000,"vat":14000,"ttc":114000}]');

-- Isolation
select t.as_user('44444444-4444-4444-4444-444444444444');
select t.ok((select count(*) from vat_entries) = 0, 'B ne voit pas le journal de A');
select t.ok((select count(*) from vat_journal) = 0, 'B ne voit pas la vue journal de A');
select t.ok((select count(*) from pdf_imports) = 0, 'B ne voit pas les imports de A');

-- Déclaration (régime des débits, mars 2026)
select t.as_user('22222222-2222-2222-2222-222222222222');
select set_config('t.d', vat_declaration(current_setting('t.a')::uuid, '2026-03-01', '2026-03-31')::text, false);
select t.ok((current_setting('t.d')::jsonb ->> 'vat_deductible')::bigint = 200000 + 28000 + 54000, 'TVA déductible = achats déductibles validés');
select t.ok((current_setting('t.d')::jsonb ->> 'vat_non_deductible')::bigint = 5000, 'TVA non déductible isolée');
select t.ok((current_setting('t.d')::jsonb ->> 'vat_collected')::bigint
            = (select coalesce(sum(total_vat), 0) from invoices where company_id = current_setting('t.a')::uuid and status in ('validated','partially_paid','paid') and issue_date between '2026-03-01' and '2026-03-31'),
            'TVA collectée = factures de vente validées de la période');
select t.ok((current_setting('t.d')::jsonb ->> 'net_vat')::bigint = (current_setting('t.d')::jsonb ->> 'vat_collected')::bigint - 282000, 'TVA nette = collectée − déductible');
select t.ok(jsonb_array_length(current_setting('t.d')::jsonb -> 'purchases') = 4, 'ventilation par nature et par taux');
select t.ok((select count(*) from vat_journal where kind = 'sale' and invoice_number = 'FA0001/2026') = 1, 'ventes de Smart Invoice dans le journal');

-- Régime de l'encaissement : seules les sommes payées comptent
select t.as_user('11111111-1111-1111-1111-111111111111');
update companies set vat_regime = 'encaissement' where id = current_setting('t.a')::uuid;
select t.as_user('22222222-2222-2222-2222-222222222222');
select set_config('t.e', vat_declaration(current_setting('t.a')::uuid, '2026-03-01', '2026-03-31')::text, false);
select t.ok((current_setting('t.e')::jsonb ->> 'vat_deductible')::bigint = 200000, 'encaissement : seul l''achat payé en mars est déductible');
select t.ok((current_setting('t.e')::jsonb ->> 'unpaid_entries')::int = 3, 'encaissement : écritures sans date de paiement signalées');
-- Paiements de mars sur FA0001/2026 : 300,00 puis le solde ; arrondi par taux (écart toléré : 1 centime par taux)
select t.ok(abs((current_setting('t.e')::jsonb ->> 'vat_collected')::bigint
            - (select sum(i.total_vat::numeric * p.amount / i.total_ttc) from payments p join invoices i on i.id = p.invoice_id where i.company_id = current_setting('t.a')::uuid and p.paid_at between '2026-03-01' and '2026-03-31')) <= 3,
            'encaissement : TVA collectée au prorata des paiements');

-- Tableau de bord
select t.ok((vat_dashboard(current_setting('t.a')::uuid, '2026-01-01', '2026-12-31') ->> 'vat_deductible')::bigint = 282000, 'dashboard : TVA déductible');

reset role;
\echo 'JOURNAL TVA : TOUS LES SCÉNARIOS SONT PASSÉS'
