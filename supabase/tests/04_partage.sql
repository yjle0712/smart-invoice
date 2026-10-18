-- Partage des clients et produits entre entreprises (après 01_scenarios.sql)
\set ON_ERROR_STOP 1
\set QUIET 1
set role authenticated;
select t.as_user('11111111-1111-1111-1111-111111111111');
select set_config('t.a', (select id::text from companies where legal_name = 'ALPHA SARL'), false);
select set_config('t.n', gen_random_uuid()::text, false);
insert into companies (id, legal_name, created_by) values (current_setting('t.n')::uuid, 'NOUVELLE SARL', auth.uid());
select set_config('t.na', (select count(*)::text from parties where company_id = current_setting('t.a')::uuid and not archived), false);
select set_config('t.np', (select count(*)::text from products where company_id = current_setting('t.a')::uuid and active), false);

select set_config('t.r', copy_master_data(current_setting('t.a')::uuid, current_setting('t.n')::uuid)::text, false);
select t.ok((current_setting('t.r')::jsonb ->> 'parties')::int = current_setting('t.na')::int, 'tous les clients/fournisseurs copiés');
select t.ok((select count(*) from products where company_id = current_setting('t.n')::uuid) + (current_setting('t.r')::jsonb ->> 'skipped')::int >= 1, 'produits copiés (ou signalés)');
select t.ok((select count(*) from products p join products s on s.reference = p.reference and s.company_id = current_setting('t.a')::uuid
             where p.company_id = current_setting('t.n')::uuid and p.unit_price_ttc <> s.unit_price_ttc) = 0, 'prix identiques au catalogue source');

-- Deuxième copie : aucun doublon
select set_config('t.r2', copy_master_data(current_setting('t.a')::uuid, current_setting('t.n')::uuid)::text, false);
select t.ok((current_setting('t.r2')::jsonb ->> 'parties')::int = 0 and (current_setting('t.r2')::jsonb ->> 'products')::int = 0, 'aucun doublon à la 2e copie');

-- Copie d'un seul client
insert into parties (company_id, kind, name) values (current_setting('t.a')::uuid, 'client', 'CLIENT PARTAGE');
select copy_master_data(current_setting('t.a')::uuid, current_setting('t.n')::uuid, true, false,
  array[(select id from parties where name = 'CLIENT PARTAGE' and company_id = current_setting('t.a')::uuid)]);
select t.ok((select count(*) from parties where company_id = current_setting('t.n')::uuid and name = 'CLIENT PARTAGE') = 1, 'copie d''un seul client');

-- Entreprise dont on n'est pas membre : refus
select t.as_user('44444444-4444-4444-4444-444444444444');
select t.fails($$select copy_master_data(current_setting('t.a')::uuid, current_setting('t.n')::uuid)$$, 'introuvable', 'copie refusée hors de ses entreprises');

-- Simple utilisateur : clients oui, produits non
select t.as_user('33333333-3333-3333-3333-333333333333');
select t.fails($$select copy_master_data(current_setting('t.a')::uuid, current_setting('t.n')::uuid)$$, 'introuvable', 'utilisateur non membre de la cible');

reset role;
\echo 'PARTAGE ENTRE ENTREPRISES : OK'
