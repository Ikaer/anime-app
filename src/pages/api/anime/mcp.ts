/**
 * POST /api/anime/mcp — the Model Context Protocol endpoint (read-only).
 *
 * A thin seam, like every other route here: the transport wiring lives below,
 * the tools live in `@/lib/mcp`. Lets an MCP client (Claude Code:
 * `claude mcp add --transport http anime-tracker http://<host>:12350/api/anime/mcp`)
 * ask about the local record — search it, read a title. It never writes.
 *
 * **Stateless transport** (`sessionIdGenerator: undefined`), which is the right
 * shape for a Next API route: no session map to leak between requests, no GET/SSE
 * stream to hold open, POST-only. `enableJsonResponse` makes each call a plain
 * request/response instead of a one-message SSE stream — there is nothing to
 * stream, every tool here is a synchronous read.
 *
 * ⚠️ Next's `bodyParser` stays ON: the parsed body is handed to `handleRequest`
 * as its third argument. Disabling it (the usual reflex for a streaming route,
 * as in `mal/big-sync.ts`) makes every call hang waiting on a consumed stream.
 *
 * Unauthenticated, like every other route in this app — it rides behind the same
 * LAN boundary. A read-only surface gating itself while `/api/anime/animes` does
 * not would be theatre, not security.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer } from '@/lib/mcp/server';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} Not Allowed` });
  }

  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  // The server/transport pair is per-request; drop both when the client goes away.
  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
}
