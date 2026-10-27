import { useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import svgExport from 'cytoscape-svg';
import { Download, Maximize2, Minus, Plus, Crosshair } from 'lucide-react';
import type { NetworkGraph } from '@/lib/temporal/network';

// Register the SVG exporter once per module load.
let registered = false;
function ensureSvgPlugin() {
  if (!registered) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cytoscape.use(svgExport as any);
    registered = true;
  }
}

export interface NetworkSelection {
  type: 'node' | 'edge';
  id: string;
}

interface Props {
  graph: NetworkGraph;
  /** Bumped whenever filters change, to reset the inspector panel. */
  selection: NetworkSelection | null;
  onSelect: (sel: NetworkSelection | null) => void;
  minEdgeWeight: number;
  probabilityMode: boolean;
  height?: number;
  filename: string;
}

/**
 * Force-directed network with coloured nodes, curved edges, arrows, zoom/pan,
 * hover tooltips and click inspection. Nodes sized by frequency, edges by
 * transition count (or normalised probability in probabilityMode).
 */
export default function NetworkGraphView({ graph, selection, onSelect, minEdgeWeight, probabilityMode, height = 420, filename }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cyRef = useRef<any>(null);
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    ensureSvgPlugin();
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      elements: [],
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'background-color': 'data(color)',
            width: 'data(size)' as unknown as string,
            height: 'data(size)' as unknown as string,
            'font-size': 11,
            color: '#0f172a',
            'text-valign': 'bottom',
            'text-margin-y': 6,
            'text-wrap': 'wrap',
            'text-max-width': 110 as unknown as string,
            'border-width': 1.5,
            'border-color': '#ffffff',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 'data(width)' as unknown as string,
            'curve-style': 'bezier',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.9,
            'line-color': '#94a3b8',
            'target-arrow-color': '#94a3b8',
            opacity: 0.85,
            label: 'data(label)',
            'font-size': 9,
            color: '#475569',
            'text-background-color': '#f8fafc',
            'text-background-opacity': 0.85,
            'text-background-padding': 2 as unknown as string,
            'text-background-shape': 'roundrectangle',
          },
        },
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#1d4ed8' } },
        { selector: 'edge:selected', style: { 'line-color': '#1d4ed8', 'target-arrow-color': '#1d4ed8', opacity: 1 } },
      ],
      layout: { name: 'cose', animate: false, randomize: false, idealEdgeLength: 90, nodeOverlap: 24, nodeRepulsion: 9000, gravity: 0.6, padding: 30 } as cytoscape.LayoutOptions,
      wheelSensitivity: 0.2,
    });
    cyRef.current = cy;

    cy.on('mouseover', 'node, edge', (evt) => {
      const el = evt.target;
      const text = el.isNode()
        ? `${el.data('label')} — ${el.data('frequency')} recorded event(s)`
        : `${el.data('sourceLabel')} → ${el.data('targetLabel')} — ${el.data('rawWeight')} transition(s), ${Number(el.data('prob')).toFixed(1)}% of outgoing`;
      const container = containerRef.current!;
      const rect = container.getBoundingClientRect();
      setHover({ x: evt.renderedPosition.x * (rect.width / cy.width()) + 12, y: evt.renderedPosition.y * (rect.height / cy.height()) + 12, text });
    });
    cy.on('mouseout', () => setHover(null));
    cy.on('tap', 'node, edge', (evt) => onSelect({ type: evt.target.isNode() ? 'node' : 'edge', id: evt.target.id() }));
    cy.on('tap', (evt) => { if (evt.target === cy) onSelect(null); });

    setReady(true);
    return () => { cy.destroy(); cyRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update elements when graph / filters change, preserving positions.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !ready) return;
    const maxFreq = Math.max(1, ...graph.nodes.map((n) => n.frequency));
    const maxW = Math.max(1, ...graph.edges.map((e) => e.weight));
    const labelById = new Map(graph.nodes.map((n) => [n.id, n.label]));

    cy.batch(() => {
      cy.elements().remove();
      for (const n of graph.nodes) {
        cy.add({
          group: 'nodes',
          data: {
            id: n.id, label: n.label, color: n.color, frequency: n.frequency,
            size: 26 + 44 * Math.sqrt(n.frequency / maxFreq),
          },
        });
      }
      for (const e of graph.edges) {
        if (e.weight < minEdgeWeight) continue;
        cy.add({
          group: 'edges',
          data: {
            id: e.id, source: e.source, target: e.target,
            rawWeight: e.weight,
            prob: e.probability * 100,
            width: 1.5 + 6.5 * (probabilityMode ? e.probability : e.weight / maxW),
            label: probabilityMode ? `${(e.probability * 100).toFixed(0)}%` : String(e.weight),
            sourceLabel: labelById.get(e.source) ?? e.source,
            targetLabel: labelById.get(e.target) ?? e.target,
          },
        });
      }
    });
    cy.layout({ name: 'cose', animate: false, randomize: false, idealEdgeLength: 90, nodeOverlap: 24, nodeRepulsion: 9000, gravity: 0.6, padding: 30 } as cytoscape.LayoutOptions).run();
    cy.fit(undefined, 30);
  }, [graph, minEdgeWeight, probabilityMode, ready]);

  // Reflect external selection (cleared when filters change).
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !ready) return;
    cy.elements().unselect();
    if (selection) {
      const el = cy.getElementById(selection.id);
      if (el.nonempty()) el.select();
      else onSelect(null);
    }
  }, [selection, ready, onSelect]);

  function download(kind: 'svg' | 'png') {
    const cy = cyRef.current;
    if (!cy) return;
    let blob: Blob;
    if (kind === 'svg') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svgStr = (cy as any).svg({ full: true, scale: 1, bg: '#f8fafc' });
      blob = new Blob([svgStr], { type: 'image/svg+xml' });
    } else {
      blob = new Blob([cy.png({ full: true, scale: 2, bg: '#f8fafc' })], { type: 'image/png' });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.${kind}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span>Node size = event frequency · Edge thickness = {probabilityMode ? 'normalised probability' : 'transition count'} · Arrows show temporal order</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => cyRef.current?.zoom(cyRef.current.zoom() * 1.25)} title="Zoom in" className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-50"><Plus className="w-3.5 h-3.5" /></button>
          <button onClick={() => cyRef.current?.zoom(cyRef.current.zoom() / 1.25)} title="Zoom out" className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-50"><Minus className="w-3.5 h-3.5" /></button>
          <button onClick={() => { cyRef.current?.fit(undefined, 30); }} title="Fit to view" className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-50"><Maximize2 className="w-3.5 h-3.5" /></button>
          <button onClick={() => cyRef.current?.layout({ name: 'cose', animate: true, idealEdgeLength: 90, nodeOverlap: 24, nodeRepulsion: 9000, gravity: 0.6, padding: 30 } as cytoscape.LayoutOptions).run()} title="Re-run layout" className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-50"><Crosshair className="w-3.5 h-3.5" /></button>
          <button onClick={() => download('svg')} className="flex items-center gap-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 hover:bg-slate-50"><Download className="w-3.5 h-3.5" /> SVG</button>
          <button onClick={() => download('png')} className="flex items-center gap-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 hover:bg-slate-50"><Download className="w-3.5 h-3.5" /> PNG</button>
        </div>
      </div>
      <div ref={containerRef} style={{ height, background: '#f8fafc' }} className="rounded-lg border border-slate-200 w-full" />
      {hover && (
        <div className="pointer-events-none absolute z-10 bg-slate-900 text-white text-[11px] rounded-md px-2.5 py-1.5 shadow-lg" style={{ left: hover.x, top: hover.y }}>
          {hover.text}
        </div>
      )}
      {graph.nodes.length === 0 && (
        <div className="absolute inset-0 top-8 flex items-center justify-center text-sm text-slate-400">No recorded activity in scope — nothing to plot.</div>
      )}
    </div>
  );
}
