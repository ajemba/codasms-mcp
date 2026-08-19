/**
 * Smithery TypeScript-runtime entry.
 *
 * Smithery builds this module's default export into a hosted, remotely-accessible
 * MCP server over HTTP. Each user supplies their own CODASMS key via Smithery's
 * config UI (nothing is stored server-side). We reuse the shared factory in
 * ./server.ts so the hosted server exposes the exact same 7 tools as the stdio
 * and self-hosted HTTP entries.
 */
import { z } from "zod";
import { createServer as buildCodaServer } from "./server.js";

export const configSchema = z.object({
  codasmsApiKey: z
    .string()
    .describe("Your coda_live_ reseller key from https://codasms.com/reseller"),
  maxPriceCents: z
    .number()
    .int()
    .optional()
    .describe(
      "Optional cap (US cents) — get_number refuses any number priced above this."
    ),
});

export default function createServer({
  config,
}: {
  config: z.infer<typeof configSchema>;
}) {
  const server = buildCodaServer({
    apiKey: config.codasmsApiKey,
    maxPriceCents: config.maxPriceCents,
  });
  return server.server;
}
