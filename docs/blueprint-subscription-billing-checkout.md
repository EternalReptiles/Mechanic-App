# Create a subscription with Hosted Checkout

Set up recurring subscription billing with hosted Checkout by defining a product and recurring price, creating a subscription Checkout Session, and handling lifecycle webhooks.

This integration covers the required hosted Checkout subscription path: create a product and recurring price, create a Checkout Session in subscription mode, redirect the customer to Checkout, and handle lifecycle webhooks to provision and maintain access. Optional customer-record, promotion-code, and post-checkout retrieval paths are intentionally omitted.

## Configuration

### Settings
Settings are integration choices that often become constants in the integrator's code. Changing one can change what product is being sold or how the integration behaves.

_No settings defined._

### Parameters
Parameters are variables gathered from the user or application for each run—for example, including the customer's email address when creating each payment.

- Product Description (`integration-config:product_description`, string): Description of the subscription product
- Product name (`integration-config:product_name`, string): Name of the subscription product.
- Currency (`integration-config:currency`, string): Three-letter ISO currency code for subscription pricing.
- Billing interval (`integration-config:billing_interval`, enum): Recurring billing frequency.
- Subscription price (`integration-config:unit_amount`, string): Price in the smallest currency unit, such as cents for USD.
- Cancel URL (`integration-config:cancel_url`, string): URL to redirect to if the customer cancels Checkout.
- Success URL (`integration-config:success_url`, string): URL to redirect to after successful Checkout completion.

## Steps

API calls use curl for standardization, but your language's SDK is the preferred way of expressing all API calls.

### 1. Define the subscription product and recurring price

Create the product and recurring price that customers subscribe to.

Step parameter bindings (authored; not evaluated):

```
{
  "unit_amount": "${blueprint_params.integration-config:unit_amount}",
  "billing_interval": "${blueprint_params.integration-config:billing_interval}",
  "currency": "${blueprint_params.integration-config:currency}",
  "product_name": "${blueprint_params.integration-config:product_name}",
  "product_description": "${blueprint_params.integration-config:product_description}"
}
```

Step outputs (reference as `${step.subscription-billing-checkout--create-product-and-price:name}`):

```
[
  {
    "name": "create-price_id",
    "source": "${node.subscription-billing-checkout--create-product-and-price--create-price:id}"
  }
]
```

#### 1.1 Create a subscription product

Node key: `subscription-billing-checkout--create-product-and-price--create-product`

Create the product that represents the subscription offering.

Request key: `create-product`

```
POST /v1/products
  -d '{"name":"${params:product_name}","description":"${params:product_description}"}'
```

#### 1.2 Create a recurring price

Node key: `subscription-billing-checkout--create-product-and-price--create-price`

Create the recurring price used by Checkout to start the subscription.

Request key: `create-price`

```
POST /v1/prices
  -d '{"product":"${node.subscription-billing-checkout--create-product-and-price--create-product:id}","unit_amount":"${params:unit_amount}","currency":"${params:currency}","recurring":{"interval":"${params:billing_interval}"}}'
```

### 2. Create a subscription Checkout Session

Create a hosted Checkout Session in subscription mode, then direct the customer to its URL.

Step parameter bindings (authored; not evaluated):

```
{
  "success_url": "${blueprint_params.integration-config:success_url}",
  "cancel_url": "${blueprint_params.integration-config:cancel_url}",
  "create-price_id": "${step.subscription-billing-checkout--create-product-and-price:create-price_id}"
}
```

Step outputs (reference as `${step.subscription-billing-checkout--checkout-session:name}`):

```
[
  {
    "name": "create-checkout-session_id",
    "source": "${node.subscription-billing-checkout--checkout-session--create-checkout-session:id}"
  }
]
```

#### 2.1 Create a Checkout Session

Node key: `subscription-billing-checkout--checkout-session--create-checkout-session`

Add a checkout button to your website that calls a server-side endpoint to create a Checkout Session. When clicked, create a hosted Checkout Session that creates a subscription when the customer completes payment.

Request key: `create-checkout-session`

```
POST /v1/checkout/sessions
  -d '{"mode":"subscription","line_items":[{"price":"${params:create-price_id}","quantity":1}],"success_url":"${params:success_url}","cancel_url":"${params:cancel_url}","ui_mode":"hosted"}'
```

#### 2.2 Complete Checkout

Node key: `subscription-billing-checkout--checkout-session--redirect-to-checkout`

Direct the customer to the Checkout Session URL to enter payment details and start the subscription.

Redirect the customer to the URL returned by the Checkout Session.

Complete Checkout

Redirect your user to the following URL: `${node.subscription-billing-checkout--checkout-session--create-checkout-session:url}`. It is short-lived. Long-lived links, like those included in emails, should go to an endpoint you control; create a fresh redirect link there on demand.

### 3. Handle subscription lifecycle webhooks

Process webhook events to provision access, confirm successful renewals, and respond to failed payments. In production, set up a webhook endpoint and subscribe to the following event types.

Step parameter bindings (authored; not evaluated):

```
{
  "create-checkout-session_id": "${step.subscription-billing-checkout--checkout-session:create-checkout-session_id}"
}
```

#### 3.1 Handle Checkout completion

Node key: `subscription-billing-checkout--handle-webhooks--checkout-completed-webhook`

On checkout.session.completed, provision access and persist the subscription identifier from the event payload.

- Event: `checkout.session.completed`

Event matching requirements:

```
{
  "objectId": "${params:create-checkout-session_id}",
  "eventPayloadType": "snapshot"
}
```

Make sure to verify events came from Stripe; our SDKs can do it easily with a webhook signing key.

#### 3.2 Handle successful recurring payments

Node key: `subscription-billing-checkout--handle-webhooks--invoice-paid-webhook`

On invoice.paid, confirm that recurring billing succeeded and maintain access. Continue to provision each month (if billing monthly) as you receive invoice.paid events.

- Event: `invoice.paid`

Event matching requirements:

```
{
  "eventPayloadType": "snapshot",
  "onApiRequest": {
    "chapterKey": "subscription-billing-checkout--checkout-session",
    "nodeKey": "subscription-billing-checkout--checkout-session--create-checkout-session",
    "fixtureKey": "create-checkout-session"
  }
}
```

Make sure to verify events came from Stripe; our SDKs can do it easily with a webhook signing key.

#### 3.3 Handle failed payments

Node key: `subscription-billing-checkout--handle-webhooks--listen-invoice-payment-failed`

On invoice.payment_failed, notify the customer, send them to the customer portal to update their payment method, and apply the integration's failed-payment policy.

- Event: `invoice.payment_failed`

Event matching requirements:

```
{
  "eventPayloadType": "snapshot",
  "onApiRequest": {
    "chapterKey": "subscription-billing-checkout--checkout-session",
    "nodeKey": "subscription-billing-checkout--checkout-session--create-checkout-session",
    "fixtureKey": "create-checkout-session"
  }
}
```

Make sure to verify events came from Stripe; our SDKs can do it easily with a webhook signing key.
