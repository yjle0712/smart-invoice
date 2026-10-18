-- =====================================================================
-- SMART INVOICE — 3/4 : sécurité (RLS) et stockage
-- Chaque ligne appartient à une entreprise ; seuls ses membres y accèdent.
-- =====================================================================

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.parties enable row level security;
alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.product_price_history enable row level security;
alter table public.number_series enable row level security;
alter table public.invoice_templates enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.payments enable row level security;
alter table public.audit_log enable row level security;

-- Profils : soi-même et les membres des mêmes entreprises
create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from public.company_members a join public.company_members b on a.company_id = b.company_id
    where a.user_id = auth.uid() and b.user_id = profiles.id)
);
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Entreprises
-- (À la création, l'application génère l'id côté client puis relit l'entreprise
--  une fois l'appartenance créée : pas besoin d'élargir cette règle.)
create policy companies_select on public.companies for select to authenticated using (public.is_member(id));
create policy companies_insert on public.companies for insert to authenticated with check (created_by = auth.uid());
create policy companies_update on public.companies for update to authenticated
  using (public.has_role(id, array['admin']::public.member_role[]))
  with check (public.has_role(id, array['admin']::public.member_role[]));
create policy companies_delete on public.companies for delete to authenticated
  using (is_demo and public.has_role(id, array['admin']::public.member_role[]));

-- Membres
create policy members_select on public.company_members for select to authenticated using (public.is_member(company_id));
create policy members_write on public.company_members for all to authenticated
  using (public.has_role(company_id, array['admin']::public.member_role[]))
  with check (public.has_role(company_id, array['admin']::public.member_role[]));

-- Clients / fournisseurs : tous les membres ; pas de suppression (archivage)
create policy parties_select on public.parties for select to authenticated using (public.is_member(company_id));
create policy parties_insert on public.parties for insert to authenticated with check (public.is_member(company_id));
create policy parties_update on public.parties for update to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));

-- Catalogue : lecture par tous les membres, écriture admin / comptable
create policy categories_select on public.product_categories for select to authenticated using (public.is_member(company_id));
create policy categories_write on public.product_categories for all to authenticated
  using (public.can_manage(company_id)) with check (public.can_manage(company_id));

create policy products_select on public.products for select to authenticated using (public.is_member(company_id));
create policy products_insert on public.products for insert to authenticated with check (public.can_manage(company_id));
create policy products_update on public.products for update to authenticated
  using (public.can_manage(company_id)) with check (public.can_manage(company_id));

create policy price_history_select on public.product_price_history for select to authenticated using (public.is_member(company_id));

-- Séries et modèles
create policy series_select on public.number_series for select to authenticated using (public.is_member(company_id));
create policy series_insert on public.number_series for insert to authenticated with check (public.can_manage(company_id));
create policy series_update on public.number_series for update to authenticated
  using (public.has_role(company_id, array['admin']::public.member_role[]))
  with check (public.has_role(company_id, array['admin']::public.member_role[]));

create policy templates_select on public.invoice_templates for select to authenticated using (public.is_member(company_id));
create policy templates_write on public.invoice_templates for all to authenticated
  using (public.can_manage(company_id)) with check (public.can_manage(company_id));

-- Factures : tous les membres créent et modifient des brouillons ;
-- validation / annulation via fonctions contrôlées (rôle admin / comptable).
create policy invoices_select on public.invoices for select to authenticated using (public.is_member(company_id));
create policy invoices_insert on public.invoices for insert to authenticated with check (public.is_member(company_id));
create policy invoices_update on public.invoices for update to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));
create policy invoices_delete on public.invoices for delete to authenticated
  using (public.is_member(company_id) and status = 'draft');

create policy lines_select on public.invoice_lines for select to authenticated using (public.is_member(company_id));
create policy lines_insert on public.invoice_lines for insert to authenticated with check (
  exists (select 1 from public.invoices i where i.id = invoice_id and public.is_member(i.company_id))
);
create policy lines_update on public.invoice_lines for update to authenticated
  using (public.is_member(company_id)) with check (public.is_member(company_id));
create policy lines_delete on public.invoice_lines for delete to authenticated using (public.is_member(company_id));

create policy payments_select on public.payments for select to authenticated using (public.is_member(company_id));
create policy payments_insert on public.payments for insert to authenticated with check (
  exists (select 1 from public.invoices i where i.id = invoice_id and public.can_manage(i.company_id))
);
create policy payments_delete on public.payments for delete to authenticated using (public.can_manage(company_id));

-- Journal : lecture seule, admin / comptable
create policy audit_select on public.audit_log for select to authenticated using (public.can_manage(company_id));

-- Fonctions exposées
revoke all on function public.validate_invoice(uuid) from public, anon;
revoke all on function public.cancel_invoice(uuid, text) from public, anon;
revoke all on function public.correct_invoice(uuid, text) from public, anon;
revoke all on function public.duplicate_invoice(uuid) from public, anon;
revoke all on function public.add_member_by_email(uuid, text, public.member_role) from public, anon;
revoke all on function public.recompute_invoice(uuid) from public, anon, authenticated;
grant execute on function public.validate_invoice(uuid) to authenticated;
grant execute on function public.cancel_invoice(uuid, text) to authenticated;
grant execute on function public.correct_invoice(uuid, text) to authenticated;
grant execute on function public.duplicate_invoice(uuid) to authenticated;
grant execute on function public.add_member_by_email(uuid, text, public.member_role) to authenticated;

-- ---------------------------------------------------------------------
-- Stockage privé (logos, fonds de modèles) : dossier = id de l'entreprise
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('company-assets', 'company-assets', false)
on conflict (id) do nothing;

create policy assets_select on storage.objects for select to authenticated using (
  bucket_id = 'company-assets' and public.is_member(((storage.foldername(name))[1])::uuid)
);
create policy assets_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'company-assets' and public.can_manage(((storage.foldername(name))[1])::uuid)
);
create policy assets_update on storage.objects for update to authenticated using (
  bucket_id = 'company-assets' and public.can_manage(((storage.foldername(name))[1])::uuid)
);
create policy assets_delete on storage.objects for delete to authenticated using (
  bucket_id = 'company-assets' and public.can_manage(((storage.foldername(name))[1])::uuid)
);
