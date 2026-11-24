import type { AccountingBasis, CompanyId, MonthlyKpi, Transaction } from "@/data/mock";
import { buildDreDetails } from "./dre-details";
import { DRE_BUCKETS, DRE_COMPONENTS, DRE_ROWS, type DreBucket } from "./dre-rows";

export type SimulationEntry = {
  id: string; company: Exclude<CompanyId, "all">; bucket: DreBucket; category: string; description: string;
  party: string; month: string; date: string; amountCents: number; originalCents: number; originalMonth: string;
  originalBucket: DreBucket; originalCategory: string; originalDescription: string; transactionId: string;
  costCenter: string; account: string; status: string; added: boolean; excluded: boolean;
};
export type SimulationPatch = Partial<Pick<SimulationEntry, "amountCents" | "bucket" | "category" | "description" | "month" | "excluded">>;
export type Simulation = {
  name: string; company: Exclude<CompanyId, "all">; companyName: string; basis: AccountingBasis; filters: string;
  createdAt: string; months: string[]; original: SimulationEntry[]; edits: Record<string, SimulationPatch>; additions: SimulationEntry[];
};
export type SimulationGroup = { key: string; category: string; bucket: DreBucket; entries: SimulationEntry[]; values: number[]; total: number };
export const cents = (value: number) => {
  const result = Math.round(value * 100);
  if (!Number.isFinite(value) || !Number.isSafeInteger(result) || Math.abs(result) > 9e12) throw new Error("Valor inválido ou fora do limite.");
  return result;
};
export const groupId = (entry: Pick<SimulationEntry, "bucket" | "category">) => JSON.stringify([entry.bucket, entry.category]);
export const components = (line: string) => DRE_COMPONENTS[line] ?? [line];

export function createSimulation(company: Simulation["company"], companyName: string, basis: AccountingBasis, filters: string,
  data: MonthlyKpi[], transactions: Transaction[], now = new Date().toISOString()): Simulation {
  if (transactions.some(row => row.company !== company)) throw new Error("A simulação contém dados de outra empresa.");
  const months = data.map(row => `${row.year}-${String(row.monthIndex + 1).padStart(2, "0")}`);
  const details = buildDreDetails(transactions, data, basis);
  const original = DRE_BUCKETS.flatMap(bucket => details(bucket).flatMap(group => group.entries.map(entry => ({
    id: JSON.stringify([company, bucket, group.key, entry.transaction.id, entry.month]), company, bucket, category: group.category,
    originalCategory: group.category, description: entry.transaction.description ?? "", originalDescription: entry.transaction.description ?? "",
    party: entry.transaction.party || "Não informado na origem", month: entry.month, originalMonth: entry.month, date: entry.date,
    amountCents: cents(entry.amount), originalCents: cents(entry.amount), originalBucket: bucket,
    transactionId: entry.transaction.id, costCenter: entry.transaction.costCenter, account: entry.transaction.source?.account ?? "",
    status: entry.transaction.source?.sourceStatus === "PERDIDO" ? "Perdido" : entry.transaction.status, added: false, excluded: false,
  }))));
  if (new Set(original.map(entry => entry.id)).size !== original.length) throw new Error("Lançamentos duplicados na simulação.");
  return { name: "Cenário 1", company, companyName, basis, filters, createdAt: now, months, original, edits: {}, additions: [] };
}

export function simulationEntries(simulation: Simulation, original = false): SimulationEntry[] {
  return original ? simulation.original.map(entry => ({ ...entry })) : [...simulation.original, ...simulation.additions].map(entry => ({
    ...entry, ...simulation.edits[entry.id],
  }));
}

export function patchSimulation(simulation: Simulation, id: string, patch: SimulationPatch): Simulation {
  if (![...simulation.original, ...simulation.additions].some(entry => entry.id === id && entry.company === simulation.company)) throw new Error("Lançamento fora desta simulação.");
  const allowed = ["amountCents", "bucket", "category", "description", "month", "excluded"];
  if (Object.keys(patch).some(key => !allowed.includes(key))) throw new Error("Campo protegido da simulação.");
  if (patch.amountCents !== undefined && (!Number.isSafeInteger(patch.amountCents) || Math.abs(patch.amountCents) > 9e12)) throw new Error("Valor inválido.");
  if (patch.bucket !== undefined && !DRE_BUCKETS.includes(patch.bucket)) throw new Error("Grupo DRE inválido.");
  if (patch.month !== undefined && !simulation.months.includes(patch.month)) throw new Error("Mês fora do cenário.");
  if (patch.category !== undefined && (!patch.category.trim() || patch.category.length > 500)) throw new Error("Informe a categoria.");
  if (patch.description !== undefined && patch.description.length > 4000) throw new Error("Descrição muito longa.");
  if (patch.excluded !== undefined && typeof patch.excluded !== "boolean") throw new Error("Exclusão inválida.");
  return { ...simulation, edits: { ...simulation.edits, [id]: { ...simulation.edits[id], ...patch } } };
}

export function addSimulationEntry(simulation: Simulation, input: { id: string; bucket: DreBucket; category: string; description: string; month: string; amountCents: number }): Simulation {
  if ([...simulation.original, ...simulation.additions].some(entry => entry.id === input.id)) throw new Error("Identificador já utilizado.");
  const entry: SimulationEntry = { ...input, company: simulation.company, party: "Ajuste da simulação", originalCents: 0,
    originalMonth: input.month, originalBucket: input.bucket, originalCategory: input.category, originalDescription: input.description,
    transactionId: "", costCenter: "", account: "", status: "Simulação", date: `${input.month}-01`, added: true, excluded: false };
  const next = { ...simulation, additions: [...simulation.additions, entry] };
  const { id: _id, ...patch } = input;
  return patchSimulation(next, entry.id, patch);
}

export function simulationRows(simulation: Simulation, original = false) {
  const monthly = new Map(simulation.months.map(month => [month, new Map<string, number>()]));
  for (const entry of simulationEntries(simulation, original)) {
    if (entry.excluded) continue;
    const sums = monthly.get(entry.month);
    if (!sums) throw new Error("Mês fora do cenário.");
    sums.set(entry.bucket, (sums.get(entry.bucket) ?? 0) + entry.amountCents);
  }
  return DRE_ROWS.map(row => {
    const values = simulation.months.map(month => components(row.key).reduce((sum, bucket) => sum + (monthly.get(month)?.get(bucket) ?? 0), 0));
    return { ...row, values, total: values.reduce((sum, value) => sum + value, 0) };
  });
}

export function simulationGroups(simulation: Simulation, line: string, original = false): SimulationGroup[] {
  const groups = new Map<string, SimulationGroup>();
  for (const entry of simulationEntries(simulation, original)) {
    if (!components(line).includes(entry.bucket)) continue;
    const key = groupId(entry), group = groups.get(key) ?? { key, category: entry.category, bucket: entry.bucket, entries: [], values: simulation.months.map(() => 0), total: 0 };
    group.entries.push(entry);
    if (!entry.excluded) { group.values[simulation.months.indexOf(entry.month)] += entry.amountCents; group.total += entry.amountCents; }
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total) || a.category.localeCompare(b.category));
}

export function setSimulationCell(simulation: Simulation, line: string, month: string, targetCents: number, group?: SimulationGroup): Simulation {
  const row = DRE_ROWS.find(row => row.key === line);
  if (!row || row.emphasis || !simulation.months.includes(month) || !Number.isSafeInteger(targetCents) || Math.abs(targetCents) > 9e12) throw new Error("Célula não editável.");
  if (group && !components(line).includes(group.bucket)) throw new Error("Categoria fora desta linha.");
  const current = group ? simulationGroups(simulation, line).find(item => item.key === group.key)?.values[simulation.months.indexOf(month)] ?? 0
    : simulationRows(simulation).find(item => item.key === line)!.values[simulation.months.indexOf(month)];
  const difference = targetCents - current;
  if (!difference) return simulation;
  const bucket = (group?.bucket ?? components(line)[0]) as DreBucket;
  return addSimulationEntry(simulation, { id: `adjust:${simulation.additions.length}:${line}:${month}`, bucket, month,
    category: group?.category ?? `Ajuste · ${row.label}`, description: `Ajuste de cenário · ${row.label}`, amountCents: difference });
}

export function simulationChanged(entry: SimulationEntry) {
  return entry.added || entry.excluded || entry.amountCents !== entry.originalCents || entry.bucket !== entry.originalBucket
    || entry.category !== entry.originalCategory || entry.description !== entry.originalDescription || entry.month !== entry.originalMonth;
}

// Consolidation is a read projection, never a writable "all companies" scenario.
export function consolidateSimulations(simulations: Simulation[]) {
  if (new Set(simulations.map(item => item.company)).size !== simulations.length) throw new Error("Empresa repetida na consolidação.");
  if (simulations.some(item => item.basis !== simulations[0].basis)) throw new Error("Bases de cálculo diferentes.");
  const months = [...new Set(simulations.flatMap(item => item.months))].sort();
  const companies = simulations.map(simulation => ({ simulation, rows: simulationRows(simulation), original: simulationRows(simulation, true) }));
  const sumRows = (original: boolean) => DRE_ROWS.map((row, index) => {
    const values = months.map(month => companies.reduce((sum, company) => {
      const monthIndex = company.simulation.months.indexOf(month);
      return sum + (monthIndex < 0 ? 0 : (original ? company.original : company.rows)[index].values[monthIndex]);
    }, 0));
    return { ...row, values, total: values.reduce((sum, value) => sum + value, 0) };
  });
  return { months, companies, rows: sumRows(false), original: sumRows(true) };
}

export function simulationChanges(simulations: Simulation[]) {
  consolidateSimulations(simulations);
  return simulations.flatMap(simulation => simulationEntries(simulation).filter(simulationChanged)
    .map(entry => ({ companyName: simulation.companyName, scenario: simulation.name, entry })));
}

export function simulationSourceMatches(current: Simulation, latest: Simulation) {
  return current.company === latest.company && current.basis === latest.basis && current.filters === latest.filters
    && current.months.length === latest.months.length && current.months.every((month, i) => month === latest.months[i])
    && current.original.length === latest.original.length && current.original.every((entry, i) =>
      Object.keys(entry).every(key => entry[key as keyof SimulationEntry] === latest.original[i][key as keyof SimulationEntry]));
}

export function refreshUneditedSimulation(current: Simulation, latest: Simulation) {
  if (current.company !== latest.company || current.basis !== latest.basis || current.filters !== latest.filters
    || simulationEntries(current).some(simulationChanged) || simulationSourceMatches(current, latest)) return current;
  return { ...latest, name: current.name };
}

export function parseSimulationAmount(value: string) {
  const clean = value.trim().replace(/^R\$\s*/, "");
  if (!/^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/.test(clean)) throw new Error("Informe um valor como 1.234,56 ou -1.234,56.");
  return cents(Number(clean.replace(/\./g, "").replace(",", ".")));
}
