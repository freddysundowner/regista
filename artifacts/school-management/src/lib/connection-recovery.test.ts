import test from "node:test";
import assert from "node:assert/strict";
import { isConnectionFailure, retryRead } from "./connection-recovery";

test("temporary browser and gateway failures recover without retrying auth errors or programming exceptions", () => {
  for (const error of [new TypeError("Failed to fetch"), new TypeError("Load failed"), new TypeError("NetworkError when attempting to fetch resource."), { status: 502 }, { status: 503 }, { status: 504 }]) {
    assert.equal(isConnectionFailure(error), true);
    assert.equal(retryRead(0, error), true);
    assert.equal(retryRead(3, error), false);
  }
  for (const error of [{ status: 401 }, { status: 403 }, { status: 402 }, new TypeError("Cannot read properties of undefined"), new DOMException("Aborted", "AbortError"), null]) {
    assert.equal(isConnectionFailure(error), false);
  }
  for (const status of [400, 401, 402, 403, 404, 409, 429]) assert.equal(retryRead(0, { status }), false);
});
