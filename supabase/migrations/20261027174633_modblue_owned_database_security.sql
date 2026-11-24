-- Harden the owned Modblue database after the existing company-boundary migrations.
BEGIN;
CREATE SCHEMA IF NOT EXISTS modblue_private;
REVOKE ALL ON SCHEMA modblue_private FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA modblue_private TO authenticated,service_role;
REVOKE CREATE ON SCHEMA public FROM PUBLIC,anon,authenticated;

-- API credentials stay administrator-only; the projection below returns only
-- connection status for companies the authenticated caller may actually see.
GRANT SELECT ON public.conta_azul_connections TO authenticated;
CREATE OR REPLACE FUNCTION modblue_private.safe_connection_status()
RETURNS TABLE(id uuid,company_id uuid,connection_status public.connection_status,
  token_expires_at timestamptz,last_sync_at timestamptz,created_at timestamptz,updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT c.id,c.company_id,c.connection_status,c.token_expires_at,c.last_sync_at,c.created_at,c.updated_at
  FROM public.conta_azul_connections c
  WHERE ((SELECT auth.jwt()->>'role')='service_role') OR
    ((SELECT auth.uid()) IS NOT NULL AND public.user_has_company_access((SELECT auth.uid()),c.company_id))
$$;
REVOKE ALL ON FUNCTION modblue_private.safe_connection_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION modblue_private.safe_connection_status() TO authenticated,service_role;
CREATE OR REPLACE VIEW public.conta_azul_connections_safe WITH(security_barrier=true,security_invoker=true) AS
  SELECT * FROM modblue_private.safe_connection_status();
REVOKE ALL ON public.conta_azul_connections_safe FROM PUBLIC,anon;
GRANT SELECT ON public.conta_azul_connections_safe TO authenticated,service_role;

CREATE INDEX IF NOT EXISTS idx_raw_company_source_external ON public.financial_transactions_raw(company_id,source,external_id);
CREATE INDEX IF NOT EXISTS idx_ft_company_external_type ON public.financial_transactions(company_id,external_id,transaction_type);
CREATE INDEX IF NOT EXISTS idx_ft_company_payment ON public.financial_transactions(company_id,payment_date);
CREATE INDEX IF NOT EXISTS idx_ft_company_due ON public.financial_transactions(company_id,due_date);
CREATE INDEX IF NOT EXISTS idx_membership_company ON public.user_company_access(company_id,user_id);
CREATE INDEX IF NOT EXISTS idx_profile_company ON public.users_profiles(company_id);
CREATE INDEX IF NOT EXISTS idx_connection_company ON public.conta_azul_connections(company_id);

-- Legacy catalogs contain no tenant key. They are administrator-only; client
-- reporting reads the company-scoped normalized records and imported catalogs.
DO $$ DECLARE t text; policy record; BEGIN
  FOREACH t IN ARRAY ARRAY['categorias','centros_de_custo','pessoas','contratos','bem','receitas','despesas','vendas','sync_log'] LOOP
    IF to_regclass('public.'||t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon',t);
    FOR policy IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I',policy.policyname,t);
    END LOOP;
    EXECUTE format('CREATE POLICY legacy_admin_access ON public.%I FOR ALL TO authenticated USING (public.has_role((select auth.uid()),''admin'')) WITH CHECK (public.has_role((select auth.uid()),''admin''))',t);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.convites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),token text NOT NULL UNIQUE,email text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
  used_at timestamptz,used_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.convites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.convites FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.convites TO authenticated;
GRANT ALL ON public.convites TO service_role;
DROP POLICY IF EXISTS "Admins can view invites" ON public.convites;
DROP POLICY IF EXISTS "Admins can create invites" ON public.convites;
CREATE POLICY "Admins can view invites" ON public.convites FOR SELECT TO authenticated
  USING(public.has_role((SELECT auth.uid()),'admin'));
CREATE POLICY "Admins can create invites" ON public.convites FOR INSERT TO authenticated
  WITH CHECK(public.has_role((SELECT auth.uid()),'admin') AND created_by=(SELECT auth.uid()));
DROP TRIGGER IF EXISTS trg_convites_updated ON public.convites;
CREATE TRIGGER trg_convites_updated BEFORE UPDATE ON public.convites FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- A valid invite permits account creation, not administrator privileges or
-- access to an arbitrary company. Only admin_set_collaborator assigns access.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_invite public.convites; v_token text; BEGIN
  v_token=NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'invite_token','')),'');
  IF v_token IS NULL THEN RAISE EXCEPTION 'Cadastro permitido somente por convite valido'; END IF;
  SELECT * INTO v_invite FROM public.convites WHERE token=v_token FOR UPDATE;
  IF v_invite.id IS NULL OR v_invite.used_at IS NOT NULL OR v_invite.expires_at<=now()
    OR (v_invite.email IS NOT NULL AND lower(v_invite.email)<>lower(NEW.email)) THEN
    RAISE EXCEPTION 'Convite invalido, utilizado, expirado ou destinado a outro email';
  END IF;
  UPDATE public.convites SET used_at=now(),used_by=NEW.id WHERE id=v_invite.id;
  INSERT INTO public.user_roles(user_id,role) VALUES(NEW.id,'viewer') ON CONFLICT DO NOTHING;
  INSERT INTO public.users_profiles(user_id,full_name,role,company_id)
  VALUES(NEW.id,COALESCE(NEW.raw_user_meta_data->>'full_name',split_part(NEW.email,'@',1)),'viewer',NULL)
  ON CONFLICT(user_id) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
REVOKE ALL ON FUNCTION public.guard_profile_permissions() FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.invite_is_valid(_token text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM public.convites WHERE token=_token AND used_at IS NULL AND expires_at>now())
$$;
REVOKE ALL ON FUNCTION public.invite_is_valid(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invite_is_valid(text) TO anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
