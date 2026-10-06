import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, MAX_IMPORT_BYTES } from "../src/services/portfolioImport.service.js";
import { PERMISSIONS, ROLE_PERMISSIONS, permissionsForRoles } from "../src/config/permissions.js";

describe("portfolio import structure analysis", () => {
  test("parses UTF-8 CSV quoting, escaped quotes and line breaks structurally", () => {
    assert.deepEqual(parseCsv(Buffer.from('Nombre,Nota\r\n"Cliente, S.A.","Línea 1\nLínea ""2"""\r\n', "utf8")), [
      ["Nombre", "Nota"], ["Cliente, S.A.", 'Línea 1\nLínea "2"'],
    ]);
  });
  test("rejects empty, invalid UTF-8 and malformed CSV safely", () => {
    for (const [input, code] of [[Buffer.alloc(0), "EMPTY_FILE"], [Buffer.from([0xff]), "INVALID_ENCODING"], [Buffer.from('a,b\n"x,y\n'), "INVALID_CSV"]]) {
      assert.throws(() => parseCsv(input), error => error.code === code && error.status === 400);
    }
  });
  test("bounds row and column counts and records oversized headers as structural errors", () => {
    assert.throws(() => parseCsv(Buffer.from(`${Array(202).fill("x").join(",")}\n`)), error => error.code === "TOO_MANY_COLUMNS");
    assert.throws(() => parseCsv(Buffer.from(`h\n${"x\n".repeat(10002)}`)), error => error.code === "TOO_MANY_ROWS");
  });
  test("keeps the upload bounded and grants the dedicated permission only to admin", () => {
    assert.equal(MAX_IMPORT_BYTES, 2 * 1024 * 1024);
    assert.ok(PERMISSIONS.some(permission => permission.name === "portfolio.import" && permission.implemented));
    assert.ok(permissionsForRoles([{ name: "admin" }]).includes("portfolio.import"));
    assert.equal(ROLE_PERMISSIONS.supervisor.includes("portfolio.import"), false);
    assert.equal(ROLE_PERMISSIONS.collector.includes("portfolio.import"), false);
    assert.equal(permissionsForRoles([{ name: "collector" }]).includes("portfolio.import"), false);
  });
});
