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
import { getAnime, listAnime, listGenres, myStats, recommend, searchAnime, similarTo, tierList, MCP_SORT_KEYS } from '@/lib/mcp/tools';
import { STATS_DIMENSIONS, type StatsDimension } from '@/lib/domain/stats';

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
    'my_stats',
    {
      title: "What the owner's list is made of",
      description:
        "Repartition of the owner's WATCHED list by studio, seiyuu, technical staff, producer, " +
        'AniList tag or genre — each ranked by how many of their titles it appears on. Use this ' +
        'for "what do I watch a lot of", "favourite studio", "which voice actor keeps showing up". ' +
        'Counts are distinct anime, and multi-valued dimensions sum past 100% (a title has many ' +
        'genres). Scope is the statused list only, never the whole catalog. Narrow with ' +
        'minMyScore/maxMyScore to ask what the owner LOVES rather than what they merely watch a ' +
        'lot of: over the whole list, a ranking tracks how much of a genre exists as much as how ' +
        'much they like it, and the two answers often disagree.',
      inputSchema: {
        dimensions: z.array(z.enum(STATS_DIMENSIONS as [StatsDimension, ...StatsDimension[]])).optional()
          .describe('Which repartitions to return. Omit for all six.'),
        statuses: z.array(z.enum(STATUSES)).optional()
          .describe('Restrict to these watch statuses. Omit for every statused title. "not_defined" yields nothing here.'),
        minMyScore: z.number().min(1).max(10).optional()
          .describe("Lower bound on the OWNER'S OWN score (1-10), inclusive. Not the community mean. " +
            'Setting either bound also excludes titles they never scored.'),
        maxMyScore: z.number().min(1).max(10).optional()
          .describe("Upper bound on the owner's own score, inclusive."),
        limit: z.number().int().min(1).max(50).optional().describe('Rows per dimension (default 15, max 50).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (params) => json(myStats(params))
  );

  server.registerTool(
    'recommend',
    {
      title: 'Recommend what to watch next',
      description:
        'The "Pour toi" feed: UNSEEN titles ranked by affinity to the owner\'s taste, each with ' +
        'the seeds it came from and why it scored. Use this for "what should I watch next". ' +
        'It re-ranks a cached candidate set and never refreshes it, so check `lastRefresh` and ' +
        'any `note` before trusting an empty or thin answer. For titles similar to ONE specific ' +
        'anime, use similar_to instead. ' +
        'READING THE SCORE — `affinityScore` is an additive weighted sum over sources that push ' +
        'both ways, and `why` lists them with a signed `contribution`. Negative entries are ' +
        'real model output, not noise: `rejection` scores how much a candidate resembles what ' +
        'the owner DROPPED or scored <= 5 (a taste profile over genres, studios and lead staff, ' +
        'netted against their likes), and `popularity` pushes well-known titles down. ' +
        '`becauseOf` lists only the liked seeds whose crowd recommendations point at the title, ' +
        'so it is positive by construction — do not read it as the full explanation, and do not ' +
        'conclude from it that the dropped or low-scored titles are unused signal. `why` is ' +
        'trimmed per sign, so a penalty is never crowded out by a larger positive.',
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional().describe('How many to return (default 15, max 50).'),
        nicheMode: z.boolean().optional()
          .describe('Favour lesser-known titles over popular ones. Default false.'),
        threshold: z.number().min(1).max(10).optional()
          .describe('Minimum owner score for a completed title to seed the feed. Defaults to the stored setting.'),
        diversity: z.number().min(0).optional()
          .describe('0 (default) keeps the pure affinity order; higher spreads genres/studios apart.'),
        mediaTypes: z.array(z.string()).optional().describe('e.g. "tv", "movie", "ova".'),
        genres: z.array(z.string()).optional().describe('ALL must be present. Exact names from list_genres.'),
        minMean: z.number().min(0).max(10).optional().describe('Lower bound on the COMMUNITY mean.'),
        maxMean: z.number().min(0).max(10).optional().describe('Upper bound on the community mean.'),
        minYear: z.number().int().optional().describe('Earliest release year, inclusive.'),
        maxYear: z.number().int().optional().describe('Latest release year, inclusive.'),
        search: z.string().optional().describe('Substring match on the title.'),
        lang: z.enum(['fr', 'en']).optional()
          .describe('Language of the `why` explanations. Default "fr".'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (params) => json(recommend(params))
  );

  server.registerTool(
    'similar_to',
    {
      title: 'Find anime similar to one title',
      description:
        'Titles resembling ONE specific anime, from its crowd recommendations on MAL and ' +
        "AniList, re-ranked against the owner's taste. Use this for \"something like X\"; use " +
        'recommend for "what should I watch next" in general. Titles the owner has already ' +
        'seen are included and flagged `seen` rather than dropped. This call queries MAL and ' +
        'AniList live, so it is slower than the other tools and worth calling once per title.',
      inputSchema: {
        id: z.string().describe('Canonical id of the anime to find lookalikes for, e.g. "a_1234".'),
        limit: z.number().int().min(1).max(50).optional().describe('How many to return (default 15, max 50).'),
        lang: z.enum(['fr', 'en']).optional().describe('Language of the `why` explanations. Default "fr".'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id, limit, lang }) => {
      const result = await similarTo(id, limit, lang);
      if (!result.ok) return { ...json({ error: result.error }), isError: true };
      return json({ items: result.items, sources: result.sources, ...(result.note ? { note: result.note } : {}) });
    }
  );

  server.registerTool(
    'tier_list',
    {
      title: 'Tier board and the gap vs the community',
      description:
        "The owner's tier board as data, and how their scores compare to the community. " +
        'Default axis "gap" buckets titles by (owner score − provider\'s rounded mean), so ' +
        'sortDir "desc" surfaces where they rate FAR ABOVE the crowd and "asc" where they rate ' +
        'below; sortBy "abs_gap" gives the biggest disagreements either way. `gapSummary` says ' +
        'whether they are a generous or harsh rater overall. Scope is watching/completed/on_hold/' +
        'dropped — plan_to_watch is excluded, since an unwatched title has no score. ' +
        'IMPORTANT — the filters do not all reach the same fields. statuses/genres/mediaTypes/' +
        'minYear/maxYear select the board itself, so `distribution`, `gapSummary`, `total` and ' +
        '`items` all describe that same narrowed set. minGap/maxGap instead narrow ONLY `total` ' +
        'and `items`: `distribution` and `gapSummary` still describe the whole board, because ' +
        'the shape answers "what does their board look like" while the gap bounds answer "show ' +
        'me the disagreements". Paging never affects `distribution` either. So when a gap bound ' +
        'is set, do not read `gapSummary.comparable` as the size of the filtered result — that ' +
        'is `total`.',
      inputSchema: {
        axis: z.enum(['gap', 'me', 'mal', 'anilist']).optional()
          .describe('What the rows mean: "gap" (default) the difference, "me" the owner\'s score, "mal"/"anilist" that provider\'s mean.'),
        vs: z.enum(['mal', 'anilist']).optional()
          .describe('Which community mean the gap compares against. Default "mal".'),
        statuses: z.array(z.enum(['watching', 'completed', 'on_hold', 'dropped'])).optional()
          .describe('Restrict the board. Omit for all four.'),
        minGap: z.number().int().optional()
          .describe('Only titles at least this far ABOVE the provider. Use e.g. 3 for "much higher than MAL". Narrows `items`/`total` only, NOT `distribution`/`gapSummary`.'),
        maxGap: z.number().int().optional()
          .describe('Only titles at most this gap. Use e.g. -3 for "much lower than MAL". Narrows `items`/`total` only, NOT `distribution`/`gapSummary`.'),
        genres: z.array(z.string()).optional().describe('ALL must be present. Exact names from list_genres.'),
        mediaTypes: z.array(z.string()).optional().describe('e.g. "tv", "movie", "ova".'),
        minYear: z.number().int().optional().describe('Earliest release year, inclusive.'),
        maxYear: z.number().int().optional().describe('Latest release year, inclusive.'),
        search: z.string().optional().describe('Substring match on the title.'),
        sortBy: z.enum(['gap', 'abs_gap', 'my_score', 'mean', 'title']).optional()
          .describe('Default "gap" (signed). "abs_gap" ranks by disagreement size regardless of direction.'),
        sortDir: z.enum(['asc', 'desc']).optional().describe('Default "desc".'),
        limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional()
          .describe(`Page size for \`items\` (default 25, max ${MAX_LIST_LIMIT}). \`distribution\` ignores this.`),
        offset: z.number().int().min(0).optional().describe('Page offset for `items`.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (params) => json(tierList(params))
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
