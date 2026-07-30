/**
 * Radial layout for the `/graph` ego view — pure geometry, no React, no `fs`.
 *
 * **Deterministic by choice, not by limitation.** A force simulation was the
 * obvious reach and is the wrong tool here: the target is a 4K TV at 300% zoom
 * (≈1280 CSS px), where the binding constraint is *label collision*, not node
 * count — and a simulation reflows on every interaction, so the same graph never
 * looks the same twice and a screenshot can't be compared to the last one. It
 * would also be the app's first layout dependency, in a repo that hand-rolled
 * `/tier`'s drag-and-drop to avoid exactly that.
 *
 * Sectors solve the real problem instead: each group owns an angular wedge, so
 * label space is *allocated* rather than negotiated, and a dense group grows
 * outward into extra rings instead of crowding its neighbours.
 */

import type { GraphGroup, GraphNode } from '@/lib/domain/animeGraph';

export interface LayoutNode {
  node: GraphNode;
  /** Group this node was placed in — a node key appears in exactly one. */
  groupId: string;
  x: number;
  y: number;
  /** Radians from the centre, for the label's side and the edge's angle. */
  angle: number;
  radius: number;
  /** `start` on the right half, `end` on the left, so labels read outward. */
  anchor: 'start' | 'end';
  /** Where the label sits — outside the node's own circle. */
  labelX: number;
  labelY: number;
}

export interface LayoutGroup {
  group: GraphGroup;
  /** Sector bounds in radians. */
  from: number;
  to: number;
  /** Mid-angle label position, beyond the outermost ring. */
  labelX: number;
  labelY: number;
  labelAnchor: 'start' | 'middle' | 'end';
  /** Rings this group actually used, so the caller can size the viewBox. */
  maxRadius: number;
}

export interface GraphLayout {
  width: number;
  height: number;
  cx: number;
  cy: number;
  nodes: LayoutNode[];
  groups: LayoutGroup[];
  /** Radius of the focal node's circle. */
  focalRadius: number;
}

export interface LayoutOptions {
  /** Radius of the innermost ring. */
  baseRadius?: number;
  /** Distance between rings within a sector. */
  ringGap?: number;
  /** Vertical room one node label needs, in px. */
  labelHeight?: number;
  /** Horizontal room one node label needs, in px. */
  labelWidth?: number;
  /** Gap between adjacent sectors, in radians. */
  sectorGap?: number;
  focalRadius?: number;
  /** Node circle radius, used to offset the label clear of it. */
  nodeRadius?: number;
}

const DEFAULTS: Required<LayoutOptions> = {
  baseRadius: 250,
  ringGap: 150,
  /**
   * Vertical footprint of one node — **the circle, not the text**.
   *
   * 30 was the first value, reasoning from a one-line label, and it was wrong
   * twice over: the node circles are 48px across so they physically overlapped on
   * the flanks, and staff/relation nodes carry a second line (role, relation type)
   * for ~34px of text. 54 clears the larger of the two with a little air.
   */
  labelHeight: 54,
  /** Horizontal room one node label needs, truncation included. */
  labelWidth: 190,
  sectorGap: 0.12,
  focalRadius: 62,
  nodeRadius: 26,
};

/**
 * The next angle on a ring at which a node's label clears the previous one.
 *
 * This is the whole difficulty of the view. Labels run horizontally, so two of
 * them clear each other if EITHER they are far enough apart vertically OR their
 * boxes don't overlap horizontally — and the acceptable spacing therefore swings
 * enormously with position. On the left and right flanks consecutive nodes differ
 * mostly in y, so the label height (~54px) is enough and an arc packs tightly. At
 * the top and bottom they sit at the SAME height and differ only in x, so nothing
 * short of the full label width (~190px) will do.
 *
 * **Solved by marching, not by a formula, and that is deliberate.** The closed
 * form `min(height/|cosθ|, width/|sinθ|)` is a *linearization* — it is the
 * requirement for an infinitesimal step, and the steps here are up to 40° wide,
 * where it is simply wrong. It was tried: on Hajime Yatate's 24-credit ego it
 * placed two nodes 27° apart at 63° and 90°, predicting 54px of vertical
 * clearance where the true figure was 28, and their labels overlapped. Stepping
 * out in small increments and testing the ACTUAL positions has no such error, and
 * at ~100 nodes the cost is irrelevant.
 *
 * Nodes that no longer fit inside the sector go outward into another ring.
 */
function nextAngleOnRing(
  previous: number,
  radius: number,
  options: Required<LayoutOptions>
): number {
  const previousX = Math.cos(previous) * radius;
  const previousY = Math.sin(previous) * radius;
  // ~0.46°, which is ≈2px of arc at the innermost ring — finer than the eye can
  // register, so the placement is exact for practical purposes.
  const STEP = 0.008;
  for (let delta = STEP; delta <= Math.PI; delta += STEP) {
    const angle = previous + delta;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (
      Math.abs(y - previousY) >= options.labelHeight
      || Math.abs(x - previousX) >= options.labelWidth
    ) {
      return angle;
    }
  }
  // Unreachable for any radius that can hold two nodes; a safe upper bound.
  return previous + Math.PI;
}

/**
 * Sector spans are proportional to **count^0.8**, not to count.
 *
 * Linear allocation lets one big group (a seiyuu's 24 supporting roles against 3
 * main ones) eat the circle and squeeze the small groups into slivers where their
 * labels collide — even though the small groups are the ones you read first.
 * A plain square root over-corrected the other way: it gave a 14-node group the
 * same wedge as a 4-node one and forced the big group into cramped rings. 0.8
 * keeps large groups clearly larger while leaving a 3-node group legible.
 */
function sectorWeight(count: number): number {
  return Math.pow(Math.max(count, 1), 0.8);
}

/**
 * Lay a set of groups out around a centre.
 *
 * Nodes are looked up from `nodesByKey`; a group key with no node is skipped
 * rather than throwing — the API caps groups and drops the nodes it dropped, but
 * this stays tolerant so a hand-edited URL can't blank the page.
 */
export function layoutEgo(
  groups: GraphGroup[],
  nodesByKey: Map<string, GraphNode>,
  options: LayoutOptions = {}
): GraphLayout {
  const opts = { ...DEFAULTS, ...options };

  const present = groups
    .map(group => ({
      group,
      keys: group.nodeKeys.filter(key => nodesByKey.has(key)),
    }))
    .filter(entry => entry.keys.length > 0);

  const totalWeight = present.reduce((sum, e) => sum + sectorWeight(e.keys.length), 0) || 1;
  // Start at the top and run clockwise, so the first group reads first.
  const fullCircle = Math.PI * 2;
  const available = fullCircle - opts.sectorGap * present.length;

  const nodes: LayoutNode[] = [];
  const layoutGroups: LayoutGroup[] = [];
  let cursor = -Math.PI / 2;
  let outermost = opts.baseRadius;

  for (const { group, keys } of present) {
    const span = (sectorWeight(keys.length) / totalWeight) * available;
    const from = cursor;
    const to = cursor + span;

    // Filled greedily ring by ring, because capacity is not a single number: the
    // gap each node needs depends on where in the sector it lands (see
    // `requiredArc`), so a sector spanning the flank AND the bottom fits more
    // nodes near the flank. Whatever doesn't fit goes outward to the next ring.
    let placed = 0;
    let ring = 0;
    let groupMaxRadius = opts.baseRadius;
    while (placed < keys.length) {
      const radius = opts.baseRadius + ring * opts.ringGap;

      /**
       * Greedily place from `start`, each node at the first angle where its label
       * clears the previous one. Stops at the sector's trailing edge.
       */
      const pack = (start: number, budget: number): number[] => {
        const out: number[] = [];
        let cursorAngle = start;
        while (out.length < budget) {
          if (out.length > 0) {
            cursorAngle = nextAngleOnRing(out[out.length - 1], radius, opts);
          }
          // 1e-9 absorbs float drift so a node that exactly fits isn't pushed out.
          if (cursorAngle > to + 1e-9) break;
          out.push(cursorAngle);
        }
        return out;
      };

      /**
       * Packed twice, and that is not wasted work.
       *
       * The gap a node needs depends on WHERE IT SITS, so a ring cannot be packed
       * from the sector's edge and then slid to centre it: every gap would then be
       * sized for the angle the node used to be at. That was a real bug — sliding
       * a bottom-heavy arc left the 60°–106° nodes 65px apart where they needed
       * 185, and their labels overlapped. So pass one measures how much room the
       * ring wants, and pass two re-packs from the centred start with each gap
       * re-solved in place.
       *
       * If centring costs capacity (the trailing edge cuts a node), the uncentred
       * packing wins — losing a node to cosmetics would be the wrong trade.
       */
      let angles = pack(from, keys.length - placed);
      if (angles.length > 1) {
        const used = angles[angles.length - 1] - angles[0];
        const centred = pack(from + Math.max(0, (span - used) / 2), keys.length - placed);
        if (centred.length >= angles.length) angles = centred;
      }
      // A sector too narrow for even one node at spacing still gets one, at its
      // mid-angle — otherwise the loop never advances and the group vanishes.
      if (angles.length === 0) angles.push(from + span / 2);

      for (let i = 0; i < angles.length; i++) {
        const angle = angles[i];
        const node = nodesByKey.get(keys[placed + i])!;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        const anchor: 'start' | 'end' = Math.cos(angle) >= 0 ? 'start' : 'end';
        const labelOffset = opts.nodeRadius + 8;
        nodes.push({
          node,
          groupId: group.id,
          x,
          y,
          angle,
          radius,
          anchor,
          labelX: x + (anchor === 'start' ? labelOffset : -labelOffset),
          labelY: y,
        });
      }

      groupMaxRadius = radius;
      placed += angles.length;
      ring++;
    }

    outermost = Math.max(outermost, groupMaxRadius);

    layoutGroups.push({
      group,
      from,
      to,
      // Filled in below, once the global outermost radius is known.
      labelX: 0,
      labelY: 0,
      labelAnchor: 'middle',
      maxRadius: groupMaxRadius,
    });

    cursor = to + opts.sectorGap;
  }

  /**
   * Headings go on ONE shared ring outside every group, not each just outside its
   * own outermost node.
   *
   * Per-group placement put a heading wherever that group happened to end, which
   * on a sparse group is well inside the graph — "Rôles secondaires" landed on top
   * of a neighbouring sector's node label. A shared radius makes the headings read
   * as a ring of section titles around the whole figure, and puts them clear of
   * every node by construction.
   */
  const headingRadius = outermost + opts.ringGap * 0.7;
  for (const entry of layoutGroups) {
    const mid = (entry.from + entry.to) / 2;
    const cos = Math.cos(mid);
    entry.labelX = cos * headingRadius;
    entry.labelY = Math.sin(mid) * headingRadius;
    // Near the vertical axis a start/end anchor reads as offset, so centre it.
    entry.labelAnchor = Math.abs(cos) < 0.25 ? 'middle' : cos >= 0 ? 'start' : 'end';
  }

  /**
   * Sized from what was actually placed, rather than from a guessed padding.
   *
   * A flat padding of 200 was the first attempt and clipped the group headings on
   * the horizontal extremes ("RÔLES SECONDAIRES" lost its tail), because a node
   * label reaches ~190px past its circle and a group heading sits ~140px past the
   * outermost ring and then runs on for its own text width. Measuring the reach
   * instead means nothing is cut and a sparse graph is not padded into a
   * postage stamp.
   */
  const GROUP_LABEL_WIDTH = 220;
  let reach = outermost;
  for (const placed of nodes) {
    reach = Math.max(
      reach,
      Math.abs(placed.x) + opts.nodeRadius + 8 + opts.labelWidth,
      Math.abs(placed.y) + opts.labelHeight
    );
  }
  for (const placed of layoutGroups) {
    // A middle-anchored heading spreads both ways, so it only reaches half.
    const spread = placed.labelAnchor === 'middle' ? GROUP_LABEL_WIDTH / 2 : GROUP_LABEL_WIDTH;
    reach = Math.max(reach, Math.abs(placed.labelX) + spread, Math.abs(placed.labelY) + 20);
  }
  const extent = reach + 24;
  return {
    width: extent * 2,
    height: extent * 2,
    cx: extent,
    cy: extent,
    nodes,
    groups: layoutGroups,
    focalRadius: opts.focalRadius,
  };
}

/**
 * Collapse sibling anime to one node per franchise, keeping the FIRST occurrence
 * in each group's already-ranked order (so the survivor is the best-ranked
 * member) and reporting how many it stands for.
 *
 * Purely a display transform over the server's per-title nodes — see
 * `animeGraph.ts` on why the node itself is never a franchise. Non-anime nodes
 * and anime with no franchise key pass through untouched.
 */
export function collapseFranchises(
  groups: GraphGroup[],
  nodesByKey: Map<string, GraphNode>
): { groups: GraphGroup[]; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  const nextGroups = groups.map(group => {
    const kept: string[] = [];
    // Per group, not globally: the same franchise legitimately appears in both
    // `roles.main` and `roles.supporting`, and merging across them would drop a
    // main role in favour of a supporting one.
    const seen = new Map<string, string>();
    for (const key of group.nodeKeys) {
      const node = nodesByKey.get(key);
      const franchise = node?.kind === 'anime' ? node.franchiseKey : undefined;
      if (!franchise) {
        kept.push(key);
        continue;
      }
      const survivor = seen.get(franchise);
      if (survivor === undefined) {
        seen.set(franchise, key);
        kept.push(key);
        counts.set(key, 1);
      } else {
        counts.set(survivor, (counts.get(survivor) ?? 1) + 1);
      }
    }
    return { ...group, nodeKeys: kept };
  });
  return { groups: nextGroups, counts };
}
