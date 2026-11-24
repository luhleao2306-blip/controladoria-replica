import type { CompanyId } from "@/data/mock";

export type CompanyKey = Exclude<CompanyId, "all">;
export type AccessibleCompany = { id: string; name: string; key: CompanyKey; document?: string | null };
export type PlatformAccess = { isAdmin: boolean; companies: AccessibleCompany[]; securityReady: boolean };

export function companyKey(name: string): CompanyKey | null {
  const normalized = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/\bw2\b/.test(normalized) && !/test/.test(normalized)) return "w2";
  if (/\bd61\b/.test(normalized)) return "d61";
  if (/\bsomus\b/.test(normalized)) return "somus";
  if (normalized.trim() === "lie arquitetura") return "lie";
  if (normalized.trim() === "lie design") return "lie-design";
  return null;
}
