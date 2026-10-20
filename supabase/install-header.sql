-- =====================================================================
-- SMART INVOICE — INSTALLATION COMPLÈTE EN UNE FOIS (Supabase → SQL Editor)
--
-- Copiez TOUT ce fichier dans le SQL Editor puis cliquez sur « Run ».
-- Il peut être relancé sans erreur : il supprime d'abord une éventuelle
-- installation partielle de Smart Invoice, puis recrée tout.
-- ⚠️ À utiliser pour l'INSTALLATION INITIALE : relancé plus tard, il
--    effacerait les données Smart Invoice (factures, clients, etc.).
--    Les comptes utilisateurs (Authentication) ne sont pas supprimés.
-- =====================================================================

-- ---------- Nettoyage d'une installation précédente ----------
drop trigger if exists on_auth_user_created on auth.users;
drop policy if exists assets_select on storage.objects;
drop policy if exists assets_insert on storage.objects;
drop policy if exists assets_update on storage.objects;
drop policy if exists assets_delete on storage.objects;

drop view if exists public.vat_journal cascade;
drop table if exists
  public.quote_lines, public.quotes,
  public.delivery_note_lines, public.delivery_notes, public.delivery_note_counters,
  public.vat_entries, public.pdf_imports,
  public.audit_log, public.payments, public.invoice_lines, public.invoices,
  public.invoice_templates, public.number_series, public.product_price_history,
  public.products, public.product_categories, public.parties, public.company_members,
  public.companies, public.profiles
  cascade;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any (array[
      'add_member_by_email','after_invoice_line','after_payment','audit','before_invoice_line','can_manage',
      'cancel_invoice','check_company_update','check_product_rate','correct_invoice','create_demo_company',
      'dashboard_stats','delete_demo_company','duplicate_invoice','format_invoice_number','guard_invoice',
      'guard_number_series','handle_new_user','has_role','ht_from_ttc','is_member','keep_one_admin',
      'on_company_created','on_payment','recompute_invoice','save_invoice_draft','set_default_series',
      'touch_updated_at','track_product_price','validate_invoice',
      'vat_entry_before','vat_declaration','vat_dashboard',
      'guard_delivery_note','create_note_from_invoice','copy_master_data','check_party_series','guard_quote','save_quote','convert_quote_to_invoice'])
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $$;

drop type if exists public.member_role, public.invoice_status, public.party_kind, public.rounding_mode,
  public.vat_entry_kind, public.vat_entry_status cascade;

-- Profils des comptes déjà créés avant l'installation (recréés plus bas)

