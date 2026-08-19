#!/usr/bin/env node
/**
 * Remote (HTTP) entry point — Streamable HTTP transport, stateless.
 *
 * Each user authenticates with their OWN CODASMS key, sent as a Bearer token on
 * the request, so one hosted instance serves many resellers without ever storing
 * a key. A fresh server + transport is built per request (stateless mode).
 *
 * Runs on any Node host (Deno Deploy, Railway, Fly, a container). For Cloudflare
 * Workers, swap this Node http server for the Workers fetch handler — the
 * server factory in ./server.ts is transport-agnostic and stays unchanged.
 */
import { createServer as createHttp, IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";

const PORT = parseInt(process.env.PORT || "8080", 10);
const BASE = process.env.CODASMS_API_BASE || undefined;
const MAX_PRICE = process.env.CODASMS_MAX_PRICE_CENTS
  ? parseInt(process.env.CODASMS_MAX_PRICE_CENTS, 10)
  : undefined;

function bearer(req: IncomingMessage): string | null {
  const h = req.headers["authorization"];
  if (!h || Array.isArray(h)) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : undefined); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const httpServer = createHttp(async (req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    return sendJson(res, 200, { ok: true, service: "codasms-mcp" });
  }
  if (req.method !== "POST" || !(req.url === "/mcp" || req.url === "/")) {
    return sendJson(res, 404, { error: "Use POST /mcp with an MCP request and a Bearer CODASMS key." });
  }

  const apiKey = bearer(req);
  if (!apiKey) {
    return sendJson(res, 401, {
      jsonrpc: "2.0",
      error: { code: -32001, message: "Missing Bearer token. Send your CODASMS reseller key: Authorization: Bearer coda_live_..." },
      id: null,
    });
  }

  let body: unknown;
  try { body = await readBody(req); }
  catch { return sendJson(res, 400, { error: "Invalid JSON body." }); }

  try {
    // Stateless: a new server + transport per request.
    const server = createServer({ apiKey, base: BASE, maxPriceCents: MAX_PRICE });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (e) {
    if (!res.headersSent) {
      sendJson(res, 500, {
        jsonrpc: "2.0",
        error: { code: -32603, message: e instanceof Error ? e.message : "Internal error" },
        id: null,
      });
    }
  }
});

httpServer.listen(PORT, () => {
  console.error(`codasms-mcp (http) listening on :${PORT}  — POST /mcp with Authorization: Bearer <coda_live_...>`);
});
