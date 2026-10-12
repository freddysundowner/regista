# Deployment modes

Rejista runs as one of two installation types, chosen with environment variables at deploy time.

## Hosted (multi-school, default)

Public landing page, self-registration, free trial, subscriptions, online payments and prepaid licence keys.

| Variable | Purpose |
|---|---|
| `DEPLOYMENT_MODE` | `hosted` or unset |
| `APP_BASE_URL` | Public HTTPS origin, used for webhook and callback URLs |
| `ENCRYPTION_KEY` | 32 random bytes (hex or base64). Encrypts gateway credentials and licence keys |
| `LICENCE_SIGNING_KEY` | Private key for issuing standalone licences. Keep secret; hosted server only |
| `SITE_URL` | Build-time. Public URL used for the canonical link, sitemap.xml and robots.txt |

The platform owner sets the price, period, learner limit, trial length and approval rule under
**Settings → Pricing & sign-up**, and configures M-Pesa (through SunPay), Stripe and Paystack under **Settings → Payments**.

Webhook URLs (shown in the Payments dialog once `APP_BASE_URL` is set):
- Stripe: `/api/billing/webhooks/stripe` (events `checkout.session.completed`, `checkout.session.expired`)
- Paystack: `/api/billing/webhooks/paystack`
- M-Pesa via SunPay: register `/api/billing/webhooks/sunpay` in SunPay → Settings → Webhooks (optional; signed with your webhook secret). Each STK request also sends its own callback URL.

Payments are also confirmed by polling the provider when the school returns to the Subscription page,
so a missing webhook delays confirmation but does not lose a payment.

## Standalone (one school on its own server)

No landing page, public registration, subscriptions or payment gateways. The server opens on sign-in.

| Variable | Purpose |
|---|---|
| `DEPLOYMENT_MODE` | `standalone` |
| `STANDALONE_LICENSING` | `licensed` (default) or `open` (no licence, no expiry) |
| `LICENCE_PUBLIC_KEY` | Public key matching the hosted server's `LICENCE_SIGNING_KEY` (licensed only) |

For a licensed install, issue a licence from the hosted platform under **Settings → Standalone installs**
(school name, optional expiry, optional learner limit). The school administrator pastes it under **Licence**.
Verification is offline: the install checks the Ed25519 signature, so licences cannot be edited or forged,
but they cannot be revoked remotely either. Issue short expiries if you need control.

Whoever has root on a self-hosted server can change its code or environment. Licensing there deters casual
misuse; it is not tamper-proof.

## Generating the licence key pair

```bash
pnpm --filter @workspace/api-server run licence:keygen
```

Put `LICENCE_SIGNING_KEY` on the hosted server only, and `LICENCE_PUBLIC_KEY` on every licensed standalone install.
Generate the pair once: replacing it invalidates every licence already issued.
