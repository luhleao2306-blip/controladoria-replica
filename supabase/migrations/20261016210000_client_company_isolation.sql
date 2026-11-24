BEGIN;

CREATE TABLE IF NOT EXISTS public.user_company_access (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_id)
);
ALTER TABLE public.user_company_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_company_access FROM anon, authenticated;
GRANT SELECT ON public.user_company_access TO authenticated;
GRANT ALL ON public.user_company_access TO service_role;
CREATE POLICY "memberships read own or admin" ON public.user_company_access FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- Preserve existing single-company assignments without granting new companies.
INSERT INTO public.user_company_access(user_id, company_id)
SELECT user_id, company_id FROM public.users_profiles WHERE company_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.user_has_company_access(_user_id uuid, _company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'admin') OR EXISTS (
    SELECT 1 FROM public.user_company_access a WHERE a.user_id = _user_id AND a.company_id = _company_id
  )
$$;
REVOKE ALL ON FUNCTION public.user_has_company_access(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_company_access(uuid, uuid) TO authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM authenticated;
CREATE POLICY client_company_boundary ON public.companies AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.user_has_company_access(auth.uid(), id)) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY client_connection_boundary ON public.conta_azul_connections AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.guard_profile_permissions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.company_id IS NOT NULL OR COALESCE(NEW.role, 'viewer') <> 'viewer' THEN
        RAISE EXCEPTION 'Only administrators can assign companies and roles' USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.company_id IS DISTINCT FROM OLD.company_id OR NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'Only administrators can assign companies and roles' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_profile_permissions BEFORE INSERT OR UPDATE ON public.users_profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_permissions();

-- Restrictive policies also constrain any older permissive policies.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['financial_transactions','financial_transactions_raw','budget_targets','kpi_snapshots','alert_rules','alert_events','email_report_runs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY client_company_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.user_has_company_access(auth.uid(), company_id)) WITH CHECK (public.user_has_company_access(auth.uid(), company_id))', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['receitas','despesas','vendas','categorias','centros_de_custo','pessoas','contratos','bem'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=t AND column_name='company_id' AND udt_name='uuid') THEN
      EXECUTE format('CREATE POLICY client_company_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.user_has_company_access(auth.uid(), company_id)) WITH CHECK (public.user_has_company_access(auth.uid(), company_id))', t);
    ELSE
      EXECUTE format('CREATE POLICY client_company_boundary ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.has_role(auth.uid(), ''admin'')) WITH CHECK (public.has_role(auth.uid(), ''admin''))', t);
    END IF;
  END LOOP;
END $$;

-- Keep the safe projection readable while filtering it by the current caller.
CREATE OR REPLACE VIEW public.conta_azul_connections_safe WITH (security_barrier=true, security_invoker=false) AS
SELECT id, company_id, connection_status, token_expires_at, last_sync_at, created_at, updated_at
FROM public.conta_azul_connections WHERE auth.role()='service_role' OR public.user_has_company_access(auth.uid(), company_id);
REVOKE ALL ON public.conta_azul_connections_safe FROM anon;
GRANT SELECT ON public.conta_azul_connections_safe TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_access()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object('isAdmin', public.has_role(auth.uid(), 'admin'), 'securityReady', true,
    'companies', COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'key',
      CASE WHEN lower(c.name) ~ '\mw2\M' AND lower(c.name) !~ 'test' THEN 'w2'
        WHEN lower(c.name) ~ '\md61\M' THEN 'd61' WHEN lower(c.name) ~ '\msomus\M' THEN 'somus' END)
      ORDER BY c.name) FILTER (WHERE c.id IS NOT NULL), '[]'::jsonb))
  FROM public.companies c WHERE auth.uid() IS NOT NULL AND public.user_has_company_access(auth.uid(), c.id)
    AND (lower(c.name) ~ '\m(w2|d61|somus)\M') AND lower(c.name) !~ 'test'
$$;
REVOKE ALL ON FUNCTION public.platform_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_collaborator(_user_id uuid, _full_name text, _role public.app_role, _company_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501';
  END IF;
  IF _user_id=auth.uid() AND _role<>'admin' THEN RAISE EXCEPTION 'Cannot remove own administrator role'; END IF;
  IF _role IS NULL OR _company_ids IS NULL THEN RAISE EXCEPTION 'Invalid permissions'; END IF;
  PERFORM 1 FROM auth.users WHERE id=_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(_company_ids) AS ids(company_id) WHERE ids.company_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id=ids.company_id)) THEN
    RAISE EXCEPTION 'Unknown company';
  END IF;
  INSERT INTO public.users_profiles(user_id,full_name,role,company_id) VALUES (_user_id, trim(_full_name), _role::text, NULL)
    ON CONFLICT(user_id) DO UPDATE SET full_name=excluded.full_name,role=excluded.role,company_id=NULL;
  DELETE FROM public.user_roles WHERE user_id=_user_id;
  INSERT INTO public.user_roles(user_id,role) VALUES (_user_id,_role);
  DELETE FROM public.user_company_access WHERE user_id=_user_id;
  INSERT INTO public.user_company_access(user_id,company_id) SELECT _user_id,id FROM (SELECT DISTINCT unnest(_company_ids) id) ids;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_collaborator(uuid,text,public.app_role,uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_collaborator(uuid,text,public.app_role,uuid[]) TO authenticated;

COMMIT;
