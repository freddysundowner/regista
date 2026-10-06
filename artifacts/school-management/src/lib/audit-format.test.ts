import test from "node:test";
import assert from "node:assert/strict";
import { actionLabel, changeRows, displayValue, subjectLabel } from "./audit-format";

test("audit titles explain known actions and unknown actions remain readable", () => {
  assert.equal(actionLabel({ action: "billing.payment_reversed" }), "Subscription payment reversed");
  assert.equal(actionLabel({ action: "admin.updated", before: { isActive: true }, after: { isActive: false } }), "Administrator disabled");
  assert.equal(actionLabel({ action: "created", entityType: "academic_year" }), "Created · Academic year");
  assert.equal(actionLabel({ action: "tenant.custom_action" }), "Support session: Custom action");
});
test("change comparison omits unchanged, technical and credential fields but preserves paid amounts", () => {
  const before = { id: "1", paid: "0", isActive: true, settings: { threshold: 50 }, updatedAt: "old", passwordHash: "redacted" };
  const after = { ...before, paid: "40.05", settings: { threshold: 60 }, updatedAt: "new" };
  assert.deepEqual(changeRows(before, after).map(r => r.key), ["paid", "settings.threshold"]);
  assert.equal(changeRows(null, { schoolId: "x", amount: "50" }).length, 1);
  assert.equal(displayValue(false), "No");
  assert.equal(displayValue(null), "Not set");
  assert.equal(subjectLabel({ action: "updated", after: { firstName: "Test", lastName: "Learner" } }), "Test Learner");
});
