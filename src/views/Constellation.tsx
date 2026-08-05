// The star chart. A d3-force constellation of themes (stars) and projects
// (anchors), fully data-driven. Horizon themes with no project edge get a
// small cobalt star: free-floating is a first-class state, not an error.
import { useEffect, useRef } from 'react';
import { drag } from 'd3-drag';
import type { D3DragEvent } from 'd3-drag';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
} from 'd3-force';
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force';
import { select } from 'd3-selection';
import { disciplineColor } from '../lib/format';
import type { Project, Theme, ThemeLink, ThemeLinkKind } from '../types';

export type ConstellationSelection =
  | { kind: 'theme'; theme: Theme }
  | { kind: 'project'; project: Project };

export interface ConstellationProps {
  themes: Theme[];
  projects: Project[];
  links: ThemeLink[];
  selectedId: string | null;
  onSelect: (sel: ConstellationSelection) => void;
}

/** 4-point star, ~6px across, drawn at the origin. Shared with the legend. */
export const HORIZON_STAR_PATH =
  'M0 -3 L0.8 -0.8 L3 0 L0.8 0.8 L0 3 L-0.8 0.8 L-3 0 L-0.8 -0.8 Z';

const W = 620;
const H = 460;
const SELECT_STROKE = '#1B3FBF';
const UNREAD_STROKE = '#a79c86';

interface ThemeNode extends SimulationNodeDatum {
  kind: 'theme';
  id: string;
  r: number;
  theme: Theme;
  starred: boolean;
}

interface ProjectNode extends SimulationNodeDatum {
  kind: 'project';
  id: string;
  r: number;
  project: Project;
}

type MapNode = ThemeNode | ProjectNode;

interface MapEdge extends SimulationLinkDatum<MapNode> {
  kind: ThemeLinkKind;
}

/** Core-circle stroke reflects selection without restarting the simulation.
 * Only theme nodes carry a core circle; project rects rely on :focus-visible. */
function applyCoreStrokes(svgEl: SVGSVGElement | null, selectedId: string | null): void {
  if (!svgEl) return;
  select(svgEl)
    .selectAll<SVGCircleElement, MapNode>('circle[data-core]')
    .attr('stroke', (d) =>
      d.id === selectedId
        ? SELECT_STROKE
        : d.kind === 'theme' && d.theme.mastery === 'unread'
          ? UNREAD_STROKE
          : d.kind === 'theme'
            ? disciplineColor(d.theme.discipline)
            : '#33302A',
    )
    .attr('stroke-width', (d) =>
      d.id === selectedId ? 2.5 : d.kind === 'theme' && d.theme.mastery === 'unread' ? 1.2 : 1,
    );
}

export function Constellation({ themes, projects, links, selectedId, onSelect }: ConstellationProps) {
  const ref = useRef<SVGSVGElement>(null);
  // Refs so selection and callback changes never rebuild the simulation.
  const selectedRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const svgEl = ref.current;
    if (!svgEl) return;
    const svg = select(svgEl);
    svg.selectAll('*').remove();

    const nodes: MapNode[] = [
      ...themes.map(
        (t): MapNode => ({
          kind: 'theme',
          id: t.id,
          r: 14 + Math.round(t.heat * 20),
          theme: t,
          starred: false,
        }),
      ),
      ...projects.map((p): MapNode => ({ kind: 'project', id: p.id, r: 20, project: p })),
    ];

    // manifold data may be ahead of context: drop edges whose endpoints are
    // not on the chart, or forceLink would throw on the unknown id.
    const ids = new Set(nodes.map((n) => n.id));
    const wired = links.filter((l) => ids.has(l.sourceId) && ids.has(l.targetId));

    // The star marks what is actually rendered as free-floating: horizon lane
    // and no project edge on the chart.
    const projectTied = new Set(wired.filter((l) => l.kind === 'project').map((l) => l.sourceId));
    for (const n of nodes) {
      if (n.kind === 'theme') n.starred = n.theme.lane === 'horizon' && !projectTied.has(n.id);
    }

    const edges: MapEdge[] = wired.map((l) => ({
      source: l.sourceId,
      target: l.targetId,
      kind: l.kind,
    }));

    const linkSel = svg
      .append('g')
      .selectAll<SVGLineElement, MapEdge>('line')
      .data(edges)
      .join('line')
      .attr('stroke', '#cfc8b8')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', (d) => (d.kind === 'project' ? '4 4' : null));

    const fire = (d: MapNode) => {
      if (d.kind === 'theme') onSelectRef.current({ kind: 'theme', theme: d.theme });
      else onSelectRef.current({ kind: 'project', project: d.project });
    };

    const nodeSel = svg
      .append('g')
      .selectAll<SVGGElement, MapNode>('g')
      .data(nodes)
      .join('g')
      .style('cursor', 'pointer')
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr('aria-label', (d) =>
        d.kind === 'theme' ? d.theme.label : `${d.project.label} · your project`,
      )
      .on('click', (_event, d) => fire(d))
      .on('keydown', (event: KeyboardEvent, d) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          fire(d);
        }
      })
      .on('focus', function () {
        select(this)
          .selectAll('circle[data-core]')
          .attr('stroke', SELECT_STROKE)
          .attr('stroke-width', 2.5);
      })
      .on('blur', () => applyCoreStrokes(svgEl, selectedRef.current));

    nodeSel.each(function (d) {
      const g = select(this);
      if (d.kind === 'project') {
        g.append('rect')
          .attr('x', -26)
          .attr('y', -13)
          .attr('width', 52)
          .attr('height', 26)
          .attr('rx', 2)
          .attr('fill', '#33302A');
        g.append('text')
          .text(d.project.label)
          .attr('text-anchor', 'middle')
          .attr('dy', 4)
          .attr('fill', '#f9f9f7')
          .attr('font-family', "'JetBrains Mono',monospace")
          .attr('font-size', 10);
        return;
      }
      const t = d.theme;
      const col = disciplineColor(t.discipline);
      if (t.mastery === 'position') {
        g.append('circle')
          .attr('r', d.r + 6)
          .attr('fill', 'none')
          .attr('stroke', '#D63A1A')
          .attr('stroke-width', 2)
          .attr('class', 'sp-pulse');
      }
      g.append('circle')
        .attr('r', d.r)
        .attr('fill', t.mastery === 'unread' ? 'none' : col)
        .attr('fill-opacity', t.mastery === 'unread' ? 0 : 0.9)
        .attr('stroke', t.mastery === 'unread' ? UNREAD_STROKE : col)
        .attr('stroke-width', t.mastery === 'unread' ? 1.2 : 1)
        .attr('stroke-dasharray', t.mastery === 'unread' ? '3 3' : null)
        .attr('data-core', '1');
      if (d.starred) {
        g.append('path')
          .attr('d', HORIZON_STAR_PATH)
          .attr('fill', '#1B3FBF')
          .attr('transform', `translate(${d.r * 0.9} ${-d.r * 0.9})`);
      }
      g.append('text')
        .text(t.label)
        .attr('text-anchor', 'middle')
        .attr('dy', d.r + 15)
        .attr('fill', '#211c15')
        .attr('font-family', "'JetBrains Mono',monospace")
        .attr('font-size', 11);
    });

    const ticked = () => {
      for (const n of nodes) {
        n.x = Math.max(n.r + 30, Math.min(W - n.r - 30, n.x ?? W / 2));
        n.y = Math.max(n.r + 20, Math.min(H - n.r - 24, n.y ?? H / 2));
      }
      linkSel
        .attr('x1', (d) => (d.source as MapNode).x ?? 0)
        .attr('y1', (d) => (d.source as MapNode).y ?? 0)
        .attr('x2', (d) => (d.target as MapNode).x ?? 0)
        .attr('y2', (d) => (d.target as MapNode).y ?? 0);
      nodeSel.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    };

    const sim = forceSimulation<MapNode>(nodes)
      .force(
        'link',
        forceLink<MapNode, MapEdge>(edges)
          .id((d) => d.id)
          .distance((l) => (l.kind === 'project' ? 105 : 88)),
      )
      .force('charge', forceManyBody<MapNode>().strength(-330))
      .force('center', forceCenter<MapNode>(W / 2, H / 2 - 10))
      .force('collide', forceCollide<MapNode>().radius((d) => d.r + 20))
      .on('tick', ticked);

    // Reduced motion: settle the layout synchronously and paint once, no
    // self-driven animation. Drag still works in discrete steps below.
    const reduceMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      sim.stop();
      const settleTicks = Math.ceil(Math.log(sim.alphaMin()) / Math.log(1 - sim.alphaDecay()));
      sim.tick(settleTicks);
      ticked();
    }

    const dragBehavior = drag<SVGGElement, MapNode>()
      .on('start', (event: D3DragEvent<SVGGElement, MapNode, MapNode>, d) => {
        if (!event.active && !reduceMotion) sim.alphaTarget(0.25).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event: D3DragEvent<SVGGElement, MapNode, MapNode>, d) => {
        d.fx = event.x;
        d.fy = event.y;
        if (reduceMotion) {
          // One constraint pass per pointer move: user-driven, not animated.
          sim.tick(1);
          ticked();
        }
      })
      .on('end', (event: D3DragEvent<SVGGElement, MapNode, MapNode>, d) => {
        if (!event.active && !reduceMotion) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
    nodeSel.call(dragBehavior);

    applyCoreStrokes(svgEl, selectedRef.current);

    return () => {
      sim.stop();
    };
  }, [themes, projects, links]);

  useEffect(() => {
    selectedRef.current = selectedId;
    applyCoreStrokes(ref.current, selectedId);
  }, [selectedId]);

  return (
    <svg
      ref={ref}
      className="sp-svg"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      aria-label="theme constellation"
    />
  );
}
