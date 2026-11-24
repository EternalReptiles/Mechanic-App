# Spannr – Stripe integration plan

Generated with Stripe's implementation planner (`stripe tools plan`, guide `iguide_61VoYEABoV6EpLTCK41K9RlPQhG6Z`, status: accepted)
for an Australian SaaS platform for mobile mechanics and workshops. Test environment: Stripe sandbox "Spannr sandbox" (AU, AUD).

## Recommended setup

### 1. Connect – mechanics take card payments from their own customers
- **Platform type:** SaaS platform (mechanics' customers buy from the mechanic; Spannr is the software behind it).
- **Charge type:** **Direct charges** – the mechanic is the merchant of record; money settles in their Stripe balance and pays out to their bank. Spannr never holds funds.
- **Pricing & risk:** **Stripe owns pricing** (mechanics pay Stripe's card fees directly), **Stripe owns loss liability** and **manages fraud**.
- **Dashboard:** connected accounts get the **full Stripe Dashboard** (fits LNC's existing Stripe account); Spannr surfaces Stripe features with **embedded components** and links out to the Dashboard.
- **Accounts:** create connected accounts with **Accounts v2** (`/v2/core/accounts`, `configuration.merchant`) – never the legacy `type` parameter.
- **Onboarding:** **embedded onboarding** inside Spannr (no custom API onboarding).
- **Ready to take payments:** check the account's `configuration.merchant` card-payments capability status.
- **Monetisation:**
  - **Subscription ("SaaS fee"):** bill each mechanic's connected account directly – the v2 account carries both `merchant` and `customer` configurations and is passed as `customer_account` (no separate v1 Customer objects). Docs: https://docs.stripe.com/connect/saas/tasks/service-fee
  - **Per-payment fee:** `application_fee_amount` on direct charges (e.g. ~0.5%), on top of Stripe's fees. Docs: https://docs.stripe.com/connect/saas/tasks/app-fees

### 2. Billing – Spannr's own subscription
- **Checkout:** Stripe-hosted Checkout in subscription mode (redirect). https://docs.stripe.com/billing/subscriptions/build-subscriptions?payment-ui=checkout&ui=stripe-hosted
- **Pricing:** flat rate per business (e.g. monthly / annual).
- **Trial:** free access first, no card at sign-up; upgrade to paid later.
- **Self-service:** Stripe **Customer Portal** (upgrade/downgrade, update card, cancel).
- **Failed payments:** **Smart Retries + automated emails** (Dashboard settings, no code).
- **GST:** **Stripe Tax** with an Australian GST registration (read the tax setup steps before enabling `automatic_tax`).

### 3. Invoicing – repair invoices
- **Create:** automatically from a business event (job invoiced in Spannr) with the Invoicing API, on the mechanic's connected account.
- **Branding:** each mechanic's logo/colours in Stripe Dashboard → Settings → Branding.
- **Collect:** **Hosted Invoice Page** (`hosted_invoice_url`) shared by SMS/email, plus **Invoice Reminders**.
- **Reconcile:** webhook-driven updates into Spannr – `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `credit_note.created`.

## Rules we follow (Stripe best practices)
- Latest API version and SDK; instantiate a `StripeClient` (no global API key).
- Never pass `payment_method_types` (dynamic payment methods).
- Webhooks are required – fulfilment happens in webhook handlers, not on success pages.
- Use separate sandboxes for development; prefer restricted API keys (`rk_`) in production.

## Blueprints returned by the planner
- `blueprint-subscription-billing-checkout.md` – product + recurring price, subscription Checkout Session, lifecycle webhooks.
- `blueprint-customer-portal-integration-accounts-v2.md` – portal configuration, portal sessions, portal-driven changes.
