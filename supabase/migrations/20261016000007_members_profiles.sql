-- =====================================================================
-- SMART INVOICE — 7 : lien membres → profils (pour afficher e-mail et nom)
-- =====================================================================
alter table public.company_members
  add constraint company_members_profile_fk foreign key (user_id) references public.profiles (id) on delete cascade;
