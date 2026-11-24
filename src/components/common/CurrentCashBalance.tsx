import { Wallet } from "lucide-react";
import { useFilters } from "@/context/FiltersContext";
import { FINANCIAL_ACCOUNTS_BY_COMPANY, hasConfirmedCompanyData } from "@/data/live-sync";
import { selectedCompanies, selectedFinancialAccounts } from "@/lib/filter-options";
import { summarizeCurrentCash } from "@/lib/current-cash";
import { formatBRL } from "@/lib/format";
import { financialAmountClass } from "@/lib/financial-semantics";
import { cn } from "@/lib/utils";

export function useCurrentCash() {
  const filters = useFilters();
  const selected = selectedCompanies(filters);
  const companies = filters.companyOptions.filter(company => !selected.length || selected.includes(company.id)).map(company => company.id);
  return summarizeCurrentCash(companies, FINANCIAL_ACCOUNTS_BY_COMPANY, selectedFinancialAccounts(filters), companies.filter(hasConfirmedCompanyData));
}

export function CurrentCashBalance() {
  const cash = useCurrentCash();
  return <section aria-label="Saldo de caixa atual" className="mb-6 min-w-0 border-y border-primary/25 bg-primary/5 px-4 py-5 sm:px-6">
    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Wallet size={18} className="shrink-0 text-primary" /><h2>Saldo de caixa atual</h2></div>
    <p className={cn("mt-2 break-words text-[32px] font-semibold leading-tight tabular-nums tracking-normal sm:text-[40px]", financialAmountClass(cash.balance, "result"))}>
      {cash.balance === null ? "Indisponível" : formatBRL(cash.balance)}
    </p>
    <p className="mt-2 text-xs text-muted-foreground">{cash.balance !== null
      ? `${cash.accounts.length} contas ativas · ${cash.accounts.some(account => account.company === "manual-test") ? "Saldo das contas" : "Saldo no Conta Azul"} · Independente do período`
      : cash.missingCompanies.length ? "Aguardando os dados confirmados das empresas selecionadas"
      : cash.missingBalances.length ? "O Conta Azul não informou o saldo de todas as contas selecionadas"
      : "Nenhuma conta ativa com saldo disponível na seleção"}</p>
  </section>;
}
