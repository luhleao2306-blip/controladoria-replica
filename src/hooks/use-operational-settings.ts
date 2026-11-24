import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAppUserId } from "@/context/AppUserContext";
import { getOperationalSettings } from "@/lib/operational-settings.functions";
import type { CompanyId } from "@/data/mock";

export function useOperationalSettings(company: CompanyId) {
  const userId = useAppUserId();
  const cache = useQueryClient();
  const queryKey = ["operational-settings", userId, company];
  const query = useQuery({ queryKey, queryFn: () => getOperationalSettings({ data: { company: company as Exclude<CompanyId, "all"> } }),
    enabled: !!userId && company !== "all", staleTime: 60000 });
  return { ...query, invalidate: () => cache.invalidateQueries({ queryKey }) };
}
