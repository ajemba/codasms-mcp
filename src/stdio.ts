#!/usr/bin/env node
/**
 * Local (stdio) entry point. Reads the API key from the environment and speaks
 * MCP over stdin/stdout — the transport used by Claude Desktop, Cursor, etc.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  // NOTE: we intentionally do NOT exit when the key is missing. The server must
  // start and expose tools/list so registries (Glama, MCP inspector) can
  // introspect it with no secret. Tool CALLS return a friendly error until a
  // real key is provided.
  const apiKey = process.env.CODASMS_API_KEY ?? "";
  if (!apiKey) {
    console.error("CODASMS_API_KEY is not set \u2014 starting in introspection mode; tool calls will fail until you set a coda_live_ key from https://codasms.com/reseller.");
  }
  const base = process.env.CODASMS_API_BASE || undefined;
  const maxPriceCents = process.env.CODASMS_MAX_PRICE_CENTS
    ? parseInt(process.env.CODASMS_MAX_PRICE_CENTS, 10)
    : undefined;

  const server = createServer({ apiKey, base, maxPriceCents });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server now runs until the client disconnects.
  console.error("codasms-mcp (stdio) ready.");
}

main().catch((e) => {
  console.error("Fatal:", e instanceof Error ? e.message : e);
  process.exit(1);
});
