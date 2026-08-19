#!/usr/bin/env node
/**
 * Local (stdio) entry point. Reads the API key from the environment and speaks
 * MCP over stdin/stdout — the transport used by Claude Desktop, Cursor, etc.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  const apiKey = process.env.CODASMS_API_KEY;
  if (!apiKey) {
    console.error("CODASMS_API_KEY is not set. Get a key at https://codasms.com/reseller and export it.");
    process.exit(1);
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
