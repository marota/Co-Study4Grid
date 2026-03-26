import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, type Dispatch, type SetStateAction, type RefObject, type MutableRefObject } from 'react';
import { api } from '../api';
import { usePanZoom } from './usePanZoom';
import {
  buildMetadataIndex,
  getIdMap, invalidateIdMapCache,
} from '../utils/svgUtils';
import { processSvg } from '../utils/svgUtils';
import type { DiagramData, ViewBox, MetadataIndex, TabId, VlOverlay, SldTab, FlowDelta, AssetDelta, AnalysisResult, ActionDetail } from '../types';

export interface DiagramsState {
  // Tab
  activeTab: TabId;
  setActiveTab: (v: TabId) => void;

  // Diagrams
  nDiagram: DiagramData | null;
  setNDiagram: (v: DiagramData | null) => void;
  n1Diagram: DiagramData | null;
  setN1Diagram: (v: DiagramData | null) => void;
  n1Loading: boolean;
  setN1Loading: (v: boolean) => void;

  // Action variant
  selectedActionId: string | null;
  setSelectedActionId: (v: string | null) => void;
  actionDiagram: DiagramData | null;
  setActionDiagram: (v: DiagramData | null) => void;
  actionDiagramLoading: boolean;
  setActionDiagramLoading: (v: boolean) => void;

  // View mode
  actionViewMode: 'network' | 'delta';
  setActionViewMode: (v: 'network' | 'delta') => void;
  handleViewModeChange: (mode: 'network' | 'delta') => void;

  // ViewBox
  originalViewBox: ViewBox | null;
  setOriginalViewBox: (v: ViewBox | null) => void;
  inspectQuery: string;
  setInspectQuery: (v: string) => void;

  // SVG Container Refs
  nSvgContainerRef: RefObject<HTMLDivElement | null>;
  n1SvgContainerRef: RefObject<HTMLDivElement | null>;
  actionSvgContainerRef: RefObject<HTMLDivElement | null>;

  // Pan/Zoom instances
  nPZ: ReturnType<typeof usePanZoom>;
  n1PZ: ReturnType<typeof usePanZoom>;
  actionPZ: ReturnType<typeof usePanZoom>;

  // Metadata
  nMetaIndex: MetadataIndex | null;
  n1MetaIndex: MetadataIndex | null;
  actionMetaIndex: MetadataIndex | null;

  // Voltage filter
  nominalVoltageMap: Record<string, number>;
  setNominalVoltageMap: (v: Record<string, number>) => void;
  uniqueVoltages: number[];
  setUniqueVoltages: (v: number[]) => void;
  voltageRange: [number, number];
  setVoltageRange: (v: [number, number]) => void;

  // SLD overlay
  vlOverlay: VlOverlay | null;
  setVlOverlay: (v: VlOverlay | null) => void;

  // Branch refs
  committedBranchRef: MutableRefObject<string>;
  restoringSessionRef: MutableRefObject<boolean>;
  lastZoomState: MutableRefObject<{ query: string; branch: string }>;
  actionSyncSourceRef: MutableRefObject<ViewBox | null>;

  // Handlers
  fetchBaseDiagram: (vlCount: number) => void;
  handleActionSelect: (
    actionId: string | null,
    result: AnalysisResult | null,
    selectedBranch: string,
    voltageLevelsLength: number,
    setResult: Dispatch<SetStateAction<AnalysisResult | null>>,
    setError: (v: string) => void,
  ) => Promise<void>;
  handleManualZoomIn: () => void;
  handleManualZoomOut: () => void;
  handleManualReset: () => void;
  handleVlDoubleClick: (actionId: string, vlName: string) => void;
  handleOverlaySldTabChange: (sldTab: SldTab) => void;
  handleOverlayClose: () => void;
  handleAssetClick: (
    actionId: string,
    assetName: string,
    tab: 'action' | 'n' | 'n-1',
    selectedActionId: string | null,
    handleActionSelectFn: (actionId: string | null) => void,
  ) => void;
  zoomToElement: (targetId: string) => void;

  // Computed
  inspectableItems: string[];

  // Internal ref for SLD selectedBranch
  selectedBranchForSld: MutableRefObject<string>;
}

export function useDiagrams(
  branches: string[],
  voltageLevels: string[],
  selectedBranch: string,
): DiagramsState {
  // Tab
  const [activeTab, setActiveTab] = useState<TabId>('n');
  const activeTabRef = useRef<TabId>(activeTab);
  useLayoutEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  const prevTabRef = useRef<TabId>(activeTab);

  // Diagrams
  const [nDiagram, setNDiagram] = useState<DiagramData | null>(null);
  const [n1Diagram, setN1Diagram] = useState<DiagramData | null>(null);
  const [n1Loading, setN1Loading] = useState(false);

  // Action variant
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [actionDiagram, setActionDiagram] = useState<DiagramData | null>(null);
  const [actionDiagramLoading, setActionDiagramLoading] = useState(false);

  // View mode
  const [actionViewMode, setActionViewMode] = useState<'network' | 'delta'>('network');
  const handleViewModeChange = useCallback((mode: 'network' | 'delta') => {
    setActionViewMode(mode);
  }, []);

  // ViewBox
  const [originalViewBox, setOriginalViewBox] = useState<ViewBox | null>(null);
  const [inspectQuery, setInspectQuery] = useState('');

  // SVG Refs
  const nSvgContainerRef = useRef<HTMLDivElement>(null);
  const n1SvgContainerRef = useRef<HTMLDivElement>(null);
  const actionSvgContainerRef = useRef<HTMLDivElement>(null);

  // Pan/Zoom
  const nPZ = usePanZoom(nSvgContainerRef, nDiagram?.originalViewBox, activeTab === 'n');
  const n1PZ = usePanZoom(n1SvgContainerRef, n1Diagram?.originalViewBox, activeTab === 'n-1');
  const actionPZ = usePanZoom(actionSvgContainerRef, actionDiagram?.originalViewBox, activeTab === 'action');

  // Zoom state
  const lastZoomState = useRef({ query: '', branch: '' });
  const actionSyncSourceRef = useRef<ViewBox | null>(null);

  // Branch refs
  const committedBranchRef = useRef('');
  const restoringSessionRef = useRef(false);

  // Voltage filter
  const [nominalVoltageMap, setNominalVoltageMap] = useState<Record<string, number>>({});
  const [uniqueVoltages, setUniqueVoltages] = useState<number[]>([]);
  const [voltageRange, setVoltageRange] = useState<[number, number]>([0, 400]);

  // SLD overlay
  const [vlOverlay, setVlOverlay] = useState<VlOverlay | null>(null);

  // Metadata
  const nMetaIndex = useMemo(() => buildMetadataIndex(nDiagram?.metadata), [nDiagram?.metadata]);
  const n1MetaIndex = useMemo(() => buildMetadataIndex(n1Diagram?.metadata), [n1Diagram?.metadata]);
  const actionMetaIndex = useMemo(() => buildMetadataIndex(actionDiagram?.metadata), [actionDiagram?.metadata]);

  // Invalidate DOM id-map cache when SVG content changes
  useEffect(() => {
    if (nSvgContainerRef.current) invalidateIdMapCache(nSvgContainerRef.current);
  }, [nDiagram]);
  useEffect(() => {
    if (n1SvgContainerRef.current) invalidateIdMapCache(n1SvgContainerRef.current);
  }, [n1Diagram]);
  useEffect(() => {
    if (actionSvgContainerRef.current) invalidateIdMapCache(actionSvgContainerRef.current);
  }, [actionDiagram]);

  // ===== Fetch Base Diagram =====
  const fetchBaseDiagram = useCallback(async (vlCount: number) => {
    try {
      const res = await api.getNetworkDiagram();
      const { svg, viewBox } = processSvg(res.svg, vlCount || 0);
      if (viewBox) setOriginalViewBox(viewBox);
      setNDiagram({ ...res, svg, originalViewBox: viewBox });
    } catch (err) {
      console.error('Failed to fetch diagram:', err);
      throw err; // Re-throw so App.tsx can handle it
    }
  }, []);

  // ===== Action Select =====
  const handleActionSelect = useCallback(async (
    actionId: string | null,
    result: AnalysisResult | null,
    selectedBranch: string,
    voltageLevelsLength: number,
    setResult: React.Dispatch<React.SetStateAction<AnalysisResult | null>>,
    setError: (v: string) => void,
  ) => {
    if (actionId === selectedActionId) {
      setSelectedActionId(null);
      setActionDiagram(null);
      setActiveTab('n-1');
      return;
    }

    actionSyncSourceRef.current =
      (activeTabRef.current === 'action' ? actionPZ.viewBox : null)
      || n1PZ.viewBox || nPZ.viewBox;

    setSelectedActionId(actionId);
    setActionDiagram(null);
    if (actionId === null) return;

    setActionDiagramLoading(true);
    setActiveTab('action');
    try {
      const res = await api.getActionVariantDiagram(actionId);
      const { svg, viewBox } = processSvg(res.svg, voltageLevelsLength);
      setActionDiagram({ ...res, svg, originalViewBox: viewBox });
    } catch {
      if (selectedBranch) {
        try {
          let actionContent: Record<string, unknown> | null = null;
          if (actionId.includes('+')) {
            const parts = actionId.split('+');
            const perAction: Record<string, unknown> = {};
            for (const part of parts) {
              const partDetail = result?.actions?.[part];
              if (partDetail?.action_topology) perAction[part] = partDetail.action_topology;
            }
            if (Object.keys(perAction).length > 0) actionContent = perAction;
          } else {
            const detail = result?.actions?.[actionId];
            actionContent = (detail?.action_topology as unknown as Record<string, unknown>) ?? null;
          }
          const linesOvl = result?.lines_overloaded?.length ? result.lines_overloaded : null;
          const simRes = await api.simulateManualAction(actionId, selectedBranch, actionContent, linesOvl);
          setResult(prev => {
            if (!prev) return prev;
            const existing = prev.actions[actionId] || {} as Partial<ActionDetail>;
            const hasRho = (existing.rho_before?.length ?? 0) > 0;
            return {
              ...prev,
              actions: {
                ...prev.actions,
                [actionId]: {
                  ...existing,
                  description_unitaire: existing.description_unitaire || simRes.description_unitaire,
                  rho_before: hasRho ? existing.rho_before : simRes.rho_before,
                  rho_after: hasRho ? existing.rho_after : simRes.rho_after,
                  max_rho: hasRho ? existing.max_rho : simRes.max_rho,
                  max_rho_line: hasRho ? existing.max_rho_line : simRes.max_rho_line,
                  is_rho_reduction: hasRho ? existing.is_rho_reduction : simRes.is_rho_reduction,
                  non_convergence: simRes.non_convergence,
                  is_islanded: simRes.is_islanded,
                  n_components: simRes.n_components,
                  disconnected_mw: simRes.disconnected_mw,
                } as ActionDetail,
              },
            };
          });
          const res = await api.getActionVariantDiagram(actionId);
          const { svg, viewBox } = processSvg(res.svg, voltageLevelsLength);
          setActionDiagram({ ...res, svg, originalViewBox: viewBox });
        } catch (simErr) {
          console.error('Failed to simulate and fetch diagram for', actionId, simErr);
          setError('Failed to load action diagram for ' + actionId);
        }
      } else {
        setError('Failed to fetch action variant diagram for ' + actionId);
      }
    } finally {
      setActionDiagramLoading(false);
    }
  }, [selectedActionId, actionPZ.viewBox, n1PZ.viewBox, nPZ.viewBox]);

  // ===== Zoom Controls =====
  const handleManualZoomIn = useCallback(() => {
    const currentPZ = activeTab === 'action' ? actionPZ : activeTab === 'n' ? nPZ : n1PZ;
    const vb = currentPZ?.viewBox;
    if (currentPZ && vb) {
      const scale = 0.8;
      currentPZ.setViewBox({
        x: vb.x + vb.w * (1 - scale) / 2,
        y: vb.y + vb.h * (1 - scale) / 2,
        w: vb.w * scale,
        h: vb.h * scale,
      });
    }
  }, [activeTab, actionPZ, nPZ, n1PZ]);

  const handleManualZoomOut = useCallback(() => {
    const currentPZ = activeTab === 'action' ? actionPZ : activeTab === 'n' ? nPZ : n1PZ;
    const vb = currentPZ?.viewBox;
    if (currentPZ && vb) {
      const scale = 1.25;
      currentPZ.setViewBox({
        x: vb.x + vb.w * (1 - scale) / 2,
        y: vb.y + vb.h * (1 - scale) / 2,
        w: vb.w * scale,
        h: vb.h * scale,
      });
    }
  }, [activeTab, actionPZ, nPZ, n1PZ]);

  const handleManualReset = useCallback(() => {
    setInspectQuery('');

    const currentPZ = activeTab === 'action' ? actionPZ : activeTab === 'n' ? nPZ : n1PZ;
    const currentDiagram = activeTab === 'action' ? actionDiagram : activeTab === 'n' ? nDiagram : n1Diagram;
    const viewBox = currentDiagram?.originalViewBox || originalViewBox;

    if (currentPZ && viewBox) {
      currentPZ.setViewBox(viewBox);
      lastZoomState.current = { query: '', branch: '' };
    }

    const container = activeTab === 'action' ? actionSvgContainerRef.current
      : activeTab === 'n' ? nSvgContainerRef.current : n1SvgContainerRef.current;
    if (container) {
      container.querySelectorAll('.nad-highlight').forEach(el => el.classList.remove('nad-highlight'));
    }
  }, [activeTab, actionPZ, nPZ, n1PZ, actionDiagram, nDiagram, n1Diagram, originalViewBox]);

  // ===== Tab Synchronization =====
  useLayoutEffect(() => {
    const prevTab = prevTabRef.current;
    if (prevTab === activeTab) return;
    prevTabRef.current = activeTab;

    if (prevTab === 'overflow' || activeTab === 'overflow') return;

    const sourceVB = prevTab === 'n' ? nPZ.viewBox
      : prevTab === 'n-1' ? n1PZ.viewBox
        : prevTab === 'action' ? actionPZ.viewBox
          : null;
    if (!sourceVB) return;

    if (activeTab === 'n') nPZ.setViewBox(sourceVB);
    else if (activeTab === 'n-1') n1PZ.setViewBox(sourceVB);
    else if (activeTab === 'action') actionPZ.setViewBox(sourceVB);
  }, [activeTab, nPZ, n1PZ, actionPZ]);

  // Re-sync after action diagram loads
  useEffect(() => {
    if (actionDiagram && activeTab === 'action' && actionSyncSourceRef.current) {
      actionPZ.setViewBox(actionSyncSourceRef.current);
      actionSyncSourceRef.current = null;
    }
  }, [actionDiagram, activeTab, actionPZ]);

  // ===== SLD Overlay =====
  const fetchSldVariant = useCallback(async (vlName: string, actionId: string | null, sldTab: SldTab, selectedBranch: string) => {
    setVlOverlay(prev => prev ? { ...prev, loading: true, error: null, tab: sldTab } : null);
    try {
      let svgData: string;
      let metaData: string | null = null;
      let flowDeltas: Record<string, FlowDelta> | undefined;
      let reactiveFlowDeltas: Record<string, FlowDelta> | undefined;
      let assetDeltas: Record<string, AssetDelta> | undefined;
      let changedSwitches: Record<string, { from_open: boolean; to_open: boolean }> | undefined;

      if (sldTab === 'n') {
        const res = await api.getNSld(vlName);
        svgData = res.svg;
        metaData = res.sld_metadata ?? null;
      } else if (sldTab === 'n-1') {
        const res = await api.getN1Sld(selectedBranch, vlName);
        svgData = res.svg;
        metaData = res.sld_metadata ?? null;
        flowDeltas = res.flow_deltas;
        reactiveFlowDeltas = res.reactive_flow_deltas;
        assetDeltas = res.asset_deltas;
      } else {
        const res = await api.getActionVariantSld(actionId!, vlName);
        svgData = res.svg;
        metaData = res.sld_metadata ?? null;
        flowDeltas = res.flow_deltas;
        reactiveFlowDeltas = res.reactive_flow_deltas;
        assetDeltas = res.asset_deltas;
        changedSwitches = res.changed_switches;
      }
      setVlOverlay(prev =>
        prev && prev.vlName === vlName && prev.tab === sldTab
          ? {
            ...prev, svg: svgData, sldMetadata: metaData, loading: false,
            flow_deltas: flowDeltas, reactive_flow_deltas: reactiveFlowDeltas, asset_deltas: assetDeltas,
            changed_switches: changedSwitches,
          }
          : prev
      );
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } }; message?: string };
      setVlOverlay(prev => prev && prev.tab === sldTab
        ? { ...prev, loading: false, error: e.response?.data?.detail || 'Failed to load SLD' }
        : prev
      );
    }
  }, []);

  // Store selectedBranch ref for SLD callbacks
  const selectedBranchForSld = useRef('');

  const handleVlDoubleClick = useCallback((actionId: string, vlName: string) => {
    let initialTab: SldTab;
    if (activeTab === 'n') {
      initialTab = 'n';
    } else if (activeTab === 'n-1') {
      initialTab = 'n-1';
    } else {
      initialTab = 'action';
    }
    setVlOverlay({ vlName, actionId, svg: null, sldMetadata: null, loading: true, error: null, tab: initialTab });
    fetchSldVariant(vlName, actionId, initialTab, selectedBranchForSld.current);
  }, [activeTab, fetchSldVariant]);

  const handleOverlaySldTabChange = useCallback((sldTab: SldTab) => {
    if (!vlOverlay) return;
    fetchSldVariant(vlOverlay.vlName, vlOverlay.actionId, sldTab, selectedBranchForSld.current);
  }, [vlOverlay, fetchSldVariant]);

  const handleOverlayClose = useCallback(() => {
    setVlOverlay(null);
  }, []);

  // ===== Asset Click =====
  const handleAssetClick = useCallback((
    actionId: string,
    assetName: string,
    tab: 'action' | 'n' | 'n-1' = 'action',
    currentSelectedActionId: string | null,
    handleActionSelectFn: (actionId: string | null) => void,
  ) => {
    setInspectQuery(assetName);
    if (tab === 'n') {
      setActiveTab('n');
    } else if (tab === 'n-1') {
      setActiveTab('n-1');
    } else if (actionId !== currentSelectedActionId) {
      handleActionSelectFn(actionId);
    } else {
      setActiveTab('action');
    }
  }, []);

  // ===== Zoom to Element =====
  const zoomToElement = useCallback((targetId: string) => {
    const currentPZ = activeTab === 'action' ? actionPZ : activeTab === 'n' ? nPZ : n1PZ;
    const container = activeTab === 'action' ? actionSvgContainerRef.current
      : activeTab === 'n' ? nSvgContainerRef.current : n1SvgContainerRef.current;
    const index = activeTab === 'action' ? actionMetaIndex : activeTab === 'n' ? nMetaIndex : n1MetaIndex;
    if (!currentPZ || !container || !index) return;

    try {
      const { nodesByEquipmentId, edgesByEquipmentId } = index;
      const points: { x: number; y: number }[] = [];

      let targetNode = nodesByEquipmentId.get(targetId);
      let targetEdge = edgesByEquipmentId.get(targetId);
      let targetSvgId: string | undefined;

      let usingFallbackIndex = false;
      let effectiveIndex = index;

      if (!targetNode && !targetEdge) {
        const dotIdx = targetId.indexOf('.');
        if (dotIdx >= 0) {
          const suffix = targetId.substring(dotIdx + 1);
          targetNode = nodesByEquipmentId.get(suffix) ?? undefined;
          if (!targetNode) targetEdge = edgesByEquipmentId.get(suffix) ?? undefined;
        }
      }

      if (!targetNode && !targetEdge && index !== nMetaIndex && nMetaIndex) {
        let nNode = nMetaIndex.nodesByEquipmentId.get(targetId);
        let nEdge = nMetaIndex.edgesByEquipmentId.get(targetId);
        if (!nNode && !nEdge) {
          const dotIdx = targetId.indexOf('.');
          if (dotIdx >= 0) {
            const suffix = targetId.substring(dotIdx + 1);
            nNode = nMetaIndex.nodesByEquipmentId.get(suffix) ?? undefined;
            if (!nNode) nEdge = nMetaIndex.edgesByEquipmentId.get(suffix) ?? undefined;
          }
        }
        if (nNode || nEdge) {
          targetNode = nNode;
          targetEdge = nEdge;
          usingFallbackIndex = true;
          effectiveIndex = nMetaIndex;
        }
      }

      const addNodePointsBySvgId = (svgId: string) => {
        const n = effectiveIndex.nodesBySvgId.get(svgId);
        if (n) points.push({ x: n.x, y: n.y });
        return n;
      };

      if (targetNode) {
        if (!usingFallbackIndex) targetSvgId = targetNode.svgId;
        points.push({ x: targetNode.x, y: targetNode.y });
        (effectiveIndex.edgesByNode.get(targetNode.svgId) || []).forEach(e => {
          addNodePointsBySvgId(e.node1);
          addNodePointsBySvgId(e.node2);
        });
      } else if (targetEdge) {
        if (!usingFallbackIndex) targetSvgId = targetEdge.svgId;
        const n1 = addNodePointsBySvgId(targetEdge.node1);
        const n2 = addNodePointsBySvgId(targetEdge.node2);
        if (n1) (effectiveIndex.edgesByNode.get(n1.svgId) || []).forEach(e => { addNodePointsBySvgId(e.node1); addNodePointsBySvgId(e.node2); });
        if (n2) (effectiveIndex.edgesByNode.get(n2.svgId) || []).forEach(e => { addNodePointsBySvgId(e.node1); addNodePointsBySvgId(e.node2); });
      }

      if (points.length > 0) {
        const minX = Math.min(...points.map(p => p.x));
        const maxX = Math.max(...points.map(p => p.x));
        const minY = Math.min(...points.map(p => p.y));
        const maxY = Math.max(...points.map(p => p.y));

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const boxW = Math.max(maxX - minX, 50);
        const boxH = Math.max(maxY - minY, 50);

        const padding = 1.8;
        const screenW = container.getBoundingClientRect().width;
        const screenH = container.getBoundingClientRect().height;
        const screenAR = screenW / screenH;

        let targetW = boxW * padding;
        let targetH = boxH * padding;

        if (targetW / targetH > screenAR) {
          targetH = targetW / screenAR;
        } else {
          targetW = targetH * screenAR;
        }

        const targetX = centerX - targetW / 2;
        const targetY = centerY - targetH / 2;

        currentPZ.setViewBox({ x: targetX, y: targetY, w: targetW, h: targetH });

        container.querySelectorAll('.nad-highlight').forEach(el => el.classList.remove('nad-highlight'));
        if (targetSvgId) {
          const el = container.querySelector(`[id="${targetSvgId}"]`);
          if (el) el.classList.add('nad-highlight');
        }
      }
    } catch (e) {
      console.error('Zoom failed:', e);
    }
  }, [activeTab, actionPZ, nPZ, n1PZ, actionMetaIndex, nMetaIndex, n1MetaIndex]);

  // Inspectable items
  const inspectableItems = useMemo(() =>
    [...branches, ...voltageLevels].sort(),
    [branches, voltageLevels]
  );

  // ===== Voltage Range Filter =====
  const staleVoltageFilter = useRef<Set<TabId>>(new Set());
  const prevVFTabRef = useRef<TabId>(activeTab);

  const applyVoltageFilter = useCallback((container: HTMLElement | null, metaIndex: MetadataIndex | null) => {
    if (!container || !metaIndex) return;
    if (uniqueVoltages.length === 0 || Object.keys(nominalVoltageMap).length === 0) return;

    const [minKv, maxKv] = voltageRange;
    if (minKv <= uniqueVoltages[0] && maxKv >= uniqueVoltages[uniqueVoltages.length - 1]) return;

    const isInRange = (vlId: string) => {
      const kv = nominalVoltageMap[vlId];
      return kv != null && kv >= minKv && kv <= maxKv;
    };

    const { nodesByEquipmentId, nodesBySvgId, edgesByEquipmentId } = metaIndex;
    const idMap = getIdMap(container);

    for (const [vlId, node] of nodesByEquipmentId) {
      const visible = isInRange(vlId);
      const show = visible ? '' : 'none';
      const el = idMap.get(node.svgId) as HTMLElement | undefined;
      if (el) el.style.display = show;
      if (node.legendSvgId) {
        const leg = idMap.get(node.legendSvgId as string) as HTMLElement | undefined;
        if (leg) leg.style.display = show;
      }
      if (node.legendEdgeSvgId) {
        const legE = idMap.get(node.legendEdgeSvgId as string) as HTMLElement | undefined;
        if (legE) legE.style.display = show;
      }
    }

    for (const [, edge] of edgesByEquipmentId) {
      const node1 = nodesBySvgId.get(edge.node1);
      const node2 = nodesBySvgId.get(edge.node2);
      const vl1InRange = node1 ? isInRange(node1.equipmentId) : true;
      const vl2InRange = node2 ? isInRange(node2.equipmentId) : true;
      const edgeVisible = vl1InRange || vl2InRange;
      const show = edgeVisible ? '' : 'none';

      const el = idMap.get(edge.svgId) as HTMLElement | undefined;
      if (el) el.style.display = show;
      if (edge.edgeInfo1?.svgId) {
        const ei = idMap.get(edge.edgeInfo1.svgId) as HTMLElement | undefined;
        if (ei) ei.style.display = show;
      }
      if (edge.edgeInfo2?.svgId) {
        const ei = idMap.get(edge.edgeInfo2.svgId) as HTMLElement | undefined;
        if (ei) ei.style.display = show;
      }
    }
  }, [voltageRange, nominalVoltageMap, uniqueVoltages]);

  useEffect(() => {
    if (uniqueVoltages.length === 0 || Object.keys(nominalVoltageMap).length === 0) return;

    const isTabSwitch = prevVFTabRef.current !== activeTab;
    prevVFTabRef.current = activeTab;

    const runFilter = () => {
      if (activeTab === 'n' || activeTab === 'overflow') {
        applyVoltageFilter(nSvgContainerRef.current, nMetaIndex);
        staleVoltageFilter.current.delete('n');
        staleVoltageFilter.current.add('n-1');
        staleVoltageFilter.current.add('action');
      } else if (activeTab === 'n-1') {
        applyVoltageFilter(n1SvgContainerRef.current, n1MetaIndex);
        staleVoltageFilter.current.delete('n-1');
        staleVoltageFilter.current.add('n');
        staleVoltageFilter.current.add('action');
      } else if (activeTab === 'action') {
        applyVoltageFilter(actionSvgContainerRef.current, actionMetaIndex);
        staleVoltageFilter.current.delete('action');
        staleVoltageFilter.current.add('n');
        staleVoltageFilter.current.add('n-1');
      }
    };

    if (isTabSwitch) {
      const id = requestAnimationFrame(runFilter);
      return () => cancelAnimationFrame(id);
    } else {
      runFilter();
    }
  }, [voltageRange, nDiagram, n1Diagram, actionDiagram, nMetaIndex, n1MetaIndex, actionMetaIndex, nominalVoltageMap, uniqueVoltages, activeTab, applyVoltageFilter]);

  // Auto-zoom to selected element via viewBox
  useEffect(() => {
    if (activeTab === 'overflow') return;

    const queryChanged = inspectQuery !== lastZoomState.current.query;
    const branchChanged = !inspectQuery && selectedBranch !== lastZoomState.current.branch;

    if (!queryChanged && !branchChanged) return;

    const targetId = inspectQuery || selectedBranch;

    // Cleared inspect → reset view
    if (!targetId && queryChanged) {
      lastZoomState.current = { query: inspectQuery, branch: selectedBranch };
      handleManualReset();
      return;
    }

    if (!targetId) return;

    // Branch changes should zoom on the N-1 tab, not N.
    // In the same render cycle, setActiveTab('n-1') is batched but
    // not committed — this effect still sees activeTab='n'. Skip here;
    // the effect re-runs when activeTab changes to 'n-1'.
    if (branchChanged && activeTab === 'n') return;

    // Only consume the zoom intent when the container has SVG content.
    // If not ready (e.g. N-1 still loading), skip — the effect re-runs
    // when n1Diagram changes, and branchChanged will still be true.
    const container = activeTab === 'action' ? actionSvgContainerRef.current
      : activeTab === 'n' ? nSvgContainerRef.current : n1SvgContainerRef.current;
    if (!container || !container.querySelector('svg')) return;

    lastZoomState.current = { query: inspectQuery, branch: selectedBranch };
    zoomToElement(targetId);

  }, [activeTab, nDiagram, n1Diagram, actionDiagram, inspectQuery, selectedBranch, handleManualReset, zoomToElement]);

  return useMemo(() => ({
    activeTab, setActiveTab,
    nDiagram, setNDiagram,
    n1Diagram, setN1Diagram,
    n1Loading, setN1Loading,
    selectedActionId, setSelectedActionId,
    actionDiagram, setActionDiagram,
    actionDiagramLoading, setActionDiagramLoading,
    actionViewMode, setActionViewMode,
    handleViewModeChange,
    originalViewBox, setOriginalViewBox,
    inspectQuery, setInspectQuery,
    nSvgContainerRef, n1SvgContainerRef, actionSvgContainerRef,
    nPZ, n1PZ, actionPZ,
    nMetaIndex, n1MetaIndex, actionMetaIndex,
    nominalVoltageMap, setNominalVoltageMap,
    uniqueVoltages, setUniqueVoltages,
    voltageRange, setVoltageRange,
    vlOverlay, setVlOverlay,
    committedBranchRef, restoringSessionRef,
    lastZoomState, actionSyncSourceRef,
    fetchBaseDiagram,
    handleActionSelect,
    handleManualZoomIn,
    handleManualZoomOut,
    handleManualReset,
    handleVlDoubleClick,
    handleOverlaySldTabChange,
    handleOverlayClose,
    handleAssetClick,
    zoomToElement,
    inspectableItems,
    selectedBranchForSld,
  }), [
    activeTab, nDiagram, n1Diagram, n1Loading,
    selectedActionId, actionDiagram, actionDiagramLoading, actionViewMode, handleViewModeChange,
    originalViewBox, inspectQuery,
    nPZ, n1PZ, actionPZ,
    nMetaIndex, n1MetaIndex, actionMetaIndex,
    nominalVoltageMap, uniqueVoltages, voltageRange,
    vlOverlay, fetchBaseDiagram, handleActionSelect,
    handleManualZoomIn, handleManualZoomOut, handleManualReset,
    handleVlDoubleClick, handleOverlaySldTabChange, handleOverlayClose,
    handleAssetClick, zoomToElement, inspectableItems
  ]);
}
