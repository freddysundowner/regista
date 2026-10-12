/** Lets the payment pipeline ask the job worker to process new payments now, without importing the worker. */
let nudger: (() => void) | null = null;
export function setPaymentNudger(fn: (() => void) | null) { nudger = fn; }
/** No-op when no worker runs in this process (tests, tools); the minute sweep still picks payments up. */
export function nudgePayments() { nudger?.(); }
