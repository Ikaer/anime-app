import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GraphEdge, GraphEdgeKind, GraphEgo, GraphNode, GraphNodeKind } from '@/lib/domain/animeGraph';
import { collapseFranchises, layoutEgo } from '@/lib/domain/graphLayout';
import type { GraphColourMode } from '@/hooks/useGraphUrlState';
import { useT, type TranslationKey } from '@/lib/i18n';
import styles from './EgoGraph.module.css';

interface EgoGraphProps {
  ego: GraphEgo;
  colour: GraphColourMode;
  collapseFranchise: boolean;
  /** Re-centre. Only called for kinds that can BE a centre — never for a studio. */
  onRecentre: (kind: 'anime' | 'seiyuu' | 'staff', key: string) => void;
}

/** Initials for a node with no usable portrait — AniList's grey silhouette is filtered upstream. */
function initials(label: string): string {
  return label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word[0]?.toUpperCase() ?? '')
    .join('');
}

function statusClass(status: string | null | undefined): string {
  switch (status) {
    case 'completed': return styles.statusCompleted;
    case 'watching': return styles.statusWatching;
    case 'on_hold': return styles.statusOnHold;
    case 'dropped': return styles.statusDropped;
    case 'plan_to_watch': return styles.statusPlanned;
    default: return styles.statusNone;
  }
}

const KIND_CLASS: Record<GraphNodeKind, string> = {
  anime: styles.kindAnime,
  seiyuu: styles.kindSeiyuu,
  staff: styles.kindStaff,
  studio: styles.kindStudio,
};

/** Explicit rather than `styles[\`edge_${kind}\`]` — `tcm --camelCase` emits `edgeVoice`. */
const EDGE_CLASS: Record<GraphEdgeKind, string> = {
  voice: styles.edgeVoice,
  staff: styles.edgeStaff,
  studio: styles.edgeStudio,
  relation: styles.edgeRelation,
};

/** Pan/zoom state, in viewBox units. Identity is `{ k: 1, tx: 0, ty: 0 }`. */
interface Viewport {
  k: number;
  tx: number;
  ty: number;
}

const IDENTITY: Viewport = { k: 1, tx: 0, ty: 0 };
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;

/**
 * The ego graph itself — a deterministic radial SVG.
 *
 * Rendering decisions worth keeping:
 *
 * - **One `<clipPath>` for every node**, not one each: the circle lives at the
 *   origin and each node is a `<g transform="translate(…)">`, so ~100 portraits
 *   cost two clip paths total.
 * - **A studio node is not clickable to re-centre.** It links to
 *   `/credits/studio/[name]`, which is that view already.
 * - **A seiyuu node re-centres rather than linking out.** `/credits/seiyuu/[id]`
 *   now exists and would resolve, but re-centring IS this view's answer to
 *   "what else has this person done" — leaving the graph would be a downgrade.
 *   `/credits/staff/[id]` remains wrong for a seiyuu whatever happens: it scans
 *   production credits, which by construction never contain voice actors.
 */
const EgoGraph: React.FC<EgoGraphProps> = ({ ego, colour, collapseFranchise, onRecentre }) => {
  const t = useT();
  const [hovered, setHovered] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [viewport, setViewport] = useState<Viewport>(IDENTITY);
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  /**
   * Whether the current gesture moved far enough to be a pan rather than a click.
   * A press that begins on a node and ends up dragging the canvas must NOT also
   * re-centre on that node when it lands — without this, panning is impossible
   * anywhere the graph is dense, because every drag starts on something.
   */
  const panned = useRef(false);

  const nodesByKey = useMemo(
    () => new Map(ego.nodes.map(node => [node.key, node])),
    [ego.nodes]
  );

  const { groups, franchiseCounts } = useMemo(() => {
    if (!collapseFranchise) return { groups: ego.groups, franchiseCounts: new Map<string, number>() };
    const collapsed = collapseFranchises(ego.groups, nodesByKey);
    return { groups: collapsed.groups, franchiseCounts: collapsed.counts };
  }, [collapseFranchise, ego.groups, nodesByKey]);

  const layout = useMemo(() => layoutEgo(groups, nodesByKey), [groups, nodesByKey]);

  /** Neighbour key → the edges reaching it. A seiyuu can hold two roles in one show. */
  const edgesByNode = useMemo(() => {
    const map = new Map<string, GraphEdge[]>();
    for (const edge of ego.edges) {
      if (!map.has(edge.to)) map.set(edge.to, []);
      map.get(edge.to)!.push(edge);
    }
    return map;
  }, [ego.edges]);

  const colourClass = (node: GraphNode): string => {
    if (colour === 'status') return node.kind === 'anime' ? statusClass(node.status) : styles.statusNone;
    return KIND_CLASS[node.kind];
  };

  const groupLabel = (id: string) => t(`graph.group.${id}` as TranslationKey);

  /**
   * Screen pixels → viewBox units.
   *
   * `getScreenCTM()` is what makes this correct rather than approximately
   * correct: it already accounts for the element's size AND for the letterboxing
   * `preserveAspectRatio` introduces when the container's aspect doesn't match
   * the viewBox's. Deriving it by hand from `getBoundingClientRect` ignores that
   * and makes the zoom drift away from the cursor.
   */
  const toViewBox = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    return new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    /**
     * Registered by hand rather than as React's `onWheel` because it must call
     * `preventDefault`, and React attaches wheel handlers passively — a passive
     * listener cannot, so the page would scroll while the graph zoomed.
     */
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = toViewBox(event.clientX, event.clientY);
      if (!point) return;
      const factor = Math.exp(-event.deltaY * 0.0015);
      // The functional form is what lets this effect subscribe ONCE: it hands the
      // current viewport in, so there is no need to mirror it into a ref (which
      // would mean writing a ref during render) or to re-bind the listener on
      // every zoom step.
      setViewport(current => {
        const nextK = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.k * factor));
        // Keep the point under the cursor fixed: it sits at content coordinate
        // q = (point - t) / k, and must still satisfy point = t' + k'·q.
        const qx = (point.x - current.tx) / current.k;
        const qy = (point.y - current.ty) / current.k;
        return { k: nextK, tx: point.x - nextK * qx, ty: point.y - nextK * qy };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [toViewBox]);

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    // Left button only. A press that lands on a node is still allowed to start a
    // pan; `panned` is what decides afterwards whether it was a click.
    if (event.button !== 0) return;
    const point = toViewBox(event.clientX, event.clientY);
    if (!point) return;
    dragging.current = { x: point.x, y: point.y };
    panned.current = false;
    setGrabbing(true);
    // Capture is deliberately NOT taken here — see `onPointerMove`.
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const start = dragging.current;
    if (!start) return;
    const point = toViewBox(event.clientX, event.clientY);
    if (!point) return;
    /**
     * Capture is taken HERE, on the first movement past the threshold, rather
     * than on pointerdown — and that ordering is the difference between the node
     * clicks working and not.
     *
     * `setPointerCapture` retargets every following pointer event to the capture
     * element, and the synthesized `click` along with them. Capturing on
     * pointerdown therefore delivered the click to the `<svg>` instead of the
     * node `<g>`, so re-centring silently did nothing on every press. Capturing
     * only once a pan is real means a plain click never captures at all, while a
     * drag still keeps receiving events after the pointer leaves the element.
     *
     * 4 viewBox units ≈ 3-4 screen px at the usual fit, so an unsteady click is
     * still a click.
     */
    if (!panned.current && Math.hypot(point.x - start.x, point.y - start.y) > 4) {
      panned.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (!panned.current) return;
    setViewport(current => ({
      ...current,
      tx: current.tx + (point.x - start.x),
      ty: current.ty + (point.y - start.y),
    }));
    dragging.current = { x: point.x, y: point.y };
  };

  const endDrag = (event: React.PointerEvent<SVGSVGElement>) => {
    dragging.current = null;
    setGrabbing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  // A new focal node is a new graph, so it starts framed rather than inheriting
  // wherever the last one was panned to.
  useEffect(() => {
    setViewport(IDENTITY);
  }, [ego.focal.key, ego.focalType]);

  const zoomed = viewport.k !== 1 || viewport.tx !== 0 || viewport.ty !== 0;

  return (
    <div className={styles.wrapper}>
      {zoomed && (
        <button className={styles.reset} onClick={() => setViewport(IDENTITY)}>
          {t('graph.resetView')}
        </button>
      )}
      <svg
        ref={svgRef}
        className={`${styles.svg} ${grabbing ? styles.grabbing : ''}`}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        role="img"
        aria-label={t('graph.svgLabel', { name: ego.focal.label })}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <defs>
          <clipPath id="graph-node-clip">
            <circle cx={0} cy={0} r={24} />
          </clipPath>
          <clipPath id="graph-focal-clip">
            <circle cx={0} cy={0} r={layout.focalRadius - 3} />
          </clipPath>
          <clipPath id="graph-character-clip">
            <circle cx={0} cy={0} r={17} />
          </clipPath>
        </defs>

        {/* Pan/zoom rides on its own wrapper so the layout's own centring
            transform below stays untouched and the geometry code knows nothing
            about the viewport. */}
        <g transform={`translate(${viewport.tx} ${viewport.ty}) scale(${viewport.k})`}>
        <g transform={`translate(${layout.cx} ${layout.cy})`}>
          {/* Sector guides, drawn first so everything sits on top of them. */}
          {layout.groups.map(lg => (
            <text
              key={`label-${lg.group.id}`}
              className={styles.groupLabel}
              x={lg.labelX}
              y={lg.labelY}
              textAnchor={lg.labelAnchor}
            >
              {groupLabel(lg.group.id)}
              {lg.group.total > lg.group.nodeKeys.length && (
                <tspan className={styles.groupOverflow}>
                  {' '}{t('graph.overflow', { count: lg.group.total - lg.group.nodeKeys.length })}
                </tspan>
              )}
            </text>
          ))}

          {layout.nodes.map(ln => {
            const edges = edgesByNode.get(ln.node.key) ?? [];
            const dim = hovered !== null && hovered !== ln.node.key;
            const isHovered = hovered === ln.node.key;

            /**
             * **The edge carries the character, as a portrait.**
             *
             * A voice credit is a three-way fact — this seiyuu plays this
             * character in this title — and the character belongs to neither
             * end, so it rides the line. A face is also the one label that needs
             * no rotation: a circular portrait reads the same at any angle, where
             * text along a spoke has to be flipped past the vertical and is
             * awkward everywhere in between. The name follows on hover.
             *
             * Its ring is neutral: the portrait itself identifies the character,
             * and a second colour scale on the spoke would compete with the node
             * colouring for no extra information.
             */
            const voiceEdges = edges.filter(e => e.kind === 'voice');
            // Two characters on one spoke: dual casting, or a franchise recast
            // surfacing once collapsed. Both get a portrait, offset along the line.
            const portraits = voiceEdges.slice(0, 2);
            /**
             * Anchored a fixed distance INSIDE the node, not at a fraction of the
             * radius. At `radius * 0.55` every spoke's portrait landed proportionally
             * closer to the centre, so the angular spacing shrank with it and the
             * inner ring's portraits overlapped in a clump around the focal node —
             * the spacing `layoutEgo` guarantees holds at the node's radius, not at
             * 55% of it. 62px inward keeps that guarantee nearly intact.
             */
            const portraitRadius = Math.max(70, ln.radius - 62);

            return (
              <g key={`edge-${ln.node.key}`} className={dim ? styles.dimmed : undefined}>
                <line
                  className={`${styles.edge} ${EDGE_CLASS[edges[0]?.kind ?? 'voice']}`}
                  x1={0}
                  y1={0}
                  x2={ln.x}
                  y2={ln.y}
                />
                {portraits.map((edge, i) => {
                  // A second character on the same spoke sits further in.
                  const radius = portraitRadius - i * 40;
                  const x = Math.cos(ln.angle) * radius;
                  const y = Math.sin(ln.angle) * radius;
                  return (
                    <g key={edge.characterKey ?? `${edge.label}-${i}`} transform={`translate(${x} ${y})`}>
                      <circle className={styles.characterBack} r={18} />
                      {edge.characterImage
                        ? <image
                            href={edge.characterImage}
                            x={-17}
                            y={-17}
                            width={34}
                            height={34}
                            clipPath="url(#graph-character-clip)"
                            preserveAspectRatio="xMidYMid slice"
                          />
                        : <text className={styles.characterInitials} textAnchor="middle" dy="0.35em">
                            {initials(edge.label)}
                          </text>}
                      <circle className={styles.characterRing} r={18} />
                      {isHovered && (
                        <text className={styles.characterName} textAnchor="middle" y={32}>
                          {edge.label.length > 26 ? `${edge.label.slice(0, 25)}…` : edge.label}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}

          {layout.nodes.map(ln => {
            const node = ln.node;
            const edges = edgesByNode.get(node.key) ?? [];
            const dim = hovered !== null && hovered !== node.key;
            const isHovered = hovered === node.key;
            const clickable = node.kind !== 'studio';
            const franchiseCount = franchiseCounts.get(node.key) ?? 1;

            const body = (
              <g
                className={`${styles.node} ${dim ? styles.dimmed : ''} ${clickable ? styles.clickable : ''}`}
                transform={`translate(${ln.x} ${ln.y})`}
                onMouseEnter={() => setHovered(node.key)}
                onMouseLeave={() => setHovered(current => (current === node.key ? null : current))}
                onClick={clickable
                  ? () => { if (!panned.current) onRecentre(node.kind as 'anime' | 'seiyuu' | 'staff', node.key); }
                  : undefined}
                tabIndex={0}
                onKeyDown={event => {
                  if (clickable && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    onRecentre(node.kind as 'anime' | 'seiyuu' | 'staff', node.key);
                  }
                }}
              >
                {node.image
                  ? <image
                      href={node.image}
                      x={-24}
                      y={-24}
                      width={48}
                      height={48}
                      clipPath="url(#graph-node-clip)"
                      preserveAspectRatio="xMidYMid slice"
                    />
                  : <circle className={styles.placeholder} r={24} />}
                {!node.image && (
                  <text className={styles.initials} textAnchor="middle" dy="0.35em">
                    {initials(node.label)}
                  </text>
                )}
                <circle className={`${styles.ring} ${colourClass(node)}`} r={24} />

                {node.kind === 'anime' && node.status && (
                  <circle className={styles.seenDot} cx={17} cy={-17} r={6} />
                )}

                <text
                  className={styles.nodeLabel}
                  x={ln.anchor === 'start' ? 32 : -32}
                  y={0}
                  textAnchor={ln.anchor}
                >
                  <tspan className={styles.nodeName}>
                    {node.label.length > 34 ? `${node.label.slice(0, 33)}…` : node.label}
                    {franchiseCount > 1 && (
                      <tspan className={styles.franchiseCount}> ×{franchiseCount}</tspan>
                    )}
                  </tspan>
                  {/* Voice edges carry their character on the EDGE, so repeating
                      it here would both duplicate it and cost every cast node a
                      second line — which is what made dense arcs collide. Staff
                      and relation edges keep it: a role and a relation type read
                      as properties of the node you are looking at. */}
                  {edges.length > 0 && edges[0].kind !== 'voice' && (
                    <tspan
                      className={styles.nodeSub}
                      x={ln.anchor === 'start' ? 32 : -32}
                      dy="1.25em"
                    >
                      {edges.map(e => e.label).filter(Boolean).slice(0, 2).join(' · ')}
                    </tspan>
                  )}
                </text>
              </g>
            );

            // A studio is a leaf: it links to the view that IS a studio page.
            return node.kind === 'studio'
              ? <a key={node.key} href={`/credits/studio/${encodeURIComponent(node.key)}`}>{body}</a>
              : <React.Fragment key={node.key}>{body}</React.Fragment>;
          })}

          {/* Focal node last, so it is never overdrawn by a near-in neighbour. */}
          <g className={styles.focal}>
            <circle className={styles.focalHalo} r={layout.focalRadius + 8} />
            {ego.focal.image
              ? <image
                  href={ego.focal.image}
                  x={-(layout.focalRadius - 3)}
                  y={-(layout.focalRadius - 3)}
                  width={(layout.focalRadius - 3) * 2}
                  height={(layout.focalRadius - 3) * 2}
                  clipPath="url(#graph-focal-clip)"
                  preserveAspectRatio="xMidYMid slice"
                />
              : <circle className={styles.placeholder} r={layout.focalRadius - 3} />}
            {!ego.focal.image && (
              <text className={styles.focalInitials} textAnchor="middle" dy="0.35em">
                {initials(ego.focal.label)}
              </text>
            )}
            <circle className={`${styles.focalRing} ${colourClass(ego.focal)}`} r={layout.focalRadius} />
            <text className={styles.focalLabel} textAnchor="middle" y={layout.focalRadius + 30}>
              {ego.focal.label}
            </text>
            {ego.focal.labelNative && (
              <text className={styles.focalNative} textAnchor="middle" y={layout.focalRadius + 52}>
                {ego.focal.labelNative}
              </text>
            )}
          </g>
        </g>
        </g>
      </svg>
    </div>
  );
};

export default EgoGraph;
