-- Scénarios de vérification des règles métier et de la sécurité.
-- Exécution : voir supabase/tests/run-local.sh
\set ON_ERROR_STOP 1
\set QUIET 1

create schema if not exists t;
grant usage on schema t to authenticated;

create or replace function t.ok(cond boolean, label text) returns void language plpgsql as $$
begin
  if cond is distinct from true then raise exception 'ÉCHEC : %', label; end if;
  raise notice 'OK  %', label;
end $$;

create or replace function t.fails(sql text, fragment text, label text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(lower(fragment) in lower(sqlerrm)) > 0 then
      raise notice 'OK  % (refusé : %)', label, sqlerrm;
      return;
    end if;
    raise exception 'ÉCHEC : % — message inattendu : %', label, sqlerrm;
  end;
  raise exception 'ÉCHEC : % — aurait dû être refusé', label;
end $$;

create or replace function t.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p::text, false);
$$;
grant execute on all functions in schema t to authenticated;

-- Utilisateurs
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'admin@a.ma'),
  ('22222222-2222-2222-2222-222222222222', 'compta@a.ma'),
  ('33333333-3333-3333-3333-333333333333', 'user@a.ma'),
  ('44444444-4444-4444-4444-444444444444', 'admin@b.ma');

select t.ok((select count(*) from profiles) = 4, 'profils créés automatiquement');

set role authenticated;

-- ===== Entreprise A =====
select t.as_user('11111111-1111-1111-1111-111111111111');
insert into companies (legal_name, ice, city) values ('ALPHA SARL', '001122334000055', 'Casablanca');
select t.ok((select role from company_members where user_id = auth.uid()) = 'admin', 'créateur = administrateur');
select t.ok((select format from number_series where is_default) = 'FA{SEQ:4}/{YYYY}', 'série par défaut créée');

select set_config('t.a', (select id::text from companies where legal_name = 'ALPHA SARL'), false);
select add_member_by_email(current_setting('t.a')::uuid, 'compta@a.ma', 'comptable');
select add_member_by_email(current_setting('t.a')::uuid, 'user@a.ma', 'utilisateur');
select t.fails($$select add_member_by_email(current_setting('t.a')::uuid, 'inconnu@x.ma', 'utilisateur')$$,
               'Aucun compte', 'ajout d''un e-mail inexistant refusé');

insert into parties (company_id, kind, name, ice) values
  (current_setting('t.a')::uuid, 'client', 'CLIENT UN', '000111222000033'),
  (current_setting('t.a')::uuid, 'client', 'CLIENT SANS ICE', null);
insert into products (company_id, reference, designation, unit_price_ttc, vat_rate_bp) values
  (current_setting('t.a')::uuid, 'P20', 'Produit 20 %', 12000, 2000),
  (current_setting('t.a')::uuid, 'P14', 'Produit 14 %', 11400, 1400),
  (current_setting('t.a')::uuid, 'P0', 'Produit exonéré', 5000, 0);
select t.fails($$insert into products (company_id, reference, designation, unit_price_ttc, vat_rate_bp)
                 values (current_setting('t.a')::uuid, 'PX', 'x', 100, 1900)$$, 'non configuré', 'taux non configuré refusé');
select t.ok((select count(*) from product_price_history) = 3, 'historique des prix à la création');

-- ===== Isolation entre entreprises =====
select t.as_user('44444444-4444-4444-4444-444444444444');
insert into companies (legal_name) values ('BETA SARL');
select t.ok((select count(*) from companies) = 1, 'B ne voit que sa propre entreprise');
select t.ok((select count(*) from products) = 0, 'B ne voit pas le catalogue de A');
select t.ok((select count(*) from parties) = 0, 'B ne voit pas les clients de A');
select t.fails($$insert into parties (company_id, kind, name) values (current_setting('t.a')::uuid, 'client', 'Intrus')$$,
               'row-level security', 'B ne peut pas écrire chez A');
update products set unit_price_ttc = 1 where reference = 'P20';
select t.as_user('11111111-1111-1111-1111-111111111111');
select t.ok((select unit_price_ttc from products where reference = 'P20') = 12000, 'B ne peut pas modifier un prix de A');

-- ===== Rôle utilisateur : pas de modification du catalogue =====
select t.as_user('33333333-3333-3333-3333-333333333333');
update products set unit_price_ttc = 1 where reference = 'P20';
select t.as_user('11111111-1111-1111-1111-111111111111');
select t.ok((select unit_price_ttc from products where reference = 'P20') = 12000, 'utilisateur ne peut pas modifier un prix');

-- ===== Facture brouillon (créée par un utilisateur) =====
select t.as_user('33333333-3333-3333-3333-333333333333');
insert into invoices (company_id, issue_date, client_id, goods_nature, total_ttc, status, number)
values (current_setting('t.a')::uuid, '2026-03-10', (select id from parties where name = 'CLIENT UN'), 'Marchandises', 999999, 'paid', 'HACK');
select set_config('t.inv1', (select id::text from invoices order by created_at desc limit 1), false);
select t.ok((select status = 'draft' and number is null and total_ttc = 0 from invoices where id = current_setting('t.inv1')::uuid),
            'statut, numéro et totaux forcés à l''insertion');

insert into invoice_lines (invoice_id, company_id, position, product_id, designation, quantity, unit_price_ttc, vat_rate_bp)
select current_setting('t.inv1')::uuid, current_setting('t.a')::uuid, n, p.id, p.designation, q, p.unit_price_ttc, p.vat_rate_bp
from (values (1, 'P20', 3), (2, 'P14', 2), (3, 'P0', 1.5)) v(n, r, q) join products p on p.reference = v.r;

select t.ok((select total_ttc from invoices where id = current_setting('t.inv1')::uuid) = 36000 + 22800 + 7500, 'total TTC');
select t.ok((select total_ht from invoices where id = current_setting('t.inv1')::uuid) = 30000 + 20000 + 7500, 'total HT');
select t.ok((select total_vat from invoices where id = current_setting('t.inv1')::uuid) = 6000 + 2800, 'total TVA');
select t.ok((select jsonb_array_length(vat_breakdown) from invoices where id = current_setting('t.inv1')::uuid) = 3, 'ventilation par taux');

-- Prix modifié par un utilisateur : refusé
select t.fails($$insert into invoice_lines (invoice_id, company_id, product_id, designation, quantity, unit_price_ttc, vat_rate_bp)
                 select current_setting('t.inv1')::uuid, current_setting('t.a')::uuid, id, designation, 1, 100, vat_rate_bp
                 from products where reference = 'P20'$$, 'administrateur ou un comptable', 'prix modifié par un utilisateur refusé');
-- Remise non autorisée
select t.fails($$insert into invoice_lines (invoice_id, company_id, product_id, designation, quantity, unit_price_ttc, vat_rate_bp, discount_bp)
                 select current_setting('t.inv1')::uuid, current_setting('t.a')::uuid, id, designation, 1, unit_price_ttc, vat_rate_bp, 500
                 from products where reference = 'P20'$$, 'remises ne sont pas autorisées', 'remise interdite par défaut');
-- Écriture directe des totaux : refusée
select t.fails($$update invoices set total_ttc = 1 where id = current_setting('t.inv1')::uuid$$, 'calculés automatiquement', 'totaux non modifiables');
-- Validation par un utilisateur : refusée
select t.fails($$select validate_invoice(current_setting('t.inv1')::uuid)$$, 'administrateur ou un comptable', 'utilisateur ne valide pas');
-- Passage direct au statut validé : refusé
select t.fails($$update invoices set status = 'validated', number = 'X' where id = current_setting('t.inv1')::uuid$$, 'Valider', 'statut non modifiable directement');

-- ===== Comptable : dérogation de prix tracée, validation =====
select t.as_user('22222222-2222-2222-2222-222222222222');
select t.fails($$insert into invoice_lines (invoice_id, company_id, product_id, designation, quantity, unit_price_ttc, vat_rate_bp)
                 select current_setting('t.inv1')::uuid, current_setting('t.a')::uuid, id, designation, 1, 10000, vat_rate_bp
                 from products where reference = 'P20'$$, 'motif', 'dérogation de prix sans motif refusée');
insert into invoice_lines (invoice_id, company_id, position, product_id, designation, quantity, unit_price_ttc, vat_rate_bp, price_override_reason)
select current_setting('t.inv1')::uuid, current_setting('t.a')::uuid, 4, id, designation, 1, 10000, vat_rate_bp, 'Geste commercial accordé par la direction'
from products where reference = 'P20';
select t.ok((select catalog_price_ttc from invoice_lines where position = 4) = 12000, 'prix catalogue conservé sur la ligne');
select t.ok((select unit_price_ttc from products where reference = 'P20') = 12000, 'catalogue jamais modifié par la facture');

select t.ok(validate_invoice(current_setting('t.inv1')::uuid) = 'FA0001/2026', 'premier numéro FA0001/2026');
select t.ok((select status from invoices where id = current_setting('t.inv1')::uuid) = 'validated', 'statut validée');
select t.ok((select client_snapshot ->> 'ice' from invoices where id = current_setting('t.inv1')::uuid) = '000111222000033', 'instantané client');
select t.ok((select due_date from invoices where id = current_setting('t.inv1')::uuid) = '2026-04-09', 'échéance = date + 30 jours');

-- ===== Verrouillage =====
select t.fails($$update invoices set notes = 'x' where id = current_setting('t.inv1')::uuid$$, 'ne peut plus être modifiée', 'facture validée non modifiable');
select t.fails($$update invoice_lines set quantity = 99 where invoice_id = current_setting('t.inv1')::uuid$$, 'validée', 'lignes verrouillées');
select t.fails($$delete from invoice_lines where invoice_id = current_setting('t.inv1')::uuid$$, 'validée', 'lignes non supprimables');
delete from invoices where id = current_setting('t.inv1')::uuid; -- filtré par RLS (status = draft)
select t.ok((select count(*) from invoices where id = current_setting('t.inv1')::uuid) = 1, 'facture validée non supprimable');
select t.fails($$select validate_invoice(current_setting('t.inv1')::uuid)$$, 'déjà validée', 'double validation refusée');

-- ===== Séquence, chronologie et ICE =====
create temp table tmp_ids (k text, id uuid);
grant all on tmp_ids to authenticated;
insert into invoices (company_id, issue_date, client_id) values (current_setting('t.a')::uuid, '2026-03-05', (select id from parties where name = 'CLIENT UN'));
insert into tmp_ids select 'early', id from invoices where issue_date = '2026-03-05';
insert into invoice_lines (invoice_id, company_id, designation, quantity, unit_price_ttc, vat_rate_bp)
select id, current_setting('t.a')::uuid, 'Service', 1, 1000, 2000 from tmp_ids where k = 'early';
select t.fails($$select validate_invoice((select id from tmp_ids where k = 'early'))$$, 'chronologique', 'date antérieure refusée');

insert into invoices (company_id, issue_date, client_id) values (current_setting('t.a')::uuid, '2026-03-12', (select id from parties where name = 'CLIENT SANS ICE'));
insert into tmp_ids select 'noice', id from invoices where issue_date = '2026-03-12';
insert into invoice_lines (invoice_id, company_id, designation, quantity, unit_price_ttc, vat_rate_bp)
select id, current_setting('t.a')::uuid, 'Service', 1, 1000, 2000 from tmp_ids where k = 'noice';
select t.fails($$select validate_invoice((select id from tmp_ids where k = 'noice'))$$, 'ICE du client', 'ICE obligatoire');

update invoices set issue_date = '2026-03-15', client_id = (select id from parties where name = 'CLIENT UN')
where id = (select id from tmp_ids where k = 'early');
select t.ok(validate_invoice((select id from tmp_ids where k = 'early')) = 'FA0002/2026', 'numéro suivant sans trou : FA0002/2026');

-- Échec de validation : le compteur n'avance pas
select t.ok((select next_seq from number_series where company_id = current_setting('t.a')::uuid) = 3, 'compteur = 3');

-- Nouvelle année : remise à 1
update invoices set issue_date = '2027-01-02', client_id = (select id from parties where name = 'CLIENT UN')
where id = (select id from tmp_ids where k = 'noice');
select t.ok(validate_invoice((select id from tmp_ids where k = 'noice')) = 'FA0001/2027', 'remise à zéro annuelle');

-- ===== Paiements =====
insert into payments (invoice_id, amount, paid_at) values (current_setting('t.inv1')::uuid, 30000, '2026-03-20');
select t.ok((select status from invoices where id = current_setting('t.inv1')::uuid) = 'partially_paid', 'partiellement payée');
select t.fails($$insert into payments (invoice_id, amount) values (current_setting('t.inv1')::uuid, 99999999)$$, 'dépasse', 'trop-perçu refusé');
insert into payments (invoice_id, amount) select id, total_ttc - amount_paid from invoices where id = current_setting('t.inv1')::uuid;
select t.ok((select status from invoices where id = current_setting('t.inv1')::uuid) = 'paid', 'payée');
select t.fails($$select cancel_invoice(current_setting('t.inv1')::uuid, 'Erreur de client')$$, 'paiements', 'annulation impossible si payée');

-- ===== Annulation / correction =====
select t.fails($$select cancel_invoice((select id from tmp_ids where k = 'early'), '')$$, 'motif', 'motif d''annulation obligatoire');
select set_config('t.corr', correct_invoice((select id from tmp_ids where k = 'early'), 'Mauvaise quantité')::text, false);
select t.ok((select status from invoices where id = (select id from tmp_ids where k = 'early')) = 'cancelled', 'facture annulée, numéro conservé');
select t.ok((select number from invoices where id = (select id from tmp_ids where k = 'early')) = 'FA0002/2026', 'numéro FA0002/2026 conservé');
select t.ok((select status = 'draft' and corrects_invoice_id is not null from invoices where id = current_setting('t.corr')::uuid), 'brouillon de correction créé');
select t.ok((select count(*) from invoice_lines where invoice_id = current_setting('t.corr')::uuid) = 1, 'lignes recopiées');

-- ===== Doublon de commande =====
insert into invoices (company_id, client_id, order_ref) values (current_setting('t.a')::uuid, (select id from parties where name = 'CLIENT UN'), 'CMD-77');
select t.fails($$insert into invoices (company_id, client_id, order_ref) values (current_setting('t.a')::uuid, (select id from parties where name = 'CLIENT UN'), 'CMD-77')$$,
               'duplicate key', 'commande facturée deux fois refusée');

-- ===== Journal =====
select t.ok((select count(*) from audit_log where table_name = 'invoices' and action = 'update') >= 3, 'journal des opérations alimenté');
select t.as_user('33333333-3333-3333-3333-333333333333');
select t.ok((select count(*) from audit_log) = 0, 'utilisateur simple ne lit pas le journal');

-- ===== Tableau de bord =====
select t.as_user('11111111-1111-1111-1111-111111111111');
select t.ok((dashboard_stats(current_setting('t.a')::uuid, '2026-01-01', '2026-12-31') ->> 'invoices_count')::int = 1, 'dashboard : factures validées (hors annulées)');
select t.ok((dashboard_stats(current_setting('t.a')::uuid, '2026-01-01', '2026-12-31') ->> 'sales_ttc')::bigint
            = (select total_ttc from invoices where id = current_setting('t.inv1')::uuid), 'dashboard : CA TTC');

-- ===== Démonstration =====
select set_config('t.demo', create_demo_company()::text, false);
select t.ok((select is_demo from companies where id = current_setting('t.demo')::uuid), 'entreprise démo marquée');
select t.ok((select count(*) from invoices where company_id = current_setting('t.demo')::uuid and number like 'DEMO-%') = 2, 'factures démo numérotées DEMO-');
select t.ok((select bool_and(is_demo) from invoices where company_id = current_setting('t.demo')::uuid), 'factures démo marquées');
select t.fails($$update companies set is_demo = false where id = current_setting('t.demo')::uuid$$, 'démonstration', 'statut démo non modifiable');
select t.fails($$select delete_demo_company(current_setting('t.a')::uuid)$$, 'démonstration', 'entreprise réelle non supprimable');
select delete_demo_company(current_setting('t.demo')::uuid);
select t.ok((select count(*) from companies where id = current_setting('t.demo')::uuid) = 0, 'entreprise démo supprimée');
delete from companies where id = current_setting('t.a')::uuid;
select t.ok((select count(*) from companies where id = current_setting('t.a')::uuid) = 1, 'entreprise réelle non supprimable');


-- ===== Enregistrement atomique d'un brouillon =====
select t.as_user('33333333-3333-3333-3333-333333333333');
select set_config('t.d1', save_invoice_draft(null, current_setting('t.a')::uuid,
  jsonb_build_object('issue_date', '2027-02-01', 'client_id', (select id from parties where name = 'CLIENT UN'), 'goods_nature', 'Divers'),
  jsonb_build_array(
    jsonb_build_object('product_id', (select id from products where reference = 'P20'), 'designation', 'Produit 20 %', 'quantity', 2, 'unit_price_ttc', 12000, 'vat_rate_bp', 2000),
    jsonb_build_object('designation', 'Service libre', 'quantity', 1.5, 'unit_price_ttc', 1000, 'vat_rate_bp', 1400)))::text, false);
select t.ok((select total_ttc from invoices where id = current_setting('t.d1')::uuid) = 25500, 'brouillon enregistré avec ses lignes');
select t.fails($$select save_invoice_draft(current_setting('t.d1')::uuid, current_setting('t.a')::uuid, '{"goods_nature":"Modifié"}'::jsonb,
  jsonb_build_array(jsonb_build_object('product_id', (select id from products where reference = 'P20'), 'designation', 'x', 'quantity', 1, 'unit_price_ttc', 1, 'vat_rate_bp', 2000)))$$,
  'administrateur ou un comptable', 'prix modifié refusé dans save_invoice_draft');
select t.ok((select goods_nature = 'Divers' and total_ttc = 25500 from invoices where id = current_setting('t.d1')::uuid)
            and (select count(*) from invoice_lines where invoice_id = current_setting('t.d1')::uuid) = 2,
            'échec = rien n''est modifié (transaction annulée)');
select t.as_user('44444444-4444-4444-4444-444444444444');
select t.fails($$select save_invoice_draft(current_setting('t.d1')::uuid, current_setting('t.a')::uuid, '{}'::jsonb, '[]'::jsonb)$$,
  'introuvable', 'autre entreprise : brouillon inaccessible');
select t.as_user('11111111-1111-1111-1111-111111111111');

-- ===== Séries de numérotation =====
select t.fails($$update number_series set next_seq = 1 where company_id = current_setting('t.a')::uuid and is_default$$,
               'compteur', 'compteur d''une série utilisée non modifiable');
select t.fails($$update number_series set format = 'X{SEQ}' where company_id = current_setting('t.a')::uuid and is_default$$,
               'nouvelle série', 'format d''une série utilisée non modifiable');
insert into number_series (company_id, name, format, next_seq) values (current_setting('t.a')::uuid, 'Reprise', 'R{SEQ:5}', 1);
update number_series set next_seq = 120 where name = 'Reprise';
select t.ok((select next_seq from number_series where name = 'Reprise') = 120, 'numéro de départ libre avant la 1re facture');
-- Reprise d'une numérotation existante : le numéro de départ est respecté dès la 1re facture
insert into invoices (company_id, issue_date, client_id, series_id) values (current_setting('t.a')::uuid, '2027-02-01', (select id from parties where name = 'CLIENT UN'), (select id from number_series where name = 'Reprise'));
insert into tmp_ids select 'reprise', id from invoices where series_id = (select id from number_series where name = 'Reprise');
insert into invoice_lines (invoice_id, company_id, designation, quantity, unit_price_ttc, vat_rate_bp)
select id, current_setting('t.a')::uuid, 'Service', 1, 1000, 2000 from tmp_ids where k = 'reprise';
select t.ok(validate_invoice((select id from tmp_ids where k = 'reprise')) = 'R00120', 'reprise : premier numéro = numéro de départ (R00120)');
select set_default_series((select id from number_series where name = 'Reprise'));
select t.ok((select name from number_series where company_id = current_setting('t.a')::uuid and is_default) = 'Reprise', 'changement de série par défaut');
select t.fails($$delete from number_series where name = 'Factures' and company_id = current_setting('t.a')::uuid$$, 'utilisée', 'série utilisée non supprimable');

-- ===== Dernier administrateur =====
select t.fails($$update company_members set role = 'comptable' where user_id = auth.uid() and company_id = current_setting('t.a')::uuid$$,
               'au moins un administrateur', 'dernier administrateur protégé');

reset role;
\echo 'TOUS LES SCÉNARIOS SONT PASSÉS'
