import test from "node:test";
import assert from "node:assert/strict";
import { learnerReference } from "./integrations/sunpay";

const school = { shortcode: "998877", merchantRef: "SP3" };
test("SunPay account numbers give the learner's admission number", () => {
  assert.equal(learnerReference({ externalRef: "998877#ADM123" }, school), "ADM123");
  assert.equal(learnerReference({ externalRef: "998877 # adm 123 " }, school), "adm 123");
  assert.equal(learnerReference({ externalRef: "998877", subReference: "ADM123" }, school), "ADM123");
  assert.equal(learnerReference({ externalRef: "SP3", subReference: "ADM123" }, school), "ADM123");
});
test("the school's own number alone names no learner", () => {
  assert.equal(learnerReference({ externalRef: "998877", subReference: null }, school), undefined);
  assert.equal(learnerReference({ externalRef: "998877#" }, school), undefined);
  assert.equal(learnerReference({ externalRef: "sp3", subReference: "#" }, school), undefined);
  assert.equal(learnerReference({}, school), undefined);
});
