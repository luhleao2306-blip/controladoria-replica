-- Register the new company key without granting any user additional access.
CREATE OR REPLACE FUNCTION public.platform_access()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object('isAdmin', public.has_role(auth.uid(), 'admin'), 'securityReady', true,
    'companies', COALESCE(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'key',
      CASE WHEN lower(c.name) ~ '\mw2\M' AND lower(c.name) !~ 'test' THEN 'w2'
        WHEN lower(c.name) ~ '\md61\M' THEN 'd61'
        WHEN lower(c.name) ~ '\msomus\M' THEN 'somus'
        WHEN lower(trim(c.name)) = 'lie arquitetura' THEN 'lie' END)
      ORDER BY c.name) FILTER (WHERE c.id IS NOT NULL), '[]'::jsonb))
  FROM public.companies c WHERE auth.uid() IS NOT NULL AND public.user_has_company_access(auth.uid(), c.id)
    AND (lower(c.name) ~ '\m(w2|d61|somus)\M' OR lower(trim(c.name)) = 'lie arquitetura')
    AND lower(c.name) !~ 'test'
$$;
REVOKE ALL ON FUNCTION public.platform_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_access() TO authenticated;
