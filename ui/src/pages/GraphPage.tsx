import { useEffect, useRef, useState } from 'react';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, zoomTransform } from 'd3-zoom';
import { listNodes } from '../api/client';
import { listEdges } from '../api/client';
import type { Node, Edge } from '../api/types';
import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';

interface GraphNode extends SimulationNodeDatum {
  id: string;
  title: string;
  type: string;
  activation: number;
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  id: string;
  type: string;
  weight: number;
}

const NODE_COLORS: Record<string, string> = {
  concept: 'var(--color-accent)',
  entity: '#34d399',
  preference: '#f59e0b',
  goal: '#f87171',
  habit: '#a78bfa',
  observation: '#8b8fa3',
};

function nodeRadius(activation: number): number {
  return Math.max(4, activation * 8);
}

export default function GraphPage() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    let stopped = false;

    const loadAndRender = async () => {
      try {
        const [nodes, edges] = await Promise.all([
          listNodes({ limit: 500 }),
          listEdges({ limit: 1000 }),
        ]);

        if (stopped) return;

        const nodeMap = new Map<string, GraphNode>();
        const graphNodes: GraphNode[] = nodes.map((n: Node) => {
          const gn: GraphNode = {
            id: n.id,
            title: n.title,
            type: n.type,
            activation: n.activation,
          };
          nodeMap.set(n.id, gn);
          return gn;
        });

        const graphLinks: GraphLink[] = edges
          .filter((e: Edge) => nodeMap.has(e.source_id) && nodeMap.has(e.target_id))
          .map((e: Edge) => ({
            id: e.id,
            source: nodeMap.get(e.source_id)!,
            target: nodeMap.get(e.target_id)!,
            type: e.type,
            weight: e.weight,
          }));

        renderGraph(svg, graphNodes, graphLinks);
        setLoading(false);
      } catch (err) {
        if (!stopped) {
          setError((err as Error).message);
          setLoading(false);
        }
      }
    };

    function renderGraph(
      svgEl: SVGSVGElement,
      nodes: GraphNode[],
      links: GraphLink[],
    ) {
      const width = svgEl.clientWidth || 800;
      const height = svgEl.clientHeight || 600;

      const svgSel = select(svgEl);
      svgSel.selectAll('*').remove();

      const g = svgSel.append('g');

      const zoomBehavior = zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
          g.attr('transform', event.transform);
        });

      svgSel.call(zoomBehavior);
      svgSel.call(zoomBehavior.transform, zoomIdentity);

      const simulation = forceSimulation<GraphNode>(nodes)
        .force(
          'link',
          forceLink<GraphNode, GraphLink>(links)
            .id((d) => d.id)
            .distance(80)
            .strength((d) => Math.min(1, (d as GraphLink).weight * 0.5)),
        )
        .force('charge', forceManyBody().strength(-120))
        .force('center', forceCenter(width / 2, height / 2))
        .force('collide', forceCollide<GraphNode>().radius((d) => nodeRadius(d.activation) + 2));

      const linkSel = g
        .append('g')
        .attr('stroke', 'var(--color-border)')
        .selectAll('line')
        .data(links)
        .join('line')
        .attr('stroke-width', (d) => Math.max(0.5, d.weight * 2))
        .attr('stroke-opacity', 0.6);

      const nodeSel = g
        .append('g')
        .selectAll('g')
        .data(nodes)
        .join('g')
        .attr('cursor', 'grab');

      nodeSel
        .append('circle')
        .attr('r', (d) => nodeRadius(d.activation))
        .attr('fill', (d) => NODE_COLORS[d.type] || 'var(--color-text-muted)')
        .attr('stroke', 'var(--color-bg)')
        .attr('stroke-width', 1.5);

      nodeSel
        .append('title')
        .text((d) => `${d.title} (${d.type}, activation: ${d.activation.toFixed(2)})`);

      nodeSel
        .append('text')
        .text((d) => d.title)
        .attr('x', (d) => nodeRadius(d.activation) + 4)
        .attr('y', 4)
        .attr('fill', 'var(--color-text-muted)')
        .attr('font-size', '11px')
        .style('pointer-events', 'none');

      // Drag behavior
      let dragTarget: GraphNode | null = null;

      nodeSel.on('mousedown', (event, d) => {
        dragTarget = d;
        d.fx = d.x;
        d.fy = d.y;
        simulation.alphaTarget(0.3).restart();
        event.stopPropagation();
      });

      svgSel.on('mousemove', (event) => {
        if (!dragTarget) return;
        const t = zoomTransform(svgEl);
        const [mx, my] = t.invert([event.offsetX, event.offsetY]);
        dragTarget.fx = mx;
        dragTarget.fy = my;
      });

      svgSel.on('mouseup', () => {
        if (!dragTarget) return;
        simulation.alphaTarget(0);
        dragTarget.fx = null;
        dragTarget.fy = null;
        dragTarget = null;
      });

      simulation.on('tick', () => {
        linkSel
          .attr('x1', (d) => (d.source as GraphNode).x!)
          .attr('y1', (d) => (d.source as GraphNode).y!)
          .attr('x2', (d) => (d.target as GraphNode).x!)
          .attr('y2', (d) => (d.target as GraphNode).y!);

        nodeSel.attr('transform', (d) => `translate(${d.x},${d.y})`);
      });

      // Store simulation for cleanup
      (svgEl as unknown as { __simulation: typeof simulation }).__simulation =
        simulation;
    }

    loadAndRender();

    return () => {
      stopped = true;
      const sim = (svg as unknown as { __simulation?: { stop: () => void } })
        .__simulation;
      if (sim) sim.stop();
      select(svg).selectAll('*').remove();
    };
  }, []);

  if (error) return <p style={{ color: '#f87171' }}>Error: {error}</p>;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <h1 style={{ marginBottom: '1rem' }}>Graph</h1>
      {loading && <p>Loading graph...</p>}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <svg
          ref={svgRef}
          style={{
            width: '100%',
            height: '100%',
            position: 'absolute',
            top: 0,
            left: 0,
            background: 'var(--color-bg)',
          }}
        />
      </div>
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          padding: '0.75rem 0',
          fontSize: '12px',
          color: 'var(--color-text-muted)',
          flexWrap: 'wrap',
        }}
      >
        {Object.entries(NODE_COLORS).map(([type, color]) => (
          <span key={type} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: color,
                display: 'inline-block',
              }}
            />
            {type}
          </span>
        ))}
      </div>
    </div>
  );
}
