-- =====================================================================
-- SMART INVOICE — 11 : clients, fournisseurs et produits communs à plusieurs entreprises
-- Copie (sans doublon) d'une entreprise vers une autre. Rejouable sans erreur.
-- Les droits habituels s'appliquent (fonction SECURITY INVOKER) :
--   lecture de la source = membre ; ajout de clients = membre ; ajout de produits = admin / comptable.
-- Un élément déjà présent dans l'entreprise cible n'est jamais modifié
-- (même ICE ou même nom pour un client, même référence pour un produit).
-- =====================================================================

create or replace function public.copy_master_data(
  p_source uuid,
  p_target uuid,
  p_parties boolean default true,
  p_products boolean default true,
  p_party_ids uuid[] default null,
  p_product_ids uuid[] default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  r record;
  v_parties integer := 0;
  v_products integer := 0;
  v_skipped integer := 0;
  v_cat uuid;
  v_errors text[] := '{}';
begin
  if p_source = p_target then raise exception 'Choisissez deux entreprises différentes.'; end if;
  if not is_member(p_source) or not is_member(p_target) then raise exception 'Entreprise introuvable.'; end if;

  if p_parties then
    for r in
      select * from parties s
      where s.company_id = p_source and not s.archived
        and (p_party_ids is null or s.id = any (p_party_ids))
        and not exists (
          select 1 from parties t
          where t.company_id = p_target and t.kind = s.kind
            and ((s.ice is not null and t.ice = s.ice)
              or (s.ice is null and lower(trim(t.name)) = lower(trim(s.name))))
        )
    loop
      begin
        insert into parties (company_id, kind, name, ice, if_number, rc, address, city, phone, email, payment_terms, notes)
        values (p_target, r.kind, r.name, r.ice, r.if_number, r.rc, r.address, r.city, r.phone, r.email, r.payment_terms, r.notes);
        v_parties := v_parties + 1;
      exception when others then
        v_skipped := v_skipped + 1;
        v_errors := array_append(v_errors, r.name || ' : ' || sqlerrm);
      end;
    end loop;
  end if;

  if p_products then
    if not can_manage(p_target) then
      raise exception 'Seuls un administrateur ou un comptable peuvent ajouter des produits au catalogue.';
    end if;
    for r in
      select s.*, c.name as category_name from products s
      left join product_categories c on c.id = s.category_id
      where s.company_id = p_source and s.active
        and (p_product_ids is null or s.id = any (p_product_ids))
        and not exists (select 1 from products t where t.company_id = p_target and lower(t.reference) = lower(s.reference))
    loop
      begin
        v_cat := null;
        if r.category_name is not null then
          insert into product_categories (company_id, name) values (p_target, r.category_name)
          on conflict (company_id, name) do nothing;
          select id into v_cat from product_categories where company_id = p_target and name = r.category_name;
        end if;
        insert into products (company_id, reference, designation, category_id, unit, unit_price_ttc, vat_rate_bp)
        values (p_target, r.reference, r.designation, v_cat, r.unit, r.unit_price_ttc, r.vat_rate_bp);
        v_products := v_products + 1;
      exception when others then
        v_skipped := v_skipped + 1;
        v_errors := array_append(v_errors, r.reference || ' : ' || sqlerrm);
      end;
    end loop;
  end if;

  return jsonb_build_object('parties', v_parties, 'products', v_products, 'skipped', v_skipped, 'errors', to_jsonb(v_errors[1:10]));
end $$;

revoke all on function public.copy_master_data(uuid, uuid, boolean, boolean, uuid[], uuid[]) from public, anon;
grant execute on function public.copy_master_data(uuid, uuid, boolean, boolean, uuid[], uuid[]) to authenticated;
