/**
 * Shared MCP server factory. Both the stdio entry (env key) and the HTTP/remote
 * entry (per-request Bearer key) build their server from here, so the two
 * transports expose an identical tool set.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CodaClient, CodaApiError, DEFAULT_BASE } from "./client.js";

export interface ServerOptions {
  apiKey: string;
  base?: string;
  /** If set, get_number refuses any number priced above this (US cents). */
  maxPriceCents?: number;
}

const VERSION = "0.1.0";

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}
function fail(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}
function money(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function createServer(opts: ServerOptions): McpServer {
  const client = new CodaClient(opts.apiKey, opts.base ?? DEFAULT_BASE);
  const server = new McpServer({ name: "codasms", version: VERSION });

  const guard = async <T>(fn: () => Promise<T>): Promise<T | { __err: string }> => {
    try { return await fn(); }
    catch (e) {
      if (e instanceof CodaApiError) return { __err: e.message };
      return { __err: e instanceof Error ? e.message : String(e) };
    }
  };

  // ---- get_balance -------------------------------------------------------
  server.registerTool(
    "get_balance",
    {
      title: "Get balance",
      description: "Return the reseller account's current balance (what you can spend on numbers).",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      const r = await guard(() => client.balance());
      if ("__err" in r) return fail(r.__err);
      return ok(`Balance: ${money(r.balance_cents)} ${r.currency} (${r.balance_cents} cents).`);
    }
  );

  // ---- list_services -----------------------------------------------------
  server.registerTool(
    "list_services",
    {
      title: "List services",
      description:
        "List buyable services with live price and stock. STRONGLY prefer filtering by `service` and/or `country` — the unfiltered catalog is very large. `service` is a code like \"tg\" (Telegram); `country` is a country code like \"6\".",
      inputSchema: {
        service: z.string().optional().describe('Service code to filter by, e.g. "tg", "wa", "ig".'),
        country: z.string().optional().describe('Country code to filter by, e.g. "6".'),
        limit: z.number().int().min(1).max(100).optional().describe("Max services to list (default 40)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ service, country, limit }) => {
      const r = await guard(() => client.services({ service, country }));
      if ("__err" in r) return fail((r as any).__err);
      const services: any[] = (r as any).services ?? [];
      const n = limit ?? 40;
      const lines = services.slice(0, n).map(
        (s) => `- ${s.name} (${s.code}) — from ${money(s.from_cents)}, stock ${s.stock}`
      );
      const more = services.length > n ? `\n…and ${services.length - n} more (narrow with a filter).` : "";
      const stale = (r as any).stale ? " [catalog marked stale]" : "";
      return ok(
        `${services.length} service(s)${service || country ? " matching filter" : ""}${stale}:\n${lines.join("\n")}${more}`
      );
    }
  );

  // ---- list_countries ----------------------------------------------------
  server.registerTool(
    "list_countries",
    {
      title: "List countries",
      description: "List countries that currently have buyable numbers. Optionally filter to a single service.",
      inputSchema: {
        service: z.string().optional().describe('Service code to filter countries by, e.g. "tg".'),
        limit: z.number().int().min(1).max(300).optional().describe("Max countries to list (default 60)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ service, limit }) => {
      const r = await guard(() => client.countries({ service }));
      if ("__err" in r) return fail((r as any).__err);
      const countries: any[] = (r as any).countries ?? [];
      const n = limit ?? 60;
      const lines = countries.slice(0, n).map((c) => `- ${c.name} (code ${c.code}, ${c.iso})`);
      const more = countries.length > n ? `\n…and ${countries.length - n} more.` : "";
      return ok(`${countries.length} country(ies):\n${lines.join("\n")}${more}`);
    }
  );

  // ---- get_number (SPENDS money) ----------------------------------------
  server.registerTool(
    "get_number",
    {
      title: "Get a number",
      description:
        "Buy a phone number for a service in a country and return it. THIS CHARGES the reseller balance immediately (pay-per-code). If no code arrives within 20 minutes the order auto-refunds; you can also release() it early to refund now. Poll for the code with wait_for_otp using the returned order_id.",
      inputSchema: {
        service: z.string().describe('Service code, e.g. "tg" (Telegram), "wa" (WhatsApp).'),
        country: z.string().describe('Country code, e.g. "6". Use list_countries/list_services to find it.'),
        band: z.enum(["standard", "priority"]).optional().describe('Delivery tier. "priority" is a higher-reliability, pricier tier. Default "standard".'),
        max_price_cents: z.number().int().min(1).optional().describe("Refuse if the number would cost more than this (US cents). Overrides the server default."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ service, country, band, max_price_cents }) => {
      const cap = max_price_cents ?? opts.maxPriceCents;
      const tier: "standard" | "priority" = band ?? "standard";
      // Price guard: check the live cell price before buying.
      if (cap !== undefined) {
        const priced = await guard(() => client.services({ service, country }));
        if (!("__err" in priced)) {
          const cell = (priced as any)?.matrix?.[country]?.[service];
          const priceCents = cell ? (tier === "priority" ? cell.priority_cents : cell.standard_cents) : undefined;
          if (typeof priceCents === "number" && priceCents > cap) {
            return fail(
              `Refused: ${service}/${country} (${tier}) costs ${money(priceCents)}, above your cap of ${money(cap)}. Raise max_price_cents or pick another cell.`
            );
          }
        }
      }
      const r = await guard(() => client.createOrder(service, country, tier));
      if ("__err" in r) return fail((r as any).__err);
      const o = r as any;
      return ok(
        `Bought a number.\n- number: ${o.number}\n- order_id: ${o.order_id}\n- service/country: ${o.service}/${o.country} (${o.band})\n- charged: ${money(o.price_cents)}\n- expires in: ${o.expires_in_seconds}s\nNext: call wait_for_otp with order_id ${o.order_id} to get the code.`
      );
    }
  );

  // ---- wait_for_otp ------------------------------------------------------
  server.registerTool(
    "wait_for_otp",
    {
      title: "Wait for the OTP code",
      description:
        "Poll an order until its verification code arrives, it expires, or the timeout is hit. Returns the code when delivered. On timeout the number is still active — call again, or release() to refund now.",
      inputSchema: {
        order_id: z.number().int().describe("The order_id returned by get_number."),
        timeout_seconds: z.number().int().min(5).max(1200).optional().describe("How long to wait before giving up (default 180, max 1200)."),
        poll_interval_seconds: z.number().int().min(5).max(60).optional().describe("Seconds between polls (default 10, min 5 to respect the 60/min limit)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ order_id, timeout_seconds, poll_interval_seconds }) => {
      const timeout = (timeout_seconds ?? 180) * 1000;
      const interval = Math.max(5, poll_interval_seconds ?? 10) * 1000;
      const start = Date.now();
      let last = "";
      while (Date.now() - start < timeout) {
        const r = await guard(() => client.orderStatus(order_id, "poll"));
        if ("__err" in r) return fail((r as any).__err);
        const s = r as any;
        last = s.status;
        if (s.status === "delivered" && s.code) {
          return ok(`Code delivered for order ${order_id}: ${s.code}`);
        }
        if (s.status === "refunded") {
          return ok(`Order ${order_id} was refunded (expired or cancelled) before a code arrived. No charge stands.`);
        }
        await new Promise((res) => setTimeout(res, interval));
      }
      return ok(
        `Timed out after ${Math.round(timeout / 1000)}s waiting on order ${order_id} (last status: ${last || "active"}). The number is still active — call wait_for_otp again, or release(${order_id}) to refund now.`
      );
    }
  );

  // ---- check_order -------------------------------------------------------
  server.registerTool(
    "check_order",
    {
      title: "Check an order",
      description: "One-shot status check for an order (no waiting). Returns the current status and the code if it has arrived.",
      inputSchema: {
        order_id: z.number().int().describe("The order_id returned by get_number."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ order_id }) => {
      const r = await guard(() => client.orderStatus(order_id, "poll"));
      if ("__err" in r) return fail((r as any).__err);
      const s = r as any;
      if (s.status === "delivered" && s.code) return ok(`Order ${order_id}: delivered. Code: ${s.code}`);
      if (s.status === "refunded") return ok(`Order ${order_id}: refunded (no charge stands).`);
      return ok(`Order ${order_id}: ${s.status}${s.waiting ? " (waiting for code)" : ""}.`);
    }
  );

  // ---- release -----------------------------------------------------------
  server.registerTool(
    "release",
    {
      title: "Release (cancel & refund) a number",
      description:
        "Cancel an order and refund its cost immediately — unless the code already arrived, in which case there is nothing to refund and the code is returned.",
      inputSchema: {
        order_id: z.number().int().describe("The order_id to release."),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ order_id }) => {
      const r = await guard(() => client.orderStatus(order_id, "cancel"));
      if ("__err" in r) return fail((r as any).__err);
      const s = r as any;
      if (s.status === "delivered" && s.code) return ok(`Order ${order_id} already delivered; nothing to refund. Code: ${s.code}`);
      return ok(`Order ${order_id} released and refunded (status: ${s.status}).`);
    }
  );

  return server;
}
