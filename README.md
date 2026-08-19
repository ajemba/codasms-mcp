<div align="center">

# CODASMS MCP Server

**Receive one-time SMS/OTP verification codes from your AI agent.**
An [MCP](https://modelcontextprotocol.io) server over the CODASMS Reseller API — get a number,
wait for the code, release it — across 700+ services and 180+ countries, pay only on delivery.

[![License: MIT](https://img.shields.io/badge/License-MIT-f2a93b.svg)](LICENSE)
&nbsp;![Transport: stdio + HTTP](https://img.shields.io/badge/transport-stdio%20%2B%20http-1f6feb.svg)

</div>

---

This server lets an AI agent (Claude Desktop, Cursor, or anything that speaks MCP) buy a phone
number and read the verification code programmatically. It's a thin wrapper over the public
[CODASMS Reseller API](https://codasms.com/docs/api) — it holds no logic of its own; every
charge and refund is decided server-side by the API.

You bring your own key. Getting one is free to sign up: **https://codasms.com/reseller**.

## Tools

| Tool | What it does |
|------|--------------|
| `get_balance` | Your current spendable balance. |
| `list_services` | Buyable services with live price + stock (filter by `service` / `country`). |
| `list_countries` | Countries with buyable numbers (optional `service` filter). |
| `get_number` | Buy a number for a service+country. **Charges your balance** (auto-refunds if no code in 20 min). |
| `wait_for_otp` | Poll an order until the code arrives (or timeout / refund). |
| `check_order` | One-shot status check for an order. |
| `release` | Cancel an order and refund now (unless the code already arrived). |

`get_number` accepts an optional `max_price_cents` (or set `CODASMS_MAX_PRICE_CENTS`) so an
autonomous agent can't buy a number priced above your cap.

## Quick start (local / stdio)

```bash
export CODASMS_API_KEY=coda_live_xxxxxxxx   # from https://codasms.com/reseller
npx codasms-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "codasms": {
      "command": "npx",
      "args": ["-y", "codasms-mcp"],
      "env": { "CODASMS_API_KEY": "coda_live_xxxxxxxx" }
    }
  }
}
```

Then ask: *"Get me a Telegram number in the UK and read the code."*

## Remote (HTTP) mode

The same tools are served over Streamable HTTP, so you can host one instance for many users —
each sends their **own** key as a Bearer token (nothing is stored server-side):

```bash
npm run build && npm run start:http     # listens on :8080, POST /mcp
```

```
POST /mcp
Authorization: Bearer coda_live_xxxxxxxx
Content-Type: application/json
```

`src/http.ts` is a portable Node server (Deno Deploy, Railway, Fly, any container). For
Cloudflare Workers, swap the Node `http` handler for a `fetch` handler — the server factory in
`src/server.ts` is transport-agnostic and stays unchanged.

## Configuration

| Env var | Purpose | Default |
|---------|---------|---------|
| `CODASMS_API_KEY` | Your `coda_live_` reseller key (stdio mode). | — (required) |
| `CODASMS_API_BASE` | API base URL. | `https://api.codasms.com` |
| `CODASMS_MAX_PRICE_CENTS` | Global cap for `get_number`, in US cents. | unset |
| `PORT` | HTTP mode port. | `8080` |

## Notes

- **Rate limit:** the API allows 60 requests/min per key; `wait_for_otp` polls no faster than
  once every 5s by default to stay well under it.
- **Money safety:** `get_number` spends real balance the moment it's called. If no code arrives,
  the order auto-refunds after 20 minutes, or call `release` to refund immediately.
- **Codes:** services and countries use the API's codes (e.g. `tg`, `wa`, country `6`) — use
  `list_services` / `list_countries` to discover them.

## Develop

```bash
npm install
npm run build      # tsc -> dist/
npm start          # stdio
```

## License

MIT — see [LICENSE](LICENSE).
