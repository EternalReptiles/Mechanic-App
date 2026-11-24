# Set up Customer Portal integration

Configure Stripe's customer portal, create authenticated Accounts v2 portal sessions, handle portal-driven billing changes, and launch safely.

## Configuration

### Settings
Settings are integration choices that often become constants in the integrator's code. Changing one can change what product is being sold or how the integration behaves.

_No settings defined._

### Parameters
Parameters are variables gathered from the user or application for each run—for example, including the customer's email address when creating each payment.

- Return URL (`integration-config:return_url`, string): URL to which customers return after leaving the portal. Set this when a Dashboard default return URL is not configured.
- Customer Account ID (`runtime-params:customer_account_id`, string): The Accounts v2 customer-configured account identifier for the authenticated customer.

## Steps

API calls use curl for standardization, but your language's SDK is the preferred way of expressing all API calls.

### 1. Configure the customer portal

Define the portal features customers can use in Stripe. If you want to allow customers to upgrade, downgrade, or change the quantities of their subscriptions, you must configure the products and prices that the portal can offer.

Step outputs (reference as `${step.customer-portal-integration-accounts-v2--configure-portal:name}`):

```
[
  {
    "name": "configure-portal-settings_id",
    "source": "${node.customer-portal-integration-accounts-v2--configure-portal--configure-portal-settings:id}"
  }
]
```

#### 1.1 Configure portal settings

Node key: `customer-portal-integration-accounts-v2--configure-portal--configure-portal-settings`

Create a portal configuration to define what features are available in the portal. You can reuse the configuration across sessions.

Request key: `create-portal-configuration`

```
POST /v1/billing_portal/configurations
  -d '{"features":{"invoice_history":{"enabled":"true"},"payment_method_update":{"enabled":"true"},"subscription_cancel":{"enabled":"true"}}}'
```

### 2. Create a portal session and redirect the customer

After authenticating the user in your application, create a short-lived portal session on your server and redirect the user to its URL.

Step parameter bindings (authored; not evaluated):

```
{
  "return_url": "${blueprint_params.integration-config:return_url}",
  "customer_account_id": "${blueprint_params.runtime-params:customer_account_id}",
  "configure-portal-settings_id": "${step.customer-portal-integration-accounts-v2--configure-portal:configure-portal-settings_id}"
}
```

#### 2.1 Create a portal session

Node key: `customer-portal-integration-accounts-v2--create-portal-session--create-session`

When a customer wants to manage their billing or invoicing, create a new portal session and redirect them to the session’s url.

Request key: `create-session-request`

```
POST /v1/billing_portal/sessions
  -d '{"customer_account":"${params:customer_account_id}","return_url":"${params:return_url}","configuration":"${params:configure-portal-settings_id}"}'
```

#### 2.2 Redirect the customer to the portal

Node key: `customer-portal-integration-accounts-v2--create-portal-session--redirect-to-portal`

Redirect the authenticated customer to the short-lived URL returned by the portal-session request.

Use the URL immediately in the authenticated browser flow.

Redirect the customer to the portal

Redirect your user to the following URL: `${node.customer-portal-integration-accounts-v2--create-portal-session--create-session:url}`. It is short-lived. Long-lived links, like those included in emails, should go to an endpoint you control; create a fresh redirect link there on demand.

### 3. Handle portal-driven billing changes

Register server-side webhook handlers so your application stays synchronized when customers change subscriptions or payment methods in the portal.

#### 3.1 Handle subscription updates

Node key: `customer-portal-integration-accounts-v2--handle-webhooks--subscription-updated-webhook`

Synchronize subscription upgrades, downgrades, quantity changes, and scheduled cancellations in your application.

- Event: `customer.subscription.updated`

Event matching requirements:

```
{
  "eventPayloadType": "snapshot",
  "onApiRequest": {
    "chapterKey": "customer-portal-integration-accounts-v2--create-portal-session",
    "nodeKey": "customer-portal-integration-accounts-v2--create-portal-session--create-session",
    "fixtureKey": "create-session-request"
  }
}
```

Make sure to verify events came from Stripe; our SDKs can do it easily with a webhook signing key.

#### 3.2 Handle subscription cancellations

Node key: `customer-portal-integration-accounts-v2--handle-webhooks--subscription-deleted-webhook`

Revoke or adjust product access when a subscription cancellation becomes effective.

- Event: `customer.subscription.deleted`

Event matching requirements:

```
{
  "eventPayloadType": "snapshot",
  "onApiRequest": {
    "chapterKey": "customer-portal-integration-accounts-v2--create-portal-session",
    "nodeKey": "customer-portal-integration-accounts-v2--create-portal-session--create-session",
    "fixtureKey": "create-session-request"
  }
}
```

Make sure to verify events came from Stripe; our SDKs can do it easily with a webhook signing key.

#### 3.3 Handle payment method additions

Node key: `customer-portal-integration-accounts-v2--handle-webhooks--payment-method-attached-webhook`

Synchronize a payment method added through the portal when your application stores or displays that state.

- Event: `payment_method.attached`

Event matching requirements:

```
{
  "eventPayloadType": "snapshot",
  "onApiRequest": {
    "chapterKey": "customer-portal-integration-accounts-v2--create-portal-session",
    "nodeKey": "customer-portal-integration-accounts-v2--create-portal-session--create-session",
    "fixtureKey": "create-session-request"
  }
}
```

Make sure to verify events came from Stripe; our SDKs can do it easily with a webhook signing key.

#### 3.4 Handle payment method removals

Node key: `customer-portal-integration-accounts-v2--handle-webhooks--payment-method-detached-webhook`

Synchronize a payment method removed through the portal when your application stores or displays that state.

- Event: `payment_method.detached`

Event matching requirements:

```
{
  "eventPayloadType": "snapshot",
  "onApiRequest": {
    "chapterKey": "customer-portal-integration-accounts-v2--create-portal-session",
    "nodeKey": "customer-portal-integration-accounts-v2--create-portal-session--create-session",
    "fixtureKey": "create-session-request"
  }
}
```

Make sure to verify events came from Stripe; our SDKs can do it easily with a webhook signing key.

#### 3.5 Handle Accounts v2 customer-configuration updates

Node key: `customer-portal-integration-accounts-v2--handle-webhooks--customer-account-updated-webhook`

Handle updates to the customer account configuration, including changes to configuration.customer.billing.default_payment_method.

- Event: `v2.core.account[configuration.customer].updated`

Event matching requirements:

```
{
  "eventPayloadType": "thin",
  "onApiRequest": {
    "chapterKey": "customer-portal-integration-accounts-v2--create-portal-session",
    "nodeKey": "customer-portal-integration-accounts-v2--create-portal-session--create-session",
    "fixtureKey": "create-session-request"
  }
}
```

Make sure to verify events came from Stripe; our SDKs can do it easily with a webhook signing key.
