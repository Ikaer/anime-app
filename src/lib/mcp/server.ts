/**
 * Builds the MCP server and registers the read-only tool set.
 *
 * A fresh server is built **per request** by `api/anime/mcp.ts` (stateless
 * transport), which costs nothing: the expensive state is the store's
 * mtime-keyed parse cache and row cache, which are module-level and survive.
 *
 * Every tool is annotated `readOnlyHint: true` because every tool IS read-only —
 * see the guard note in `tools.ts`. Server-only (its handlers read the store).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getAnime, searchAnime } from '@/lib/mcp/tools';

/** Default / ceiling on list results — the constraint is the model's context. */
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;

/** MCP wants tool output as text content; compact JSON, indentation is tokens. */
function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

export function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'anime-tracker', version: '1.0.0' },
    {
      instructions:
        'Read-only access to a personal anime tracker: a local catalog (~25k titles ' +
        'merged from MyAnimeList, AniList and SIMKL) plus the owner\'s own watch ' +
        'statuses and scores. Titles are keyed by a canonical id like "a_1234" — ' +
        'always get one from search_anime before calling another tool. `status` and ' +
        '`score` fields are the OWNER\'s personal state (score is 1-10); `mean` is the ' +
        'community average. This server never writes: it cannot rate, update or sync anything.',
    }
  );

  server.registerTool(
    'search_anime',
    {
      title: 'Search anime',
      description:
        'Search the catalog by anime title, studio name or staff name. Returns matching ' +
        'titles with the owner\'s personal status and score, plus any studio/staff credits ' +
        'whose name matches. Use this to resolve a title to its canonical id.',
      inputSchema: {
        query: z.string().min(2).describe('Title, studio or staff name. At least 2 characters.'),
        limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional()
          .describe(`Max anime results (default ${DEFAULT_SEARCH_LIMIT}, max ${MAX_SEARCH_LIMIT}).`),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, limit }) => json(searchAnime(query, limit ?? DEFAULT_SEARCH_LIMIT))
  );

  server.registerTool(
    'get_anime',
    {
      title: 'Get anime details',
      description:
        'Full details for one title by canonical id: synopsis, genres split by axis, ' +
        'AniList tags, key staff (director/composer/character design tier first), related ' +
        'entries in the same franchise, community ranking, and the owner\'s personal status ' +
        'and score. Get the id from search_anime.',
      inputSchema: {
        id: z.string().describe('Canonical id, e.g. "a_1234".'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ id }) => {
      const result = getAnime(id);
      if (!result.found) return { ...json({ error: result.error }), isError: true };
      return json(result.anime);
    }
  );

  return server;
}
