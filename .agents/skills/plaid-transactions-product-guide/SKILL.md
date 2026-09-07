---
name: plaid-transactions-product-guide
description: >-
  Implements Plaid Transactions in Sandbox end to end: /link/token/create,
  Plaid Link, /item/public_token/exchange, and /transactions/sync. Use when
  building, debugging, or reviewing bank linking, transaction sync, Link tokens,
  public_token/access_token exchange, Plaid webhooks, or Sandbox test users
  (user_good, user_transactions_dynamic) in frontend or backend code.
---

# Plaid Transactions Integration (Sandbox End-to-End Guide)

Follow this skill whenever implementing or debugging Plaid **Transactions** in **Sandbox**. Cover both frontend (Plaid Link) and backend (token create/exchange and sync). Ask for missing `client_id` and Sandbox `secret`. Never log or expose credentials or access tokens.

## Overview

This guide provides a complete, step-by-step integration of Plaid's **Transactions** product using the **Sandbox** environment. It is intended to support both **frontend** and **backend** implementations in a language-agnostic format with optional language-specific hints. The goal is to enable an AI agent or developer to execute a fully functional Plaid integration, from user bank linking to retrieving transaction data.

Assume the Plaid account already exists. The `PLAID_CLIENT_ID` and `PLAID_SECRET` environment variables are available in the development environment, and point to the current Sandbox environment.

This document references Plaid's official documentation using markdown links.

## Prerequisites

Before starting the integration, check with the user and make sure: 
- You have obtained your **client ID** and **Sandbox secret** from the dashboard.
- Your development environment can serve both **frontend** and **backend** logic. The backend must be able to securely manage sensitive credentials and handle API calls.

## Step 1: Backend - Create a Link Token

The Link Token is a short-lived token created server-side that configures the [Plaid Link](https://plaid.com/docs/link/index.html.md) flow. This token must be generated on your backend and passed to the frontend.

### 1.1 API Endpoint

`POST /link/token/create`

### 1.2 Required Parameters

Send a POST request to Plaid with the following JSON payload:

```json
{
  "client_id": "<your-client-id>",
  "secret": "<your-sandbox-secret>",
  "client_name": "<your-app-name>",
  "language": "en",
  "country_codes": ["US"],
  "user": {
    "client_user_id": "unique-user-id"
  },
  "products": ["transactions"]
}
```

**Optional Parameters:**

- `transactions.days_requested`: Integer between 1 and 730. Default is 90.
- `webhook`: URL to receive transaction webhooks (recommended in production).
- `redirect_uri`: Required only for OAuth-based institutions.

### 1.3 Example Response

```json
{
  "link_token": "link-sandbox-xxxxxxx",
  "expiration": "2025-05-08T10:00:00Z"
}
```

### 1.4 Notes

- Always generate a new Link Token for each session.
- This call must be done from a **secure server environment**.

## Step 2: Frontend - Initialize and Use Plaid Link

Use the `link_token` generated in Step 1 to initiate the Plaid Link flow on the frontend.

### 2.1 Add Plaid Link Script
And use the link as follows
```html
<script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
```
or React SDK
```
npm install --save react-plaid-link
```

### 2.2 Create Plaid Link Handler

```js
const handler = Plaid.create({
  token: "<LINK_TOKEN_FROM_BACKEND>",
  onSuccess: function (public_token, metadata) {
    // Send the public_token to backend
  },
  onExit: function (err, metadata) {
    // Handle user exit or error
  },
});
handler.open();
```

### 2.3 Sandbox Test Users

- `user_good` / `pass_good` – Successful link
- `user_transactions_dynamic` / any password – Simulates real-time updates

## Step 3: Backend - Exchange Public Token for Access Token

After the user completes the Link flow, your frontend receives a `public_token`. This must be exchanged on your backend for an `access_token`, which is used for authenticated Plaid API requests.

### 3.1 API Endpoint

`POST /item/public_token/exchange`

### 3.2 Request Body

```json
{
  "client_id": "<your-client-id>",
  "secret": "<your-sandbox-secret>",
  "public_token": "<token-from-frontend>"
}
```

### 3.3 Response Body

```json
{
  "access_token": "access-sandbox-xxxxxxx",
  "item_id": "item-id-123",
  "request_id": "request-id"
}
```

> Store `access_token` securely on your backend. Never expose it to the frontend.

## Step 4: Backend - Fetch Transactions Data

### `/transactions/sync`

This endpoint supports incremental updates and efficient polling.

#### 4.1 Initial Call

```json
{
  "client_id": "<your-client-id>",
  "secret": "<your-sandbox-secret>",
  "access_token": "<access_token>"
}
```

#### 4.2 Example Response

```json
{
  "added": [...],
  "modified": [...],
  "removed": [...],
  "next_cursor": "cursor-value",
  "has_more": false
}
```

Save `next_cursor` to resume syncs. If `has_more` is `true`, repeat call with cursor.

#### 4.3 Loop Example (Pseudo-code)

```python
cursor = ""
while True:
    response = transactions_sync(cursor)
    process(response.added)
    if not response.has_more:
        break
    cursor = response.next_cursor
```

## Additional Tips

- Use `transactions/sync` to keep user data fresh.
- Retry on `PRODUCT_NOT_READY` errors.
- Respect rate limits and add exponential backoff.

## Best Practice

- Do NOT log access tokens OR API credentials.
- Store access tokens securely in the backend database, do not save the access token in the frontend.
- If to build a prototype for simplicity, you could maintain an in memory mapping between the access token and user_id. You can create an endpoint `/api/update_access_token` so that you can update the access token for a specific user id. 
- Tokens persist indefinitely unless manually removed or revoked.
- Always validate request origin and authenticate client calls.
- Log all errors and exceptions with enough context to debug issues, but never log sensitive credentials or tokens.