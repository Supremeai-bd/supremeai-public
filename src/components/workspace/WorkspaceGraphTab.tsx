import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  GitGraph,
  Search,
  RotateCw,
  ArrowRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Sparkles,
  Plus,
  Link2,
  FileCode2,
  Trash2,
  X,
} from 'lucide-react';
import {
  graphService,
  GraphNode,
  GraphEdge,
  GraphData,
  GraphPositionMap,
  loadCustomGraph,
  saveCustomGraph,
  parseMermaidFlowchartToGraph,
  computeShortestPathBFS,
} from '../../services/graphService';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { useI18n } from '../../utils/i18n';

type GraphMode = 'custom' | 'topology';

function computeCircularPositions(nodes: GraphNode[]): GraphPositionMap {
  const count = nodes.length;
  const positions: GraphPositionMap = {};
  if (count === 0) return positions;
  const radius = count === 1 ? 0 : Math.min(185, Math.max(120, count * 17));
  const centerX = 320;
  const centerY = 240;

  nodes.forEach((node, idx) => {
    const angle = (idx / count) * 2 * Math.PI - Math.PI / 2;
    positions[node.id] = {
      x: Math.round(centerX + radius * Math.cos(angle)),
      y: Math.round(centerY + radius * Math.sin(angle)),
    };
  });

  return positions;
}

export const WorkspaceGraphTab: React.FC = () => {
  const { t } = useI18n();
  const mermaidGraphSource = useWorkspaceStore((s) => s.mermaidGraphSource);

  const initialCustom = useMemo(() => loadCustomGraph(), []);
  const [graphMode, setGraphMode] = useState<GraphMode>('custom');
  const [customGraph, setCustomGraph] = useState<GraphData>(initialCustom.graph);
  const [customPositions, setCustomPositions] = useState<GraphPositionMap>(initialCustom.positions);

  const [topologyGraph, setTopologyGraph] = useState<GraphData>({ nodes: [], edges: [] });
  const [topologyPositions, setTopologyPositions] = useState<GraphPositionMap>({});
  const [isLoadingTopology, setIsLoadingTopology] = useState<boolean>(false);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    initialCustom.graph.nodes[0]?.id ?? null
  );
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  // Interactive Custom Graph Creation State
  const [activePanel, setActivePanel] = useState<'none' | 'node' | 'edge' | 'mermaid'>('none');
  const [newNodeLabel, setNewNodeLabel] = useState('');
  const [newNodeCategory, setNewNodeCategory] = useState('');
  const [edgeSourceId, setEdgeSourceId] = useState('');
  const [edgeTargetId, setEdgeTargetId] = useState('');
  const [edgeLabel, setEdgeLabel] = useState('');
  const [mermaidDraft, setMermaidDraft] = useState(mermaidGraphSource || '');

  // Path Solver
  const [pathFromNode, setPathFromNode] = useState<string>('');
  const [pathToNode, setPathToNode] = useState<string>('');
  const [calculatedPath, setCalculatedPath] = useState<string[] | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const panStartRef = useRef<{
    clientX: number;
    clientY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const dragNodeRef = useRef<{
    id: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickNodeRef = useRef<string | null>(null);

  const activeGraph = graphMode === 'custom' ? customGraph : topologyGraph;
  const activeCustomPositions = graphMode === 'custom' ? customPositions : topologyPositions;

  // Persist custom graph & positions to localStorage
  useEffect(() => {
    saveCustomGraph(customGraph, customPositions);
  }, [customGraph, customPositions]);

  // Sync Mermaid source sent from Chat or Code tab
  useEffect(() => {
    if (!mermaidGraphSource.trim()) return;
    setMermaidDraft(mermaidGraphSource);
    const parsed = parseMermaidFlowchartToGraph(mermaidGraphSource);
    if (parsed.nodes.length > 0 && customGraph.nodes.length === 0) {
      setCustomGraph(parsed);
      setCustomPositions(computeCircularPositions(parsed.nodes));
      setSelectedNodeId(parsed.nodes[0]?.id ?? null);
    }
  }, [mermaidGraphSource]);

  const fetchTopologyGraph = useCallback(async () => {
    setIsLoadingTopology(true);
    try {
      const data = await graphService.getSkillGraph();
      setTopologyGraph(data);
      setTopologyPositions({});
      if (data.nodes.length > 0) {
        setSelectedNodeId((prev) =>
          prev && data.nodes.some((n) => n.id === prev) ? prev : data.nodes[0].id
        );
      }
    } finally {
      setIsLoadingTopology(false);
    }
  }, []);

  useEffect(() => {
    if (graphMode === 'topology' && topologyGraph.nodes.length === 0) {
      fetchTopologyGraph();
    }
  }, [graphMode, topologyGraph.nodes.length, fetchTopologyGraph]);

  // Mouse wheel zoom with passive: false
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.12 : -0.12;
      setZoomLevel((z) => Math.min(2.4, Math.max(0.45, Number((z + delta).toFixed(2)))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const categories = useMemo(() => {
    const set = new Set<string>();
    activeGraph.nodes.forEach((n) => {
      if (n.data?.category) set.add(n.data.category);
    });
    return Array.from(set);
  }, [activeGraph.nodes]);

  const filteredNodes = useMemo(() => {
    return activeGraph.nodes.filter((n) => {
      const matchCat = filterCategory === 'all' || n.data?.category === filterCategory;
      const matchQuery =
        !searchQuery.trim() ||
        n.data?.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.id.toLowerCase().includes(searchQuery.toLowerCase());
      return matchCat && matchQuery;
    });
  }, [activeGraph.nodes, filterCategory, searchQuery]);

  const defaultPositions = useMemo(() => computeCircularPositions(filteredNodes), [filteredNodes]);

  const nodePositions = useMemo(() => {
    const merged: GraphPositionMap = {};
    filteredNodes.forEach((n) => {
      merged[n.id] = activeCustomPositions[n.id] || defaultPositions[n.id] || { x: 320, y: 240 };
    });
    return merged;
  }, [filteredNodes, activeCustomPositions, defaultPositions]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, GraphNode>();
    activeGraph.nodes.forEach((n) => map.set(n.id, n));
    return map;
  }, [activeGraph.nodes]);

  const selectedNode = useMemo(
    () => (selectedNodeId ? nodeMap.get(selectedNodeId) || null : null),
    [selectedNodeId, nodeMap]
  );

  const pathNodeSet = useMemo(() => new Set(calculatedPath || []), [calculatedPath]);
  const pathEdgePairs = useMemo(() => {
    const pairs = new Set<string>();
    if (!calculatedPath || calculatedPath.length < 2) return pairs;
    for (let i = 0; i < calculatedPath.length - 1; i++) {
      const a = calculatedPath[i];
      const b = calculatedPath[i + 1];
      pairs.add(`${a}::${b}`);
      pairs.add(`${b}::${a}`);
    }
    return pairs;
  }, [calculatedPath]);

  const handleCalculatePath = async () => {
    const fromId = pathFromNode || selectedNode?.id || '';
    if (!fromId || !pathToNode) return;
    if (graphMode === 'custom') {
      setCalculatedPath(computeShortestPathBFS(activeGraph, fromId, pathToNode));
      return;
    }
    const path = await graphService.getLearningPath(fromId, pathToNode, activeGraph);
    setCalculatedPath(path);
  };

  const handleAddNode = (e: React.FormEvent) => {
    e.preventDefault();
    const label = newNodeLabel.trim();
    if (!label) return;
    const baseSlug =
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'node';
    let id = baseSlug;
    let suffix = 2;
    while (customGraph.nodes.some((n) => n.id === id)) {
      id = `${baseSlug}-${suffix++}`;
    }

    const nextNode: GraphNode = {
      id,
      data: {
        label,
        ...(newNodeCategory.trim() ? { category: newNodeCategory.trim() } : { category: 'Custom' }),
      },
    };
    const nextNodes = [...customGraph.nodes, nextNode];
    const angle = (nextNodes.length * 1.1) % (2 * Math.PI);
    const r = nextNodes.length === 1 ? 0 : 120;
    setCustomGraph({ ...customGraph, nodes: nextNodes });
    setCustomPositions((prev) => ({
      ...prev,
      [id]: {
        x: Math.round(320 + r * Math.cos(angle)),
        y: Math.round(240 + r * Math.sin(angle)),
      },
    }));
    setSelectedNodeId(id);
    setNewNodeLabel('');
    setNewNodeCategory('');
    setActivePanel('none');
  };

  const handleAddEdge = (e: React.FormEvent) => {
    e.preventDefault();
    const source = edgeSourceId || customGraph.nodes[0]?.id || '';
    const target = edgeTargetId || customGraph.nodes[1]?.id || '';
    if (!source || !target || source === target) return;
    const newEdge: GraphEdge = {
      id: `ce-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      source,
      target,
      ...(edgeLabel.trim() ? { label: edgeLabel.trim() } : {}),
    };
    setCustomGraph((prev) => ({ ...prev, edges: [...prev.edges, newEdge] }));
    setEdgeLabel('');
    setActivePanel('none');
    setCalculatedPath(null);
  };

  const handleImportMermaid = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseMermaidFlowchartToGraph(mermaidDraft);
    if (parsed.nodes.length === 0) return;
    setCustomGraph(parsed);
    setCustomPositions(computeCircularPositions(parsed.nodes));
    setSelectedNodeId(parsed.nodes[0]?.id ?? null);
    setCalculatedPath(null);
    setActivePanel('none');
  };

  const handleDeleteNode = (nodeId: string) => {
    if (graphMode !== 'custom') return;
    const remainingNodes = customGraph.nodes.filter((n) => n.id !== nodeId);
    const remainingEdges = customGraph.edges.filter(
      (e) => e.source !== nodeId && e.target !== nodeId
    );
    setCustomGraph({ nodes: remainingNodes, edges: remainingEdges });
    setCustomPositions((prev) => {
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
    if (selectedNodeId === nodeId) {
      setSelectedNodeId(remainingNodes[0]?.id ?? null);
    }
    setCalculatedPath(null);
  };

  const handleDeleteEdge = (edgeId: string) => {
    if (graphMode !== 'custom') return;
    setCustomGraph((prev) => ({
      ...prev,
      edges: prev.edges.filter((e) => e.id !== edgeId),
    }));
    setCalculatedPath(null);
  };

  const handleClearCustomGraph = () => {
    setCustomGraph({ nodes: [], edges: [] });
    setCustomPositions({});
    setSelectedNodeId(null);
    setCalculatedPath(null);
  };

  const handleNodeMouseDown = (e: React.MouseEvent<SVGGElement>, nodeId: string) => {
    e.stopPropagation();
    const pos = nodePositions[nodeId] || { x: 320, y: 240 };
    dragNodeRef.current = {
      id: nodeId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origX: pos.x,
      origY: pos.y,
      moved: false,
    };
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('g[data-node="true"]')) return;
    setIsPanning(true);
    panStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      origX: panOffset.x,
      origY: panOffset.y,
    };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (dragNodeRef.current) {
      const drag = dragNodeRef.current;
      const dxClient = e.clientX - drag.startClientX;
      const dyClient = e.clientY - drag.startClientY;
      if (!drag.moved && Math.hypot(dxClient, dyClient) > 4) {
        drag.moved = true;
      }
      if (drag.moved) {
        const rect = svgRef.current?.getBoundingClientRect();
        // Convert client pixel delta to SVG 640x480 units cleanly
        const scaleX = rect && rect.width > 0 ? 640 / rect.width : 1 / zoomLevel;
        const scaleY = rect && rect.height > 0 ? 480 / rect.height : 1 / zoomLevel;
        const nextPos = {
          x: Math.max(24, Math.min(616, Math.round(drag.origX + dxClient * scaleX))),
          y: Math.max(24, Math.min(456, Math.round(drag.origY + dyClient * scaleY))),
        };
        if (graphMode === 'custom') {
          setCustomPositions((prev) => ({ ...prev, [drag.id]: nextPos }));
        } else {
          setTopologyPositions((prev) => ({ ...prev, [drag.id]: nextPos }));
        }
      }
      return;
    }

    if (!isPanning || !panStartRef.current) return;
    const dx = e.clientX - panStartRef.current.clientX;
    const dy = e.clientY - panStartRef.current.clientY;
    setPanOffset({
      x: panStartRef.current.origX + dx,
      y: panStartRef.current.origY + dy,
    });
  };

  const handleCanvasMouseUp = () => {
    if (dragNodeRef.current) {
      if (dragNodeRef.current.moved) {
        suppressClickNodeRef.current = dragNodeRef.current.id;
      }
      dragNodeRef.current = null;
    }
    setIsPanning(false);
    panStartRef.current = null;
  };

  const handleResetView = () => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
    if (graphMode === 'topology') {
      setTopologyPositions({});
    }
  };

  const getCategoryColor = (category?: string) => {
    const lower = (category || '').toLowerCase();
    if (lower.includes('frontend') || lower.includes('language')) {
      return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
    }
    if (lower.includes('gateway') || lower.includes('framework') || lower.includes('mermaid')) {
      return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30';
    }
    if (lower.includes('data') || lower.includes('database')) {
      return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
    }
    if (lower.includes('ai') || lower.includes('multimodal')) {
      return 'text-purple-400 bg-purple-500/10 border-purple-500/30';
    }
    if (lower.includes('service') || lower.includes('workspace') || lower.includes('custom')) {
      return 'text-blue-400 bg-blue-500/10 border-blue-500/30';
    }
    return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-950 text-slate-100 font-sans">
      {/* Top Filter and Controls Bar */}
      <div className="px-3 py-2 border-b border-slate-800 bg-slate-900/90 backdrop-blur-md flex flex-wrap items-center justify-between gap-2 text-xs">
        {/* Mode Switcher + Search */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center p-0.5 rounded-lg bg-slate-800 border border-slate-700/80 text-[11px]">
            <button
              type="button"
              onClick={() => {
                setGraphMode('custom');
                setCalculatedPath(null);
                setSelectedNodeId(customGraph.nodes[0]?.id ?? null);
              }}
              className={`px-2 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                graphMode === 'custom'
                  ? 'bg-cyan-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              {t.wsGraphModeCustom}
            </button>
            <button
              type="button"
              onClick={() => {
                setGraphMode('topology');
                setActivePanel('none');
                setCalculatedPath(null);
                setSelectedNodeId(topologyGraph.nodes[0]?.id ?? null);
              }}
              className={`px-2 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                graphMode === 'topology'
                  ? 'bg-cyan-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              {t.wsGraphModeTopology}
            </button>
          </div>

          <div className="flex items-center gap-1.5 min-w-[140px] max-w-[200px]">
            <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.wsGraphSearchPlaceholder}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white placeholder-slate-400 outline-none focus:border-cyan-500 font-mono"
            />
          </div>
        </div>

        {/* Builder + Zoom Actions */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {graphMode === 'custom' && (
            <>
              <button
                type="button"
                onClick={() => setActivePanel((p) => (p === 'node' ? 'none' : 'node'))}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer ${
                  activePanel === 'node'
                    ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                }`}
              >
                <Plus className="w-3 h-3 text-cyan-400" />
                <span>{t.wsGraphAddNode.replace(/^\+\s*/, '')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!edgeSourceId && customGraph.nodes[0])
                    setEdgeSourceId(customGraph.nodes[0].id);
                  if (!edgeTargetId && customGraph.nodes[1])
                    setEdgeTargetId(customGraph.nodes[1].id);
                  setActivePanel((p) => (p === 'edge' ? 'none' : 'edge'));
                }}
                disabled={customGraph.nodes.length < 2}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-40 ${
                  activePanel === 'edge'
                    ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                }`}
              >
                <Link2 className="w-3 h-3 text-cyan-400" />
                <span>{t.wsGraphAddEdge.replace(/^\+\s*/, '')}</span>
              </button>
              <button
                type="button"
                onClick={() => setActivePanel((p) => (p === 'mermaid' ? 'none' : 'mermaid'))}
                className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer ${
                  activePanel === 'mermaid'
                    ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300'
                    : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                }`}
              >
                <FileCode2 className="w-3 h-3 text-cyan-400" />
                <span>{t.wsGraphImportMermaid}</span>
              </button>
              {customGraph.nodes.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearCustomGraph}
                  title={t.wsGraphClear}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-500/15 border border-slate-700 hover:border-rose-500/40 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}

          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 outline-none cursor-pointer"
          >
            <option value="all">
              {t.wsGraphAllCategories} ({activeGraph.nodes.length})
            </option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.min(2.4, Number((z + 0.15).toFixed(2))))}
            title={t.wsGraphZoomIn}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.max(0.45, Number((z - 0.15).toFixed(2))))}
            title={t.wsGraphZoomOut}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleResetView}
            title={t.wsGraphResetView}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          {graphMode === 'topology' && (
            <button
              type="button"
              onClick={fetchTopologyGraph}
              title={t.wsGraphRefresh}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
            >
              <RotateCw
                className={`w-3.5 h-3.5 ${isLoadingTopology ? 'animate-spin text-cyan-400' : ''}`}
              />
            </button>
          )}
        </div>
      </div>

      {/* Inline Custom Builder Forms */}
      {graphMode === 'custom' && activePanel === 'node' && (
        <form
          onSubmit={handleAddNode}
          className="px-3 py-2 border-b border-slate-800 bg-slate-900/95 flex flex-wrap items-center gap-2 text-xs"
        >
          <input
            type="text"
            value={newNodeLabel}
            onChange={(e) => setNewNodeLabel(e.target.value)}
            placeholder={t.wsGraphNodeLabelPlaceholder}
            autoFocus
            className="flex-1 min-w-[150px] max-w-xs bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-xs text-white outline-none focus:border-cyan-500"
          />
          <input
            type="text"
            value={newNodeCategory}
            onChange={(e) => setNewNodeCategory(e.target.value)}
            placeholder={t.wsGraphCategoryPlaceholder}
            className="w-36 bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-xs text-white outline-none focus:border-cyan-500"
          />
          <button
            type="submit"
            className="px-3 py-1 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold cursor-pointer"
          >
            {t.addBtn}
          </button>
          <button
            type="button"
            onClick={() => setActivePanel('none')}
            className="p-1 text-slate-400 hover:text-slate-200 cursor-pointer"
            aria-label={t.cancelBtn}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </form>
      )}

      {graphMode === 'custom' && activePanel === 'edge' && (
        <form
          onSubmit={handleAddEdge}
          className="px-3 py-2 border-b border-slate-800 bg-slate-900/95 flex flex-wrap items-center gap-2 text-xs"
        >
          <select
            value={edgeSourceId}
            onChange={(e) => setEdgeSourceId(e.target.value)}
            aria-label={t.wsGraphEdgeSource}
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100"
          >
            {customGraph.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.data.label}
              </option>
            ))}
          </select>
          <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
          <select
            value={edgeTargetId}
            onChange={(e) => setEdgeTargetId(e.target.value)}
            aria-label={t.wsGraphEdgeTarget}
            className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-100"
          >
            {customGraph.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.data.label}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={edgeLabel}
            onChange={(e) => setEdgeLabel(e.target.value)}
            placeholder={t.wsGraphEdgeLabelPlaceholder}
            className="w-40 bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-xs text-white outline-none focus:border-cyan-500"
          />
          <button
            type="submit"
            className="px-3 py-1 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold cursor-pointer"
          >
            {t.addBtn}
          </button>
          <button
            type="button"
            onClick={() => setActivePanel('none')}
            className="p-1 text-slate-400 hover:text-slate-200 cursor-pointer"
            aria-label={t.cancelBtn}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </form>
      )}

      {graphMode === 'custom' && activePanel === 'mermaid' && (
        <form
          onSubmit={handleImportMermaid}
          className="px-3 py-2 border-b border-slate-800 bg-slate-900/95 flex flex-col gap-2 text-xs"
        >
          <textarea
            value={mermaidDraft}
            onChange={(e) => setMermaidDraft(e.target.value)}
            rows={3}
            placeholder={t.wsGraphMermaidPlaceholder}
            className="w-full bg-slate-950 border border-slate-700 rounded px-2.5 py-1.5 text-xs font-mono text-cyan-100 outline-none focus:border-cyan-500"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setActivePanel('none')}
              className="px-2.5 py-1 rounded border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
            >
              {t.cancelBtn}
            </button>
            <button
              type="submit"
              className="px-3 py-1 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold cursor-pointer"
            >
              {t.wsGraphImportMermaid}
            </button>
          </div>
        </form>
      )}

      {/* Main Canvas + Responsive Inspector Split */}
      <div className="flex-1 flex flex-col xl:flex-row overflow-hidden relative min-h-0">
        {/* SVG Graph Canvas */}
        <div
          ref={canvasRef}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          className={`flex-1 min-h-[260px] overflow-hidden relative flex items-center justify-center bg-[radial-gradient(ellipse_60%_50%_at_50%_50%,rgba(14,165,233,0.08),transparent)] ${
            isPanning ? 'cursor-grabbing' : 'cursor-grab'
          }`}
        >
          {activeGraph.nodes.length === 0 ? (
            <div className="max-w-sm px-6 text-center space-y-3 pointer-events-auto">
              <div className="w-11 h-11 rounded-2xl mx-auto flex items-center justify-center bg-cyan-500/10 border border-cyan-500/25 text-cyan-400">
                <GitGraph className="w-5 h-5" />
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">{t.wsGraphEmptyCustom}</p>
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setActivePanel('node')}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs cursor-pointer"
                >
                  {t.wsGraphAddNode}
                </button>
                <button
                  type="button"
                  onClick={() => setActivePanel('mermaid')}
                  className="px-3 py-1.5 rounded-lg border border-slate-700 hover:border-cyan-500/40 text-slate-200 text-xs cursor-pointer"
                >
                  {t.wsGraphImportMermaid}
                </button>
              </div>
            </div>
          ) : (
            <svg
              ref={svgRef}
              viewBox="0 0 640 480"
              style={{
                transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`,
                transformOrigin: 'center center',
              }}
              className="w-full h-full max-w-full max-h-full select-none transition-transform duration-75"
            >
              <defs>
                <marker
                  id="graph-arrow"
                  viewBox="0 0 10 10"
                  refX="24"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#0ea5e9" opacity="0.65" />
                </marker>
              </defs>

              {/* Edges */}
              {activeGraph.edges.map((edge) => {
                const start = nodePositions[edge.source];
                const end = nodePositions[edge.target];
                if (!start || !end) return null;

                const isOnCalculatedPath = pathEdgePairs.has(`${edge.source}::${edge.target}`);
                const isHighlighted =
                  isOnCalculatedPath ||
                  (selectedNode &&
                    (selectedNode.id === edge.source || selectedNode.id === edge.target));

                return (
                  <g key={edge.id}>
                    <line
                      x1={start.x}
                      y1={start.y}
                      x2={end.x}
                      y2={end.y}
                      stroke={
                        isOnCalculatedPath ? '#34d399' : isHighlighted ? '#06b6d4' : '#334155'
                      }
                      strokeWidth={isOnCalculatedPath ? 3 : isHighlighted ? 2.2 : 1.2}
                      strokeDasharray={isHighlighted ? 'none' : '4 3'}
                      markerEnd="url(#graph-arrow)"
                      className="transition-all"
                    />
                    {edge.label && (
                      <text
                        x={(start.x + end.x) / 2}
                        y={(start.y + end.y) / 2 - 4}
                        fill={isOnCalculatedPath ? '#6ee7b7' : '#64748b'}
                        fontSize="8.5"
                        fontFamily="monospace"
                        textAnchor="middle"
                      >
                        {edge.label}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Nodes */}
              {filteredNodes.map((node) => {
                const pos = nodePositions[node.id];
                if (!pos) return null;
                const isSelected = selectedNode?.id === node.id;
                const isOnPath = pathNodeSet.has(node.id);
                const label = node.data?.label || node.id;

                return (
                  <g
                    key={node.id}
                    data-node="true"
                    transform={`translate(${pos.x}, ${pos.y})`}
                    onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                    onClick={() => {
                      if (suppressClickNodeRef.current === node.id) {
                        suppressClickNodeRef.current = null;
                        return;
                      }
                      setSelectedNodeId(node.id);
                    }}
                    className="cursor-pointer group"
                  >
                    <title>{label}</title>
                    <circle
                      r={isSelected ? 26 : isOnPath ? 23 : 20}
                      fill={isSelected ? '#0891b2' : isOnPath ? '#065f46' : '#0f172a'}
                      stroke={isSelected ? '#38bdf8' : isOnPath ? '#34d399' : '#334155'}
                      strokeWidth={isSelected || isOnPath ? 2.8 : 1.5}
                      className="transition-all duration-150 group-hover:stroke-cyan-400 group-hover:fill-slate-800"
                    />
                    <text
                      textAnchor="middle"
                      dy="34"
                      fill={isSelected ? '#ffffff' : isOnPath ? '#6ee7b7' : '#cbd5e1'}
                      fontSize="9.5"
                      fontWeight={isSelected ? 'bold' : 'normal'}
                      fontFamily="monospace"
                      className="pointer-events-none"
                    >
                      {label.length > 18 ? `${label.slice(0, 17)}…` : label}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}

          <div className="absolute bottom-2 left-3 text-[10px] font-mono text-slate-500 pointer-events-none">
            {t.wsGraphDragHint} · {Math.round(zoomLevel * 100)}%
          </div>
        </div>

        {/* Selected Node Sidebar Inspector */}
        <div className="w-full xl:w-72 max-h-[44%] xl:max-h-none border-t xl:border-t-0 xl:border-l border-slate-800 bg-slate-900/60 p-3.5 flex flex-col space-y-3 overflow-y-auto text-xs shrink-0">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-1.5 text-cyan-400 font-semibold">
              <GitGraph className="w-4 h-4" />
              <span>{t.wsGraphInspector}</span>
            </div>
            {graphMode === 'custom' && selectedNode && (
              <button
                type="button"
                onClick={() => handleDeleteNode(selectedNode.id)}
                title={t.removeBtn}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-rose-400 hover:bg-rose-500/15 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                <span>{t.removeBtn}</span>
              </button>
            )}
          </div>

          {selectedNode ? (
            <div className="space-y-3">
              <div>
                <span className="text-[10px] uppercase font-mono text-slate-500 font-bold">
                  {t.wsGraphNodeIdentity}
                </span>
                <h4 className="text-sm font-bold text-white mt-0.5">{selectedNode.data?.label}</h4>
                <p className="text-[11px] font-mono text-slate-400 mt-0.5">ID: {selectedNode.id}</p>
                {selectedNode.data?.category && (
                  <span
                    className={`inline-block mt-1.5 px-2 py-0.5 rounded text-[10px] font-mono border ${getCategoryColor(
                      selectedNode.data.category
                    )}`}
                  >
                    {selectedNode.data.category}
                  </span>
                )}
              </div>

              {selectedNode.data?.description && (
                <div>
                  <span className="text-[10px] uppercase font-mono text-slate-500 font-bold">
                    {t.wsGraphDescription}
                  </span>
                  <p className="text-xs text-slate-300 mt-1 leading-relaxed bg-slate-950 p-2 rounded-lg border border-slate-800 font-mono">
                    {selectedNode.data.description}
                  </p>
                </div>
              )}

              {/* Related Connections */}
              <div>
                <span className="text-[10px] uppercase font-mono text-slate-500 font-bold">
                  {t.wsGraphConnectedEdges}
                </span>
                <div className="space-y-1.5 mt-1">
                  {activeGraph.edges
                    .filter((e) => e.source === selectedNode.id || e.target === selectedNode.id)
                    .map((e) => {
                      const isOut = e.source === selectedNode.id;
                      const otherId = isOut ? e.target : e.source;
                      const otherNode = nodeMap.get(otherId);
                      return (
                        <div
                          key={e.id}
                          onClick={() => otherNode && setSelectedNodeId(otherNode.id)}
                          className="p-1.5 rounded-md bg-slate-950 border border-slate-800 hover:border-cyan-500/50 cursor-pointer flex items-center justify-between gap-1 text-[11px] transition-colors"
                        >
                          <span className="font-mono text-slate-300 truncate pr-1">
                            {otherNode?.data?.label || otherId}
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-[9px] font-mono text-cyan-400 bg-cyan-950/60 px-1.5 py-0.5 rounded">
                              {e.label || (isOut ? '→ OUT' : '← IN')}
                            </span>
                            {graphMode === 'custom' && (
                              <button
                                type="button"
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  handleDeleteEdge(e.id);
                                }}
                                className="p-0.5 text-slate-500 hover:text-rose-400 cursor-pointer"
                                aria-label={t.removeBtn}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Shortest Dependency Path Calculator */}
              <div className="pt-2 border-t border-slate-800 space-y-2">
                <span className="text-[10px] uppercase font-mono text-slate-500 font-bold">
                  {t.wsGraphPathSolver}
                </span>
                <div className="flex items-center gap-1">
                  <select
                    value={pathFromNode || selectedNode.id}
                    onChange={(e) => setPathFromNode(e.target.value)}
                    className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded p-1 text-[11px] text-slate-200 font-mono"
                  >
                    {activeGraph.nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.data?.label}
                      </option>
                    ))}
                  </select>
                  <ArrowRight className="w-3 h-3 text-slate-500 shrink-0" />
                  <select
                    value={pathToNode}
                    onChange={(e) => setPathToNode(e.target.value)}
                    className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded p-1 text-[11px] text-slate-200 font-mono"
                  >
                    <option value="">{t.wsGraphSelectTarget}</option>
                    {activeGraph.nodes
                      .filter((n) => n.id !== (pathFromNode || selectedNode.id))
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.data?.label}
                        </option>
                      ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleCalculatePath}
                  disabled={!pathToNode}
                  className="w-full py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white font-medium text-xs flex items-center justify-center gap-1 transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>{t.wsGraphResolvePath}</span>
                </button>

                {calculatedPath !== null && (
                  <div className="p-2 rounded bg-cyan-950/30 border border-cyan-800 text-[11px] font-mono text-cyan-300">
                    <span className="text-[10px] text-slate-400 block mb-1">
                      {t.wsGraphOptimalPath}
                    </span>
                    {calculatedPath.length > 0
                      ? calculatedPath.map((id) => nodeMap.get(id)?.data?.label || id).join(' → ')
                      : t.wsGraphNoPath}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-slate-500 text-xs italic text-center py-8">
              {t.wsGraphSelectHint}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
