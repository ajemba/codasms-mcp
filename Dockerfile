# Lets MCP registries (Glama, etc.) build, start, and introspect this server.
# Introspection (tools/list) makes NO API call, so a format-valid placeholder
# key is enough to pass health checks. Real use requires the user's own
# CODASMS_API_KEY (coda_live_...), supplied at runtime and never baked in.
FROM node:20-slim
WORKDIR /app

# Install deps (incl. TypeScript) and build dist/
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Format-valid placeholder so the stdio server starts for introspection.
# Override with a real key at runtime for actual use.
ENV CODASMS_API_KEY=coda_live_introspection_placeholder

ENTRYPOINT ["node", "dist/stdio.js"]
