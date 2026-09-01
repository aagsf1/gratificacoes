const SCALE = 10000n;

export function decimal4(value) {
  const normalized = String(value ?? 0).replace(",", ".");
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole || "0") * SCALE + BigInt((fraction + "0000").slice(0, 4));
}

export function fromDecimal4(value) { return Number(value) / Number(SCALE); }
export function linkedValueFromPercent(integral, percentage) {
  return decimal4(integral) * decimal4(percentage) / (100n * SCALE);
}
export function paidValue(integral, linked, percentage = "0.6500") {
  const amount = decimal4(integral);
  return linked ? amount * decimal4(percentage) / SCALE : amount;
}

export const CSJT_PREVIOUS_COUNTS = Object.freeze([
  Object.freeze({ codigo: "CJ-04", linked: 2, unlinked: 0 }),
  Object.freeze({ codigo: "CJ-03", linked: 32, unlinked: 4 }),
  Object.freeze({ codigo: "CJ-02", linked: 10, unlinked: 3 }),
  Object.freeze({ codigo: "CJ-01", linked: 0, unlinked: 0 }),
]);

function linkedAmount4(type) {
  return type.valor_com_vinculo != null
    ? decimal4(type.valor_com_vinculo)
    : paidValue(type.valor_integral, true, type.percentual_com_vinculo ?? "0.6500");
}

export function summarize(records, types, budget) {
  const byCode = Object.fromEntries(types.map(type => [type.codigo, {
    codigo: type.codigo, linked: 0, unlinked: 0, count: 0, paid4: 0n,
  }]));
  const typeMap = new Map(types.map(type => [type.id ?? type.codigo, type]));
  for (const record of records.filter(item => item.ativo !== false)) {
    const type = typeMap.get(record.tipo_id) ?? typeMap.get(record.tipo_codigo);
    if (!type || !byCode[type.codigo]) continue;
    const row = byCode[type.codigo];
    row.count += 1;
    record.com_vinculo ? row.linked += 1 : row.unlinked += 1;
    row.paid4 += record.com_vinculo ? linkedAmount4(type) : decimal4(type.valor_integral);
  }
  const rows = Object.values(byCode).sort((a, b) => b.codigo.localeCompare(a.codigo));
  const totals = rows.reduce((acc, row) => ({
    linked: acc.linked + row.linked,
    unlinked: acc.unlinked + row.unlinked,
    count: acc.count + row.count,
    paid4: acc.paid4 + row.paid4,
  }), { linked: 0, unlinked: 0, count: 0, paid4: 0n });
  totals.budget4 = decimal4(budget);
  totals.balance4 = totals.budget4 - totals.paid4;
  totals.execution = totals.budget4 ? Number(totals.paid4) / Number(totals.budget4) : 0;
  return { rows, totals };
}

export function summarizeCsjtPrevious(types, budget) {
  const typeMap = new Map(types.map(type => [type.codigo, type]));
  const rows = CSJT_PREVIOUS_COUNTS.map(counts => {
    const type = typeMap.get(counts.codigo);
    if (!type) throw new Error(`Parâmetro financeiro ausente para ${counts.codigo}.`);
    return {
      ...counts,
      count: counts.linked + counts.unlinked,
      paid4: linkedAmount4(type) * BigInt(counts.linked) + decimal4(type.valor_integral) * BigInt(counts.unlinked),
    };
  });
  const totals = rows.reduce((acc, row) => ({
    linked: acc.linked + row.linked,
    unlinked: acc.unlinked + row.unlinked,
    count: acc.count + row.count,
    paid4: acc.paid4 + row.paid4,
  }), { linked: 0, unlinked: 0, count: 0, paid4: 0n });
  totals.budget4 = decimal4(budget);
  totals.balance4 = totals.budget4 - totals.paid4;
  totals.execution = totals.budget4 ? Number(totals.paid4) / Number(totals.budget4) : 0;
  return { rows, totals };
}
