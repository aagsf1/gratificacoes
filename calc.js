const SCALE = 10000n;

export const CSJT_PREVIOUS_COUNTS = Object.freeze({
  "CJ-04": Object.freeze({ linked: 2, unlinked: 0 }),
  "CJ-03": Object.freeze({ linked: 32, unlinked: 4 }),
  "CJ-02": Object.freeze({ linked: 10, unlinked: 3 }),
  "CJ-01": Object.freeze({ linked: 0, unlinked: 0 }),
});

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
    row.paid4 += paidValue(type.valor_integral, record.com_vinculo, type.percentual_com_vinculo ?? "0.6500");
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

export function summarizeCsjt(records, types, budget) {
  const activeRecords = records.filter(item => item.ativo !== false);
  const previousRecords = types.flatMap(type => {
    const counts = CSJT_PREVIOUS_COUNTS[type.codigo] ?? { linked: 0, unlinked: 0 };
    const tipoId = type.id ?? type.codigo;
    return [
      ...Array.from({ length: counts.linked }, () => ({ tipo_id: tipoId, com_vinculo: true, ativo: true })),
      ...Array.from({ length: counts.unlinked }, () => ({ tipo_id: tipoId, com_vinculo: false, ativo: true })),
    ];
  });
  return {
    previous: summarize(previousRecords, types, budget),
    current: summarize(activeRecords, types, budget),
  };
}
