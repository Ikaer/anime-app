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
import { getAnime, listAnime, listGenres, searchAnime, MCP_SORT_KEYS } from '@/lib/mcp/tools';

/** Default / ceiling on list results — the constraint is the model's context. */
const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;
const MAX_LIST_LIMIT = 100;

/**
 * Effective watch statuses. `not_defined` is a real value here, not a gap: it is
 * how you ask for catalog titles the owner has never touched.
 */
const STATUSES = ['watching', 'completed', 'on_hold', 'dropped', 'plan_to_watch', 'not_defined'] as const;

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

  server.registerTool(
    'list_anime',
    {
      title: 'List / rank anime',
      description:
        "The owner's list and the wider catalog, filtered, sorted and paged. This is how " +
        'you answer questions about the list as a whole — favourites, what they dropped, ' +
        'the backlog, the best unseen titles of a year — rather than looking titles up one ' +
        'by one. Favourites: statuses ["completed"], sortBy "my_score", sortDir "desc". ' +
        'Unwatched catalog: statuses ["not_defined"]. Results are paged: check `total` and ' +
        '`hasMore`, and page on with `offset` rather than assuming you saw everything.',
      inputSchema: {
        statuses: z.array(z.enum(STATUSES)).optional()
          .describe("Effective watch status. Omit for every title in the catalog."),
        minMyScore: z.number().min(1).max(10).optional()
          .describe("Lower bound on the OWNER'S OWN score (1-10). Not the community score."),
        maxMyScore: z.number().min(1).max(10).optional().describe("Upper bound on the owner's own score."),
        minMean: z.number().min(0).max(10).optional()
          .describe('Lower bound on the COMMUNITY mean (1-10). Not the owner\'s score.'),
        maxMean: z.number().min(0).max(10).optional().describe('Upper bound on the community mean.'),
        minYear: z.number().int().optional().describe('Earliest release year, inclusive.'),
        maxYear: z.number().int().optional().describe('Latest release year, inclusive.'),
        genres: z.array(z.string()).optional()
          .describe('Genre/theme/demographic names, ALL of which must be present. Get exact names from list_genres.'),
        mediaTypes: z.array(z.string()).optional()
          .describe('e.g. "tv", "movie", "ova", "ona", "special".'),
        search: z.string().optional().describe('Substring match on the title, combined with the other filters.'),
        ratedOnly: z.boolean().optional().describe('Only titles the owner has scored.'),
        unratedOnly: z.boolean().optional().describe('Only titles the owner has NOT scored.'),
        includeHidden: z.boolean().optional().describe('Include titles the owner hid. Default false.'),
        sortBy: z.enum(MCP_SORT_KEYS).optional()
          .describe('Default "my_score". "mean" is the community score; "my_score" is the owner\'s.'),
        sortDir: z.enum(['asc', 'desc']).optional().describe('Default "desc".'),
        limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional()
          .describe(`Page size (default 20, max ${MAX_LIST_LIMIT}).`),
        offset: z.number().int().min(0).optional().describe('Page offset, for paging through `total`.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (params) => json(listAnime(params))
  );

  server.registerTool(
    'list_genres',
    {
      title: 'List genre vocabulary',
      description:
        'Every genre, theme and demographic name present in the catalog, with how many titles ' +
        'carry each. Call this before filtering by genre in list_anime — the names must match ' +
        'exactly, and the theme list is open-ended, so guessing returns nothing.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => json(listGenres())
  );

  return server;
}
