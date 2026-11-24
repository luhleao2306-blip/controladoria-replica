import type { CompanyId } from "@/data/mock";

type Company = Exclude<CompanyId, "all">;
type Account = { id: string; nome: string; ativo?: boolean; currentBalance?: { saldo_atual?: number } };

// Bank balances belong to the confirmed snapshot, not to the reporting period.
export function summarizeCurrentCash(
  companies: Company[], catalog: Partial<Record<Company, Account[]>>, accountNames: string[], confirmed: Company[],
) {
  const scope = [...new Set(companies)];
  const accounts = scope.flatMap(company => (catalog[company] ?? [])
    .filter(account => account.ativo !== false && (!accountNames.length || accountNames.includes(account.nome)))
    .map(account => ({ ...account, company, sourceName: account.nome })));
  const missingCompanies = scope.filter(company => !confirmed.includes(company));
  const missingBalances = accounts.filter(account => !Number.isFinite(account.currentBalance?.saldo_atual));
  const complete = scope.length > 0 && missingCompanies.length === 0 && missingBalances.length === 0;
  const balance = complete && accounts.length > 0
    ? accounts.reduce((cents, account) => cents + Math.round(account.currentBalance!.saldo_atual! * 100), 0) / 100
    : null;
  return { accounts, balance, missingCompanies, missingBalances, complete };
}
