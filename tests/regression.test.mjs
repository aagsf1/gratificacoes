import assert from "node:assert/strict";
import { INITIAL_DATA } from "../seed.js";
import { fromDecimal4, linkedValueFromPercent, summarize } from "../calc.js";

const types = INITIAL_DATA.types.map(type => ({ ...type, id: type.codigo, percentual_com_vinculo: INITIAL_DATA.percentage }));
const records = INITIAL_DATA.records.map(record => ({ ...record, tipo_id: record.tipo_codigo, ativo: true }));
const { rows, totals } = summarize(records, types, INITIAL_DATA.budget);
const byCode = Object.fromEntries(rows.map(row => [row.codigo, row]));

assert.equal(totals.count, 78);
assert.equal(totals.linked, 66);
assert.equal(totals.unlinked, 12);
assert.equal(fromDecimal4(totals.paid4).toFixed(4), "821607.0825");
assert.equal(fromDecimal4(totals.budget4).toFixed(4), "828146.7700");
assert.equal(fromDecimal4(totals.balance4).toFixed(4), "6539.6875");
assert.equal(fromDecimal4(linkedValueFromPercent("11870.00", "65.00")).toFixed(4), "7715.5000");
assert.deepEqual(Object.keys(byCode).sort(), ["CJ-01", "CJ-02", "CJ-03", "CJ-04"]);
assert.deepEqual([byCode["CJ-04"].linked,byCode["CJ-04"].unlinked], [2,0]);
assert.deepEqual([byCode["CJ-03"].linked,byCode["CJ-03"].unlinked], [33,6]);
assert.deepEqual([byCode["CJ-02"].linked,byCode["CJ-02"].unlinked], [10,4]);
assert.deepEqual([byCode["CJ-01"].linked,byCode["CJ-01"].unlinked], [21,2]);
assert.equal(fromDecimal4(byCode["CJ-04"].paid4).toFixed(4), "24456.8090");
assert.equal(fromDecimal4(byCode["CJ-03"].paid4).toFixed(4), "457457.8185");
assert.equal(fromDecimal4(byCode["CJ-02"].paid4).toFixed(4), "153926.9550");
assert.equal(fromDecimal4(byCode["CJ-01"].paid4).toFixed(4), "185765.5000");
assert.ok(INITIAL_DATA.records.every(record => !record.servidor_nome || /^Servidor \d{3}$/.test(record.servidor_nome)), "A base pública deve conter apenas pseudônimos de servidores");
console.log("Regressão validada: 78 registros e R$ 821.607,0825 pagos.");
