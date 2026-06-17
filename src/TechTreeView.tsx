import {
	addEdge,
	applyEdgeChanges,
	applyNodeChanges,
	BaseEdge,
	ConnectionLineType,
	ConnectionMode,
	EdgeToolbar,
	getSmoothStepPath,
	getStraightPath,
	Handle,
	MarkerType,
	NodeResizer,
	Position,
	ReactFlow,
	ReactFlowProvider,
	ViewportPortal,
	reconnectEdge,
	useReactFlow,
	useViewport,
	type Connection,
	type DefaultEdgeOptions,
	type Edge,
	type EdgeChange,
	type EdgeProps,
	type EdgeTypes,
	type FinalConnectionState,
	type HandleType,
	type IsValidConnection,
	type NodeChange,
	type NodeProps,
	type NodeTypes,
	type ReactFlowInstance,
	type XYPosition
} from "@xyflow/react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import bonsaiImageUrl from "./assets/bonsai.png";
import { TechTreeManager, applyNodeState, createNode, updateGoalQuestViewMode, updateNodeCompletionStatus, updateNodePriority, updateNodePriorityOrder, updateNodeVisibleText } from "./TechTreeManager";
import type { TechTreeBoard, TechTreeNode, TechTreePriority } from "./types";

type TechTreeAppProps = {
	boardPath: string;
	manager: TechTreeManager;
};

export type TechTreeBoardChoice = {
	name: string;
	path: string;
};

type TechTreeBoardPickerProps = {
	boards: TechTreeBoardChoice[];
	onCreateBoard: (name?: string) => void;
	onOpenBoard: (path: string) => void;
};

type PaneMenuState = {
	flowPosition: { x: number; y: number };
	screenPosition: ClientPosition;
};

type NodeMenuState = {
	nodeId: string;
	screenPosition: ClientPosition;
};

type ClientPosition = {
	x: number;
	y: number;
};

type RightDragSelectionState = {
	pointerId: number;
	startClient: ClientPosition;
	currentClient: ClientPosition;
	startLocal: ClientPosition;
	currentLocal: ClientPosition;
	active: boolean;
};

type ConnectionLike = {
	source: string;
	target: string;
	sourceHandle?: string | null;
	targetHandle?: string | null;
};

type TechTreeEdgeData = Record<string, unknown> & {
	isQuestView?: boolean;
	isStraight?: boolean;
	isPriorityPath?: boolean;
	showToolbar?: boolean;
	onDelete?: (edgeId: string) => void;
	onReverse?: (edgeId: string) => void;
};

type QuestViewValidation = {
	canEnter: boolean;
	reason: string | null;
};

type BoardHistory = {
	undos: BoardHistoryEntry[];
	redos: BoardHistoryEntry[];
};

type BoardHistoryEntry = {
	undo: BoardPatch;
	redo: BoardPatch;
};

type BoardPatch = {
	removeNodeIds: string[];
	restoreNodes: IndexedHistoryNode[];
	updateNodes: HistoryNodeUpdate[];
	removeEdgeIds: string[];
	restoreEdges: IndexedHistoryEdge[];
	updateEdges: HistoryEdgeUpdate[];
};

type IndexedHistoryNode = {
	index: number;
	node: TechTreeNode;
};

type IndexedHistoryEdge = {
	index: number;
	edge: Edge;
};

type HistoryNodeUpdate = {
	id: string;
	node: TechTreeNode;
};

type HistoryEdgeUpdate = {
	id: string;
	edge: Edge;
};

type PersistBoardOptions = {
	recordHistory?: boolean;
	historyEntry?: BoardHistoryEntry | null;
};

type ApplyBoardStateOptions = {
	preservePriorityPath?: boolean;
};

type PriorityPathState = {
	nodeIds: Set<string>;
	edgeIds: Set<string>;
	visibleEdgeIds: Set<string>;
	pathNodeIds: string[];
	priorityNodeOrders: Map<string, number>;
	pathEndNodeId: string | null;
	hasActivePath: boolean;
};

type DirectPriorityLink = {
	nodeId: string;
	edgeId: string;
};

type PriorityPathChain = {
	nodeIds: string[];
	pathNodeIds: string[];
	edgeIds: string[];
	visibleEdgeIds: string[];
	pathEndNodeId: string | null;
};

type PriorityBranchRank = {
	priorityOrder: number | null;
	progressDepth: number | null;
	closureDepth: number | null;
	longestLength: number;
	isComplete: boolean;
};

type PriorityChildLink = {
	nodeId: string;
	edge: Edge;
};

type RankedPriorityChildLink = PriorityChildLink & {
	rank: PriorityBranchRank;
};

type PriorityPathContext = {
	nodesById: Map<string, TechTreeNode>;
	connectedEdgesByNode: Map<string, Edge[]>;
	directNodeIds: Set<string>;
	priorityNodeOrders: Map<string, number>;
	preferredNextNodeByParentId: Map<string, string>;
	goalId: string;
};

type PriorityPathChangeSummary = {
	addedNodeIds: Set<string>;
	removedNodeIds: Set<string>;
	priorityChangedNodeIds: Set<string>;
	priorityOrderChangedNodeIds: Set<string>;
	completionChangedNodeIds: Set<string>;
	addedEdges: Edge[];
	removedEdges: Edge[];
	changedEdges: Edge[];
	hasPriorityRelevantChange: boolean;
};

type HorizontalMirrorBounds = {
	leftEdge: number;
	rightEdge: number;
};

const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
	type: "techTreeEdge",
	markerEnd: {
		type: MarkerType.ArrowClosed
	},
	className: "tech-tree-edge",
	interactionWidth: 28
};

const HANDLE_POSITIONS = [
	{ id: "left", position: Position.Left },
	{ id: "right", position: Position.Right },
	{ id: "top", position: Position.Top },
	{ id: "bottom", position: Position.Bottom }
] as const;

const PRIORITY_OPTIONS: { value: TechTreePriority; label: string }[] = [
	{ value: "goal", label: "Goal" },
	{ value: "quest", label: "Quest" },
	{ value: "necessary", label: "Necessary" }
];

// Change arrow-head colors here. Edge body colors and dash patterns live in styles.css.
const EDGE_MARKER_COLORS = {
	default: "#7c8490",
	quest: "#60a5fa",
	progress: "#f97316",
	muted: "#7c8490",
	done: "#ffffff"
} as const;

// Change edge scenario class names here, then tune the matching body colors in styles.css.
const EDGE_CLASSES = {
	base: "tech-tree-edge",
	complete: "is-complete",
	doneToUndone: "is-complete-pending",
	undoneToDone: "is-undone-to-done",
	inProgress: "is-progress",
	necessaryComplete: "is-necessary-complete",
	necessaryChain: "is-necessary-chain",
	necessaryPath: "is-necessary-path",
	priorityPath: "is-priority-path",
	questActivePath: "is-quest-active-path",
	questDoneToDone: "is-quest-done-to-done",
	questDoneToUndone: "is-quest-done-to-undone",
	questGoalPath: "is-quest-goal-path",
	questLockedPath: "is-quest-locked-path",
	questMediumDoneToDone: "is-quest-medium-done-to-done",
	questMediumDoneToUndone: "is-quest-medium-done-to-undone",
	questMediumUndoneToDone: "is-quest-medium-undone-to-done",
	questMediumPath: "is-quest-medium-path",
	questPath: "is-quest-path"
} as const;
const MIN_NODE_WIDTH = 320;
const MIN_NODE_HEIGHT = 130;
const LEGACY_NODE_HEIGHT = 170;
const DEFAULT_NEW_NODE_OPTIONS = { priority: "necessary" } as const;
const PLACEMENT_PREVIEW_NODE_ID = "tech-tree-placement-preview";
const PANE_MENU_OFFSET_Y = 10;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2;
const MIN_ZOOM_PERCENT = MIN_ZOOM * 100;
const MAX_ZOOM_PERCENT = MAX_ZOOM * 100;
const FIT_VIEW_PADDING = 0.18;
const ZOOM_CONTROLS_TOP_CLEARANCE = 148;
const ZOOM_CONTROLS_BOTTOM_CLEARANCE = 56;
const ZOOM_SLIDER_MIN_HEIGHT = 132;
const ZOOM_SLIDER_MAX_HEIGHT = 340;
const ZOOM_SLIDER_TRACK_PADDING = 56;
const CONNECTION_RADIUS = 64;
const RECONNECT_RADIUS = 44;
const RIGHT_DRAG_SELECTION_BUTTON = 2;
const RIGHT_DRAG_SELECTION_BUTTONS_MASK = 2;
const RIGHT_DRAG_SELECTION_THRESHOLD = 6;
const EDGE_SLICE_BUTTON = 1;
const EDGE_SLICE_BUTTONS_MASK = 4;
const CONTEXT_MENU_SUPPRESS_MS = 250;
const BOARD_HISTORY_LIMIT = 2;
const TRANSIENT_BOARD_UPDATE_DELAY_MS = 33;
const MIN_PRIORITY_ORDER = 0;
const MAX_PRIORITY_ORDER = 10;

export function TechTreeApp({ boardPath, manager }: TechTreeAppProps) {
	return (
		<ReactFlowProvider>
			<TechTreeCanvas boardPath={boardPath} manager={manager} />
		</ReactFlowProvider>
	);
}

export function TechTreeBoardPicker({ boards, onCreateBoard, onOpenBoard }: TechTreeBoardPickerProps) {
	const [query, setQuery] = useState("");
	const trimmedQuery = query.trim();
	const lowerQuery = trimmedQuery.toLowerCase();
	const matchingBoards = boards.filter((board) => {
		if (!lowerQuery) {
			return true;
		}

		return `${board.name} ${board.path}`.toLowerCase().includes(lowerQuery);
	});
	const hasExactBoardName = boards.some((board) => board.name.toLowerCase() === lowerQuery);
	const canCreateNamedBoard = Boolean(trimmedQuery && !hasExactBoardName);

	return (
		<div className="tech-tree-empty tech-tree-picker">
			<div className="tech-tree-picker__panel">
				<h2>Open a tech tree board</h2>
				<input
					type="text"
					className="tech-tree-picker__search"
					value={query}
					placeholder="Board name"
					onChange={(event) => setQuery(event.currentTarget.value)}
				/>
				{canCreateNamedBoard ? (
					<button
						type="button"
						className="tech-tree-picker__item tech-tree-picker__item--create"
						onClick={() => onCreateBoard(trimmedQuery)}
					>
						<span>{`Create "${trimmedQuery}"`}</span>
						<small>New tech tree board</small>
					</button>
				) : null}
				{matchingBoards.length > 0 ? (
					<div className="tech-tree-picker__list">
						{matchingBoards.map((board) => (
							<button
								key={board.path}
								type="button"
								className="tech-tree-picker__item"
								onClick={() => onOpenBoard(board.path)}
							>
								<span>{board.name}</span>
								<small>{board.path}</small>
							</button>
						))}
					</div>
				) : !canCreateNamedBoard ? (
					<div className="tech-tree-picker__empty">
						<p>No tech tree canvas boards found.</p>
						<button type="button" onClick={() => onCreateBoard(trimmedQuery || undefined)}>
							Create board
						</button>
					</div>
				) : null}
			</div>
		</div>
	);
}

const TechTreeOriginBackground = React.memo(function TechTreeOriginBackground() {
	return (
		<ViewportPortal>
			<div className="tech-tree-origin-background" aria-hidden="true">
				<img src={bonsaiImageUrl} alt="" draggable={false} />
			</div>
		</ViewportPortal>
	);
});

function TechTreeViewportControls() {
	const reactFlow = useReactFlow<TechTreeNode, Edge>();
	const { zoom } = useViewport();
	const controlsRef = useRef<HTMLDivElement | null>(null);
	const [sliderHeight, setSliderHeight] = useState(220);
	const zoomPercent = Math.round(clampZoom(zoom) * 100);
	const sliderTrackLength = Math.max(80, sliderHeight - ZOOM_SLIDER_TRACK_PADDING);

	useEffect(() => {
		const controls = controlsRef.current;

		if (!controls) {
			return;
		}

		const updateSliderHeight = () => {
			const availableHeight = controls.getBoundingClientRect().height - 54;
			const nextHeight = Math.round(Math.max(
				ZOOM_SLIDER_MIN_HEIGHT,
				Math.min(ZOOM_SLIDER_MAX_HEIGHT, availableHeight)
			));

			setSliderHeight((currentHeight) => currentHeight === nextHeight ? currentHeight : nextHeight);
		};

		updateSliderHeight();

		if (typeof ResizeObserver === "undefined") {
			window.addEventListener("resize", updateSliderHeight);

			return () => window.removeEventListener("resize", updateSliderHeight);
		}

		const observer = new ResizeObserver(updateSliderHeight);
		observer.observe(controls);

		return () => observer.disconnect();
	}, []);

	const handleZoomChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
		const nextZoom = Number(event.currentTarget.value) / 100;

		void reactFlow.zoomTo(clampZoom(nextZoom));
	}, [reactFlow]);

	const handleFitView = useCallback(() => {
		void reactFlow.fitView({ padding: FIT_VIEW_PADDING });
	}, [reactFlow]);

	return (
		<div
			ref={controlsRef}
			className="tech-tree-viewport-controls nodrag nowheel nopan"
			style={{
				position: "absolute",
				top: ZOOM_CONTROLS_TOP_CLEARANCE,
				right: 8,
				bottom: ZOOM_CONTROLS_BOTTOM_CLEARANCE,
				zIndex: 20,
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				gap: 6,
				pointerEvents: "auto"
			}}
		>
			<label
				className="tech-tree-zoom-slider"
				title={`Zoom ${zoomPercent}%`}
				style={{
					position: "relative",
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					width: 34,
					height: sliderHeight,
					padding: "8px 0"
				}}
			>
				<span
					className="tech-tree-zoom-slider__mark"
					aria-hidden="true"
					style={{ position: "absolute", top: 8, left: 0, width: "100%", textAlign: "center" }}
				>
					+
				</span>
				<input
					type="range"
					min={MIN_ZOOM_PERCENT}
					max={MAX_ZOOM_PERCENT}
					step={1}
					value={zoomPercent}
					aria-label="Zoom"
					onChange={handleZoomChange}
					style={{
						position: "absolute",
						top: "50%",
						left: "50%",
						width: sliderTrackLength,
						height: 18,
						margin: 0,
						transform: "translate(-50%, -50%) rotate(-90deg)",
						transformOrigin: "center"
					}}
				/>
				<span
					className="tech-tree-zoom-slider__mark"
					aria-hidden="true"
					style={{ position: "absolute", bottom: 8, left: 0, width: "100%", textAlign: "center" }}
				>
					-
				</span>
			</label>
			<button
				type="button"
				className="tech-tree-fit-view-button"
				title="Fit board to view"
				aria-label="Fit board to view"
				onClick={handleFitView}
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					width: 34,
					height: 34,
					padding: 0
				}}
			>
				<FitViewIcon className="tech-tree-fit-view-icon" />
			</button>
		</div>
	);
}

function FitViewIcon({ className }: { className?: string }) {
	return (
		<svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true">
			<path
				d="M3.5 6V3.5H6M10 3.5h2.5V6M12.5 10v2.5H10M6 12.5H3.5V10"
				fill="none"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.7"
			/>
		</svg>
	);
}

function clampZoom(value: number): number {
	if (!Number.isFinite(value)) {
		return 1;
	}

	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function TechTreeCanvas({ boardPath, manager }: TechTreeAppProps) {
	const reactFlow = useReactFlow<TechTreeNode, Edge>();
	const shellRef = useRef<HTMLDivElement | null>(null);
	const rightDragSelectionRef = useRef<RightDragSelectionState | null>(null);
	const suppressContextMenuRef = useRef(false);
	const lastPointerPositionRef = useRef<ClientPosition | null>(null);
	const historyRef = useRef<BoardHistory>({ undos: [], redos: [] });
	const boardRef = useRef<TechTreeBoard | null>(null);
	const activeBoardRef = useRef<TechTreeBoard | null>(null);
	const transientBoardDirtyRef = useRef(false);
	const pendingTransientBoardRef = useRef<TechTreeBoard | null>(null);
	const transientBoardUpdateTimerRef = useRef<number | null>(null);
	const hoveredEdgeIdRef = useRef<string | null>(null);
	const slicedEdgeIdsRef = useRef<Set<string>>(new Set());
	const flowNodeCacheRef = useRef<Map<string, TechTreeNode>>(new Map());
	const flowEdgeCacheRef = useRef<Map<string, Edge>>(new Map());
	const [board, setBoard] = useState<TechTreeBoard | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [paneMenu, setPaneMenu] = useState<PaneMenuState | null>(null);
	const [nodeMenu, setNodeMenu] = useState<NodeMenuState | null>(null);
	const [rightDragSelection, setRightDragSelection] = useState<RightDragSelectionState | null>(null);
	const [isQuestView, setIsQuestView] = useState(false);
	const [questMirrorBounds, setQuestMirrorBounds] = useState<HorizontalMirrorBounds | null>(null);
	const [isPlacingNode, setIsPlacingNode] = useState(false);
	const [placementFlowPosition, setPlacementFlowPosition] = useState<XYPosition | null>(null);
	const [isFocusMode, setIsFocusMode] = useState(false);
	const [priorityPathState, setPriorityPathState] = useState<PriorityPathState>(() => createEmptyPriorityPathState());
	const priorityPathStateRef = useRef<PriorityPathState>(priorityPathState);

	const applyBoardState = useCallback((nextBoard: TechTreeBoard, options: ApplyBoardStateOptions = {}) => {
		const nextPriorityPathState = options.preservePriorityPath
			? priorityPathStateRef.current
			: getNextPriorityPathState(boardRef.current, nextBoard, priorityPathStateRef.current);

		priorityPathStateRef.current = nextPriorityPathState;
		setPriorityPathState(nextPriorityPathState);
		boardRef.current = nextBoard;
		setBoard(nextBoard);
	}, []);

	useEffect(() => {
		let disposed = false;
		if (transientBoardUpdateTimerRef.current !== null) {
			window.clearTimeout(transientBoardUpdateTimerRef.current);
			transientBoardUpdateTimerRef.current = null;
		}

		pendingTransientBoardRef.current = null;
		transientBoardDirtyRef.current = false;
		historyRef.current = { undos: [], redos: [] };
		const unsubscribe = manager.subscribe(boardPath, (nextBoard) => {
			if (!disposed) {
				applyBoardState(nextBoard);
			}
		});

		manager.loadBoard(boardPath)
			.then((nextBoard) => {
				if (!disposed) {
					applyBoardState(nextBoard);
					setError(null);
				}
			})
			.catch((loadError: unknown) => {
				if (!disposed) {
					setError(loadError instanceof Error ? loadError.message : "Unable to load tech tree board.");
				}
			});

		return () => {
			disposed = true;
			unsubscribe();
		};
	}, [applyBoardState, boardPath, manager]);

	const updateBoardLocal = useCallback((nextBoard: TechTreeBoard, options: ApplyBoardStateOptions = {}) => {
		applyBoardState(nextBoard, options);
	}, [applyBoardState]);

	const flushTransientBoardUpdate = useCallback(() => {
		if (transientBoardUpdateTimerRef.current !== null) {
			window.clearTimeout(transientBoardUpdateTimerRef.current);
			transientBoardUpdateTimerRef.current = null;
		}

		const pendingBoard = pendingTransientBoardRef.current;
		pendingTransientBoardRef.current = null;

		if (pendingBoard) {
			applyBoardState(pendingBoard, { preservePriorityPath: true });
		}
	}, [applyBoardState]);

	const queueTransientBoardUpdate = useCallback((nextBoard: TechTreeBoard) => {
		pendingTransientBoardRef.current = nextBoard;

		if (transientBoardUpdateTimerRef.current !== null) {
			return;
		}

		transientBoardUpdateTimerRef.current = window.setTimeout(() => {
			transientBoardUpdateTimerRef.current = null;
			const pendingBoard = pendingTransientBoardRef.current;
			pendingTransientBoardRef.current = null;

			if (pendingBoard) {
				applyBoardState(pendingBoard, { preservePriorityPath: true });
			}
		}, TRANSIENT_BOARD_UPDATE_DELAY_MS);
	}, [applyBoardState]);

	useEffect(() => {
		return () => {
			if (transientBoardUpdateTimerRef.current !== null) {
				window.clearTimeout(transientBoardUpdateTimerRef.current);
				transientBoardUpdateTimerRef.current = null;
			}

			pendingTransientBoardRef.current = null;
		};
	}, []);

	const persistBoard = useCallback(
		async (nextBoard: TechTreeBoard, options: PersistBoardOptions = {}) => {
			const currentBoard = boardRef.current;

			if (options.recordHistory !== false && currentBoard) {
				const historyEntry = options.historyEntry ?? createBoardHistoryEntry(currentBoard, nextBoard);

				if (historyEntry) {
					pushBoardHistory(historyRef.current.undos, historyEntry);
				}

				historyRef.current.redos = [];
			}

			try {
				const savedBoard = await manager.updateBoard(boardPath, nextBoard);
				applyBoardState(savedBoard);
				setError(null);
			} catch (saveError) {
				console.error("Failed to update tech tree board", saveError);
				setError(saveError instanceof Error ? saveError.message : "Unable to update tech tree board.");
			}
		},
		[applyBoardState, boardPath, manager]
	);

	const undoBoardChange = useCallback(
		() => {
			if (!board) {
				return;
			}

			const historyEntry = historyRef.current.undos.pop();

			if (!historyEntry) {
				return;
			}

			pushBoardHistory(historyRef.current.redos, historyEntry);
			setIsPlacingNode(false);
			setPlacementFlowPosition(null);
			void persistBoard(applyBoardPatch(board, historyEntry.undo), { recordHistory: false });
		},
		[board, persistBoard]
	);

	const redoBoardChange = useCallback(
		() => {
			if (!board) {
				return;
			}

			const historyEntry = historyRef.current.redos.pop();

			if (!historyEntry) {
				return;
			}

			pushBoardHistory(historyRef.current.undos, historyEntry);
			setIsPlacingNode(false);
			setPlacementFlowPosition(null);
			void persistBoard(applyBoardPatch(board, historyEntry.redo), { recordHistory: false });
		},
		[board, persistBoard]
	);

	const questViewValidation = useMemo(
		() => board ? getQuestViewValidation(board) : { canEnter: false, reason: "Open a tech tree board first." },
		[board]
	);

	const storedQuestViewMode = useMemo(
		() => Boolean(board?.nodes.find((node) => node.data.priority === "goal")?.data.questViewMode),
		[board]
	);

	const persistQuestViewMode = useCallback(
		(nextValue: boolean) => {
			if (!board) {
				return;
			}

			void persistBoard({
				...board,
				nodes: board.nodes.map((node) => node.data.priority === "goal"
					? {
						...node,
						data: {
							...node.data,
							text: updateGoalQuestViewMode(node.data.text, nextValue),
							questViewMode: nextValue
						}
					}
					: node)
			});
		},
		[board, persistBoard]
	);

	const handleQuestViewModeChange = useCallback(
		(nextValue: boolean) => {
			if (!board) {
				return;
			}

			if (nextValue && !questViewValidation.canEnter) {
				setQuestMirrorBounds(null);
				setIsQuestView(false);
				persistQuestViewMode(false);
				return;
			}

			setQuestMirrorBounds(nextValue ? getHorizontalMirrorBounds(board.nodes) : null);
			setIsQuestView(nextValue);
			persistQuestViewMode(nextValue);
		},
		[board, persistQuestViewMode, questViewValidation.canEnter]
	);

	const activeBoard = useMemo(
		() => {
			if (!board) {
				return null;
			}

			const nextBoard = isQuestView ? createQuestViewBoard(board, questMirrorBounds ?? getHorizontalMirrorBounds(board.nodes)) : createEditingViewBoard(board);
			return isFocusMode ? filterBoardToPriorityPath(nextBoard, priorityPathState) : nextBoard;
		},
		[board, isFocusMode, isQuestView, priorityPathState, questMirrorBounds]
	);
	activeBoardRef.current = activeBoard;

	useEffect(() => {
		if (isQuestView && !questViewValidation.canEnter) {
			setQuestMirrorBounds(null);
			setIsQuestView(false);
			persistQuestViewMode(false);
		}
	}, [isQuestView, persistQuestViewMode, questViewValidation.canEnter]);

	useEffect(() => {
		if (!board) {
			setIsQuestView(false);
			setQuestMirrorBounds(null);
			return;
		}

		const nextValue = storedQuestViewMode && questViewValidation.canEnter;

		setIsQuestView(nextValue);

		if (!nextValue) {
			setQuestMirrorBounds(null);
		}
	}, [board, questViewValidation.canEnter, storedQuestViewMode]);

	useEffect(() => {
		setPaneMenu(null);
		setNodeMenu(null);
		setRightDragSelection(null);
		rightDragSelectionRef.current = null;
		setIsPlacingNode(false);
		setPlacementFlowPosition(null);
		window.requestAnimationFrame(() => {
			void reactFlow.fitView({ padding: FIT_VIEW_PADDING });
		});
	}, [isQuestView, reactFlow]);

	const handleTextChange = useCallback(
		(nodeId: string, text: string) => {
			const currentBoard = boardRef.current;

			if (!currentBoard || isQuestView) {
				return;
			}

			const existingNode = currentBoard.nodes.find((node) => node.id === nodeId);

			if (!existingNode) {
				return;
			}

			void persistBoard({
				...currentBoard,
				nodes: currentBoard.nodes.map((node) => node.id === nodeId
					? {
						...node,
						data: {
							...node.data,
							text: updateNodeVisibleText(node.data.text, text)
						}
					}
					: node)
			});
		},
		[isQuestView, persistBoard]
	);

	const handleCompletedChange = useCallback(
		(nodeId: string, completed: boolean) => {
			const currentBoard = boardRef.current;

			if (!currentBoard) {
				return;
			}

			const activeNode = activeBoardRef.current?.nodes.find((node) => node.id === nodeId);

			if (activeNode?.data.locked) {
				return;
			}

			void persistBoard({
				...currentBoard,
				nodes: currentBoard.nodes.map((node) => node.id === nodeId
					? {
						...node,
						data: {
							...node.data,
							text: updateNodeCompletionStatus(node.data.text, completed)
						}
					}
					: node)
			});
		},
		[persistBoard]
	);

	const handlePriorityChange = useCallback(
		(nodeId: string, priority: TechTreePriority) => {
			const currentBoard = boardRef.current;

			if (!currentBoard || isQuestView) {
				return;
			}

			const existingNode = currentBoard.nodes.find((node) => node.id === nodeId);

			if (!existingNode) {
				return;
			}

			if (priority === "goal" && currentBoard.nodes.some((node) => node.id !== nodeId && node.data.priority === "goal")) {
				return;
			}

			void persistBoard({
				...currentBoard,
				nodes: currentBoard.nodes.map((node) => node.id === nodeId
					? {
						...node,
						data: {
							...node.data,
							text: priority === "goal"
								? updateNodePriorityOrder(updateNodePriority(node.data.text, priority), MIN_PRIORITY_ORDER)
								: updateNodePriority(node.data.text, priority)
						}
					}
					: node)
			});
		},
		[isQuestView, persistBoard]
	);

	const handlePriorityOrderChange = useCallback(
		(nodeId: string, priorityOrder: number) => {
			const currentBoard = boardRef.current;

			if (!currentBoard || isQuestView) {
				return;
			}

			const existingNode = currentBoard.nodes.find((node) => node.id === nodeId);

			if (!existingNode) {
				return;
			}

			const nextPriorityOrder = clampPriorityOrder(priorityOrder);

			void persistBoard({
				...currentBoard,
				nodes: currentBoard.nodes.map((node) => node.id === nodeId
					? {
						...node,
						data: {
							...node.data,
							text: updateNodePriorityOrder(node.data.text, nextPriorityOrder)
						}
					}
					: node)
			});
		},
		[isQuestView, persistBoard]
	);

	const handleDeleteEdge = useCallback(
		(edgeId: string) => {
			const currentBoard = boardRef.current;

			if (!currentBoard || isQuestView) {
				return;
			}

			void persistBoard({
				...currentBoard,
				edges: currentBoard.edges.filter((edge) => edge.id !== edgeId)
			});
		},
		[isQuestView, persistBoard]
	);

	const handleReverseEdge = useCallback(
		(edgeId: string) => {
			const currentBoard = boardRef.current;

			if (!currentBoard || isQuestView) {
				return;
			}

			void persistBoard({
				...currentBoard,
				edges: currentBoard.edges.map((edge) => {
					if (edge.id !== edgeId) {
						return edge;
					}

					const reversedEdge = {
						...edge,
						source: edge.target,
						target: edge.source,
						sourceHandle: normalizeHandleId(edge.targetHandle, "handle-right"),
						targetHandle: normalizeHandleId(edge.sourceHandle, "handle-left")
					};

					return isAllowedEdgeForNodes(currentBoard.nodes, reversedEdge) ? reversedEdge : edge;
				})
			});
		},
		[isQuestView, persistBoard]
	);

	const flowNodes = useMemo(
		() => {
			if (!activeBoard) {
				return [];
			}

			const goalNodeCount = activeBoard.nodes.reduce((count, node) => count + (node.data.priority === "goal" ? 1 : 0), 0);
			const nextNodeIds = new Set<string>();
			const nextNodes: TechTreeNode[] = activeBoard.nodes.map((node) => {
				const locked = Boolean(node.data.locked);
				const isGoal = node.data.priority === "goal";
				const hasOtherGoalNode = isGoal ? goalNodeCount > 1 : goalNodeCount > 0;
				const width = getMinimumNodeWidth(node);
				const height = getNodeDisplayHeight(node);
				const canEditStructure = !isQuestView && !locked;
				const canMoveNode = isQuestView || canEditStructure;
				const nextNode: TechTreeNode = {
					...node,
					width,
					height,
					measured: {
						...node.measured,
						width,
						height
					},
					style: {
						...node.style,
						width,
						height
					},
					selected: canMoveNode ? node.selected : false,
					draggable: canMoveNode,
					dragHandle: ".tech-tree-node__drag-handle",
					selectable: canMoveNode,
					connectable: canEditStructure,
					deletable: canEditStructure && !isGoal,
					focusable: canMoveNode,
					data: {
						...node.data,
						onTextChange: handleTextChange,
						onCompletedChange: handleCompletedChange,
						onPriorityChange: handlePriorityChange,
						onPriorityOrderChange: handlePriorityOrderChange,
						hasOtherGoalNode,
						isQuestView
					}
				};

				nextNodeIds.add(nextNode.id);
				return getCachedFlowNode(flowNodeCacheRef.current, nextNode);
			});

			if (isPlacingNode && placementFlowPosition && !isQuestView) {
				const placementPreviewNode = createPlacementPreviewNode(placementFlowPosition);
				nextNodeIds.add(placementPreviewNode.id);
				nextNodes.push(getCachedFlowNode(flowNodeCacheRef.current, placementPreviewNode));
			}

			pruneCache(flowNodeCacheRef.current, nextNodeIds);
			return nextNodes;
		},
		[activeBoard, handleCompletedChange, handlePriorityChange, handlePriorityOrderChange, handleTextChange, isPlacingNode, isQuestView, placementFlowPosition]
	);

	const flowNodesById = useMemo(
		() => new Map(flowNodes.map((node) => [node.id, node])),
		[flowNodes]
	);

	const flowEdges = useMemo(
		() => {
			const selectedNodeCount = flowNodes.filter((node) => node.selected).length;
			const selectedEdgeCount = activeBoard?.edges.filter((edge) => edge.selected).length ?? 0;
			const showSelectedEdgeToolbar = selectedNodeCount === 0 && selectedEdgeCount === 1;
			const nextEdgeIds = new Set<string>();

			const nextEdges = activeBoard?.edges.flatMap((edge) => {
				const source = flowNodesById.get(edge.source);
				const target = flowNodesById.get(edge.target);

				if (!source || !target || !isAllowedDisplayEdge(source, target, isQuestView)) {
					return [];
				}

				const edgeHandles = getEdgeHandles(source, target, edge);
				const baseEdgeId = getBaseEdgeId(edge.id);
				const isPriorityPath = priorityPathState.hasActivePath && priorityPathState.edgeIds.has(baseEdgeId);
				const edgeClassName = [getEdgeClassName(source, target, isQuestView), isPriorityPath ? EDGE_CLASSES.priorityPath : ""]
					.filter(Boolean)
					.join(" ");
				const edgeMarkerColor = getEdgeMarkerColor(edgeClassName);
				const isStraight = isStraightQuestLine(edgeClassName);
				const nextEdge: Edge = {
					...edge,
					type: "techTreeEdge",
					sourceHandle: edgeHandles.sourceHandle,
					targetHandle: edgeHandles.targetHandle,
					markerEnd: {
						type: MarkerType.ArrowClosed,
						color: edgeMarkerColor
					},
					interactionWidth: edge.interactionWidth ?? 28,
					selectable: true,
					deletable: !isQuestView,
					reconnectable: !isQuestView,
					data: {
						...edge.data,
						isQuestView,
						isStraight,
						isPriorityPath,
						showToolbar: showSelectedEdgeToolbar,
						onDelete: handleDeleteEdge,
						onReverse: handleReverseEdge
					},
					className: edgeClassName,
					zIndex: getEdgeZIndex(edgeClassName)
				};

				nextEdgeIds.add(nextEdge.id);
				return [getCachedFlowEdge(flowEdgeCacheRef.current, nextEdge)];
			}) ?? [];

			pruneCache(flowEdgeCacheRef.current, nextEdgeIds);
			return nextEdges;
		},
		[activeBoard?.edges, flowNodes, flowNodesById, handleDeleteEdge, handleReverseEdge, isQuestView, priorityPathState]
	);

	const flowConnectionKeys = useMemo(
		() => new Set(flowEdges.map(getConnectionKey)),
		[flowEdges]
	);

	const handleNodesChange = useCallback(
		(changes: NodeChange<TechTreeNode>[]) => {
			if (!board) {
				return;
			}

			if (isPlacingNode && changes.every((change) => change.type === "select")) {
				return;
			}

			if (isQuestView) {
				const questChanges = changes.filter((change) => change.type === "position");

				if (questChanges.length === 0) {
					return;
				}

				const mirrorBounds = questMirrorBounds ?? getHorizontalMirrorBounds(board.nodes);
				const nextDisplayNodes = applyNodeChanges(questChanges, flowNodes);
				const nextBoard = {
					...board,
					nodes: mergeQuestViewNodePositions(board.nodes, nextDisplayNodes, mirrorBounds)
				};

				if (isTransientNodePositionChange(questChanges)) {
					transientBoardDirtyRef.current = true;
					queueTransientBoardUpdate(nextBoard);
					return;
				}

				transientBoardDirtyRef.current = false;
				void persistBoard(nextBoard, { recordHistory: false });
				return;
			}

			const safeChanges = changes.filter((change) => {
				if (change.type !== "remove") {
					return true;
				}

				const node = board.nodes.find((candidate) => candidate.id === change.id);
				return node?.data.priority !== "goal";
			});

			if (safeChanges.length === 0) {
				return;
			}

			const boardChanges = safeChanges.filter((change) => !isPlacementPreviewNodeChange(change));

			if (boardChanges.length === 0) {
				return;
			}

			const changedNodes = applyNodeChanges(boardChanges, flowNodes)
				.filter((node) => node.id !== PLACEMENT_PREVIEW_NODE_ID);
			const nextNodes = mergeChangedNodesIntoBoard(
				board.nodes,
				persistChangedNodeDimensions(changedNodes, boardChanges),
				boardChanges
			);
			const shouldRecordHistory = boardChanges.some((change) => change.type !== "select");
			const nextBoard = {
				...board,
				nodes: nextNodes
			};

			if (isTransientNodePositionChange(boardChanges) || isTransientNodeDimensionChange(boardChanges)) {
				transientBoardDirtyRef.current = true;
				queueTransientBoardUpdate(nextBoard);
				return;
			}

			if (!shouldRecordHistory) {
				updateBoardLocal(nextBoard);
				return;
			}

			if (isNodeLayoutOnlyChange(boardChanges)) {
				transientBoardDirtyRef.current = false;
				void persistBoard(nextBoard, { recordHistory: false });
				return;
			}

			void persistBoard(nextBoard);
		},
		[board, flowNodes, isPlacingNode, isQuestView, persistBoard, questMirrorBounds, queueTransientBoardUpdate, updateBoardLocal]
	);

	const handleEdgesChange = useCallback(
		(changes: EdgeChange[]) => {
			if (!board || isQuestView) {
				return;
			}

			const shouldRecordHistory = changes.some((change) => change.type !== "select");
			const nextBoard = {
				...board,
				edges: applyEdgeChanges(changes, board.edges)
			};

			if (!shouldRecordHistory) {
				updateBoardLocal(nextBoard);
				return;
			}

			void persistBoard(nextBoard);
		},
		[board, isQuestView, persistBoard, updateBoardLocal]
	);

	const persistTransientBoard = useCallback(() => {
		if (!transientBoardDirtyRef.current) {
			return;
		}

		flushTransientBoardUpdate();
		const latestBoard = boardRef.current;
		transientBoardDirtyRef.current = false;

		if (latestBoard) {
			void persistBoard(latestBoard, { recordHistory: false });
		}
	}, [flushTransientBoardUpdate, persistBoard]);

	const normalizeEdgeForBoard = useCallback(
		(edge: Edge): Edge => {
			if (!board) {
				return edge;
			}

			return normalizeEdgeForNodes(board.nodes, edge);
		},
		[board]
	);

	const handleConnect = useCallback(
		(connection: Connection) => {
			if (!board || isQuestView || !connection.source || !connection.target || connection.source === connection.target) {
				return;
			}

			const nextEdge: Edge = {
				...connection,
				id: createEdgeId(connection),
				sourceHandle: normalizeHandleId(connection.sourceHandle, "handle-right"),
				targetHandle: normalizeHandleId(connection.targetHandle, "handle-left"),
				type: "techTreeEdge",
				markerEnd: {
					type: MarkerType.ArrowClosed
				},
				className: "tech-tree-edge"
			};
			const normalizedEdge = normalizeEdgeForBoard(nextEdge);

			if (!isAllowedConnectionForNodes(board.nodes, normalizedEdge) || board.edges.some((edge) => isSameConnection(edge, normalizedEdge))) {
				return;
			}

			void persistBoard({
				...board,
				edges: addEdge(normalizedEdge, board.edges)
			});
		},
		[board, isQuestView, normalizeEdgeForBoard, persistBoard]
	);

	const handleConnectEnd = useCallback(
		(event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
			if (!board || isQuestView || connectionState.isValid === true || connectionState.toHandle) {
				return;
			}

			const sourceNode = connectionState.fromNode
				? board.nodes.find((node) => node.id === connectionState.fromNode?.id)
				: null;
			const clientPosition = getEventClientPosition(event);

			if (!sourceNode || !clientPosition) {
				return;
			}

			const newNode = createNode(
				reactFlow.screenToFlowPosition(clientPosition),
				DEFAULT_NEW_NODE_OPTIONS
			);
			const nextNodes = [...board.nodes, newNode];
			const droppedEdge = createDroppedConnectionEdge(sourceNode, newNode, connectionState.fromHandle?.id);
			const normalizedEdge = normalizeEdgeForNodes(nextNodes, droppedEdge);

			if (!isAllowedConnectionForNodes(nextNodes, normalizedEdge) || board.edges.some((edge) => isSameConnection(edge, normalizedEdge))) {
				return;
			}

			void persistBoard({
				...board,
				nodes: nextNodes,
				edges: addEdge(normalizedEdge, board.edges)
			});
		},
		[board, isQuestView, persistBoard, reactFlow]
	);

	const handleReconnect = useCallback(
		(oldEdge: Edge, connection: Connection) => {
			if (!board || isQuestView || !connection.source || !connection.target || connection.source === connection.target) {
				return;
			}

			const persistedOldEdge = board.edges.find((edge) => edge.id === oldEdge.id) ?? oldEdge;
			const normalizedEdge = normalizeEdgeForBoard({
				...persistedOldEdge,
				...connection,
				sourceHandle: normalizeHandleId(connection.sourceHandle, "handle-right"),
				targetHandle: normalizeHandleId(connection.targetHandle, "handle-left")
			});

			if (!isAllowedConnectionForNodes(board.nodes, normalizedEdge) || board.edges.some((edge) => edge.id !== oldEdge.id && isSameConnection(edge, normalizedEdge))) {
				return;
			}

			const normalizedConnection: Connection = {
				source: normalizedEdge.source,
				target: normalizedEdge.target,
				sourceHandle: normalizedEdge.sourceHandle ?? null,
				targetHandle: normalizedEdge.targetHandle ?? null
			};

			const nextEdges = reconnectEdge(
				persistedOldEdge,
				normalizedConnection,
				board.edges,
				{ shouldReplaceId: false }
			).map((edge) => edge.id === oldEdge.id ? normalizeEdgeForBoard(edge) : edge);

			void persistBoard({
				...board,
				edges: nextEdges
			});
		},
		[board, isQuestView, normalizeEdgeForBoard, persistBoard]
	);

	const handleReconnectEnd = useCallback(
		(_event: MouseEvent | TouchEvent, edge: Edge, _handleType: HandleType, connectionState: FinalConnectionState) => {
			if (!board || isQuestView || connectionState.isValid === true) {
				return;
			}

			void persistBoard({
				...board,
				edges: board.edges.filter((candidate) => candidate.id !== edge.id)
			});
		},
		[board, isQuestView, persistBoard]
	);

	const handleReconnectStart = useCallback(() => {
		setPaneMenu(null);
		setNodeMenu(null);
	}, []);

	const isValidConnection = useCallback<IsValidConnection>(
		(connection) => Boolean(
			!isQuestView
			&& connection.source
			&& connection.target
			&& connection.source !== connection.target
			&& isAllowedConnectionForNodeMap(flowNodesById, connection)
			&& !flowConnectionKeys.has(getConnectionKey(connection))
		),
		[flowConnectionKeys, flowNodesById, isQuestView]
	);

	const sliceHoveredEdge = useCallback(
		(target: EventTarget | null) => {
			if (!board || isQuestView || !isEdgeSliceTarget(target)) {
				return false;
			}

			const edgeId = getSlicedEdgeId(target) ?? hoveredEdgeIdRef.current;

			if (!edgeId || slicedEdgeIdsRef.current.has(edgeId) || !board.edges.some((edge) => edge.id === edgeId)) {
				return false;
			}

			slicedEdgeIdsRef.current.add(edgeId);
			setPaneMenu(null);
			setNodeMenu(null);
			void persistBoard({
				...board,
				edges: board.edges.filter((edge) => edge.id !== edgeId)
			});

			return true;
		},
		[board, isQuestView, persistBoard]
	);

	const updatePlacementPositionFromClient = useCallback(
		(clientPosition: ClientPosition) => {
			lastPointerPositionRef.current = clientPosition;

			if (isPlacingNode) {
				setPlacementFlowPosition(getPlacementFlowPosition(clientPosition, reactFlow));
			}
		},
		[isPlacingNode, reactFlow]
	);

	const addPlacementNodeAt = useCallback(
		(clientPosition: ClientPosition) => {
			if (!board || isQuestView) {
				return;
			}

			const position = getPlacementFlowPosition(clientPosition, reactFlow);
			const newNode = createNode(position, DEFAULT_NEW_NODE_OPTIONS);
			const nodeAddResult = addNodeWithSelectedLinks(board, newNode);

			setPlacementFlowPosition(position);
			setPaneMenu(null);
			setNodeMenu(null);
			void persistBoard({
				...board,
				nodes: nodeAddResult.nodes,
				edges: nodeAddResult.edges
			});
		},
		[board, isQuestView, persistBoard, reactFlow]
	);

	const toggleFocusMode = useCallback(() => {
		setIsFocusMode((isActive) => !isActive);
	}, []);

	const toggleNodePlacementMode = useCallback(
		() => {
			if (!board || isQuestView) {
				return;
			}

			setPaneMenu(null);
			setNodeMenu(null);
			setRightDragSelection(null);
			rightDragSelectionRef.current = null;
			setIsPlacingNode((isActive) => {
				const nextActive = !isActive;

				if (nextActive) {
					const clientPosition = lastPointerPositionRef.current ?? getShellCenterClientPosition(shellRef.current);
					setPlacementFlowPosition(getPlacementFlowPosition(clientPosition, reactFlow));
				} else {
					setPlacementFlowPosition(null);
				}

				return nextActive;
			});
		},
		[board, isQuestView, reactFlow]
	);

	const cancelNodePlacementMode = useCallback(() => {
		setIsPlacingNode(false);
		setPlacementFlowPosition(null);
	}, []);

	const deleteSelectedNodes = useCallback(
		() => {
			if (!board || isQuestView) {
				return;
			}

			const selectedNodeIds = new Set(board.nodes
				.filter((node) => node.selected && node.data.priority !== "goal")
				.map((node) => node.id));

			if (selectedNodeIds.size === 0) {
				return;
			}

			setPaneMenu(null);
			setNodeMenu(null);
			void persistBoard({
				...board,
				nodes: board.nodes.filter((node) => !selectedNodeIds.has(node.id)),
				edges: board.edges.filter((edge) => !selectedNodeIds.has(edge.source) && !selectedNodeIds.has(edge.target))
			});
		},
		[board, isQuestView, persistBoard]
	);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (!isShellActiveForPlacement(shellRef.current, lastPointerPositionRef.current)) {
				return;
			}

			if (event.key === "Escape" && isPlacingNode) {
				event.preventDefault();
				event.stopPropagation();
				cancelNodePlacementMode();
				return;
			}

			if (isAltPlacementShortcut(event) && !shouldIgnoreAltPlacementTarget(event.target)) {
				event.preventDefault();
				event.stopPropagation();
				toggleNodePlacementMode();
				return;
			}

			if (shouldIgnoreBoardShortcutTarget(event.target)) {
				return;
			}

			if (event.key === "Delete" && !event.altKey && !event.ctrlKey && !event.metaKey) {
				event.preventDefault();
				event.stopPropagation();
				deleteSelectedNodes();
				return;
			}

			if (isUndoShortcut(event)) {
				event.preventDefault();
				event.stopPropagation();
				undoBoardChange();
				return;
			}

			if (isRedoShortcut(event)) {
				event.preventDefault();
				event.stopPropagation();
				redoBoardChange();
				return;
			}
		};

		window.addEventListener("keydown", handleKeyDown, { capture: true });

		return () => {
			window.removeEventListener("keydown", handleKeyDown, { capture: true });
		};
	}, [cancelNodePlacementMode, deleteSelectedNodes, isPlacingNode, redoBoardChange, toggleNodePlacementMode, undoBoardChange]);

	const suppressContextMenusBriefly = useCallback(() => {
		suppressContextMenuRef.current = true;
		window.setTimeout(() => {
			suppressContextMenuRef.current = false;
		}, CONTEXT_MENU_SUPPRESS_MS);
	}, []);

	const shouldSuppressContextMenu = useCallback(
		(event: MouseEvent | React.MouseEvent<Element, MouseEvent>) => {
			if (!suppressContextMenuRef.current && rightDragSelectionRef.current?.active !== true) {
				return false;
			}

			event.preventDefault();
			event.stopPropagation();
			suppressContextMenuRef.current = false;
			return true;
		},
		[]
	);

	const applyRightDragSelection = useCallback(
		(selection: RightDragSelectionState) => {
			if (!board || isQuestView) {
				return;
			}

			const start = reactFlow.screenToFlowPosition(selection.startClient);
			const end = reactFlow.screenToFlowPosition(selection.currentClient);
			const area = {
				x: Math.min(start.x, end.x),
				y: Math.min(start.y, end.y),
				width: Math.abs(end.x - start.x),
				height: Math.abs(end.y - start.y)
			};
			const selectedNodeIds = new Set(reactFlow
				.getIntersectingNodes(area, true, flowNodes)
				.filter((node) => node.selectable !== false)
				.map((node) => node.id));

			updateBoardLocal({
				...board,
				nodes: board.nodes.map((node) => ({
					...node,
					selected: selectedNodeIds.has(node.id)
				})),
				edges: board.edges.map((edge) => ({
					...edge,
					selected: false
				}))
			});
		},
		[board, flowNodes, isQuestView, reactFlow, updateBoardLocal]
	);

	const handleShellPointerDownCapture = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const clientPosition = { x: event.clientX, y: event.clientY };
			lastPointerPositionRef.current = clientPosition;

			if (event.button === EDGE_SLICE_BUTTON && sliceHoveredEdge(event.target)) {
				event.preventDefault();
				event.stopPropagation();
				return;
			}

			if (event.button === 0 && isPlacingNode) {
				if (!board || isQuestView || shouldIgnoreNodePlacementTarget(event.target)) {
					return;
				}

				addPlacementNodeAt(clientPosition);
				event.preventDefault();
				event.stopPropagation();
				return;
			}

			if (event.button !== RIGHT_DRAG_SELECTION_BUTTON || !board || isQuestView || isPlacingNode || shouldIgnoreRightDragSelectionTarget(event.target)) {
				return;
			}

			const startLocal = getLocalMenuPosition(clientPosition, shellRef.current, { x: 0, y: 0 });

			rightDragSelectionRef.current = {
				pointerId: event.pointerId,
				startClient: clientPosition,
				currentClient: clientPosition,
				startLocal,
				currentLocal: startLocal,
				active: false
			};
			setRightDragSelection(null);
		},
		[addPlacementNodeAt, board, isPlacingNode, isQuestView, sliceHoveredEdge]
	);

	const handleShellPointerMoveCapture = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			const currentClient = { x: event.clientX, y: event.clientY };

			updatePlacementPositionFromClient(currentClient);

			if ((event.buttons & EDGE_SLICE_BUTTONS_MASK) !== 0 && sliceHoveredEdge(event.target)) {
				event.preventDefault();
				event.stopPropagation();
				return;
			}

			const selection = rightDragSelectionRef.current;

			if (!selection || selection.pointerId !== event.pointerId || (event.buttons & RIGHT_DRAG_SELECTION_BUTTONS_MASK) === 0) {
				return;
			}

			const dragDistance = Math.hypot(
				currentClient.x - selection.startClient.x,
				currentClient.y - selection.startClient.y
			);

			if (!selection.active && dragDistance < RIGHT_DRAG_SELECTION_THRESHOLD) {
				return;
			}

			const currentLocal = getLocalMenuPosition(currentClient, shellRef.current, { x: 0, y: 0 });
			const nextSelection: RightDragSelectionState = {
				...selection,
				currentClient,
				currentLocal,
				active: true
			};

			rightDragSelectionRef.current = nextSelection;
			setRightDragSelection(nextSelection);
			setPaneMenu(null);
			setNodeMenu(null);
			suppressContextMenusBriefly();
			event.currentTarget.setPointerCapture(event.pointerId);
			event.preventDefault();
			event.stopPropagation();
		},
		[sliceHoveredEdge, suppressContextMenusBriefly, updatePlacementPositionFromClient]
	);

	const handleShellPointerUpCapture = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			lastPointerPositionRef.current = { x: event.clientX, y: event.clientY };

			if ((event.buttons & EDGE_SLICE_BUTTONS_MASK) === 0) {
				slicedEdgeIdsRef.current.clear();
			}

			const selection = rightDragSelectionRef.current;

			if (!selection || selection.pointerId !== event.pointerId) {
				return;
			}

			const finalSelection: RightDragSelectionState = {
				...selection,
				currentClient: { x: event.clientX, y: event.clientY },
				currentLocal: getLocalMenuPosition({ x: event.clientX, y: event.clientY }, shellRef.current, { x: 0, y: 0 })
			};

			rightDragSelectionRef.current = null;
			setRightDragSelection(null);

			if (!selection.active) {
				return;
			}

			suppressContextMenusBriefly();
			applyRightDragSelection(finalSelection);
			event.preventDefault();
			event.stopPropagation();
		},
		[applyRightDragSelection, suppressContextMenusBriefly]
	);

	const handleShellPointerCancelCapture = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			slicedEdgeIdsRef.current.clear();
			const selection = rightDragSelectionRef.current;

			if (!selection || selection.pointerId !== event.pointerId) {
				return;
			}

			if (selection.active) {
				suppressContextMenusBriefly();
			}

			rightDragSelectionRef.current = null;
			setRightDragSelection(null);
		},
		[suppressContextMenusBriefly]
	);

	const handlePaneContextMenu = useCallback(
		(event: MouseEvent | React.MouseEvent<Element, MouseEvent>) => {
			if (shouldSuppressContextMenu(event)) {
				return;
			}

			event.preventDefault();

			if (!board || isQuestView || isPlacingNode) {
				return;
			}

			const clientPosition = getEventClientPosition(event);

			if (!clientPosition) {
				return;
			}

			setNodeMenu(null);
			setPaneMenu({
				flowPosition: reactFlow.screenToFlowPosition(clientPosition),
				screenPosition: getLocalMenuPosition(clientPosition, shellRef.current, { x: 0, y: PANE_MENU_OFFSET_Y })
			});
		},
		[board, isPlacingNode, isQuestView, reactFlow, shouldSuppressContextMenu]
	);

	const handleAddNodeFromMenu = useCallback(
		() => {
			if (!board || isQuestView || !paneMenu) {
				return;
			}

			const newNode = createNode(paneMenu.flowPosition, DEFAULT_NEW_NODE_OPTIONS);
			const nodeAddResult = addNodeWithSelectedLinks(board, newNode);

			void persistBoard({
				...board,
				nodes: nodeAddResult.nodes,
				edges: nodeAddResult.edges
			});
			setPaneMenu(null);
		},
		[board, isQuestView, paneMenu, persistBoard]
	);

	const handlePaneClick = useCallback(() => {
		setPaneMenu(null);
		setNodeMenu(null);
	}, []);

	const handleEdgeClick = useCallback(
		(event: React.MouseEvent, clickedEdge: Edge) => {
			if (!board || isQuestView) {
				return;
			}

			event.stopPropagation();
			setPaneMenu(null);
			setNodeMenu(null);
			updateBoardLocal({
				...selectOnlyEdge(board, clickedEdge.id)
			});
		},
		[board, isQuestView, updateBoardLocal]
	);

	const handleEdgeContextMenu = useCallback(
		(event: React.MouseEvent, clickedEdge: Edge) => {
			if (shouldSuppressContextMenu(event)) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();

			if (!board || isQuestView) {
				return;
			}

			setPaneMenu(null);
			setNodeMenu(null);
			updateBoardLocal({
				...selectOnlyEdge(board, clickedEdge.id)
			});
		},
		[board, isQuestView, shouldSuppressContextMenu, updateBoardLocal]
	);

	const handleEdgeMouseEnter = useCallback((_event: React.MouseEvent, edge: Edge) => {
		hoveredEdgeIdRef.current = edge.id;
	}, []);

	const handleEdgeMouseLeave = useCallback((_event: React.MouseEvent, edge: Edge) => {
		if (hoveredEdgeIdRef.current === edge.id) {
			hoveredEdgeIdRef.current = null;
		}
	}, []);

	const handleNodeContextMenu = useCallback(
		(event: React.MouseEvent, clickedNode: TechTreeNode) => {
			if (shouldSuppressContextMenu(event)) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();

			const persistedNode = board?.nodes.find((node) => node.id === clickedNode.id);

			if (!board || isQuestView || !persistedNode) {
				return;
			}

			const clientPosition = getEventClientPosition(event);

			if (!clientPosition) {
				return;
			}

			setPaneMenu(null);
			setNodeMenu({
				nodeId: clickedNode.id,
				screenPosition: getLocalMenuPosition(clientPosition, shellRef.current, { x: 0, y: PANE_MENU_OFFSET_Y })
			});
		},
		[board, isQuestView, shouldSuppressContextMenu]
	);

	const handleDeleteNodeFromMenu = useCallback(
		() => {
			if (!board || isQuestView || !nodeMenu) {
				return;
			}

			const nodeToDelete = board.nodes.find((node) => node.id === nodeMenu.nodeId);

			if (!nodeToDelete || !canDeleteNodeFromBoard(board, nodeToDelete)) {
				setNodeMenu(null);
				return;
			}

			void persistBoard({
				...board,
				nodes: board.nodes.filter((node) => node.id !== nodeMenu.nodeId),
				edges: board.edges.filter((edge) => edge.source !== nodeMenu.nodeId && edge.target !== nodeMenu.nodeId)
			});
			setNodeMenu(null);
		},
		[board, isQuestView, nodeMenu, persistBoard]
	);

	const handleToggleNodeCompletionFromMenu = useCallback(
		() => {
			if (!board || !nodeMenu) {
				return;
			}

			const nodeToUpdate = board.nodes.find((node) => node.id === nodeMenu.nodeId);

			if (!nodeToUpdate) {
				setNodeMenu(null);
				return;
			}

			void persistBoard({
				...board,
				nodes: board.nodes.map((node) => node.id === nodeMenu.nodeId
					? {
						...node,
						data: {
							...node.data,
							text: updateNodeCompletionStatus(node.data.text, !node.data.completed)
						}
					}
					: node)
			});
			setNodeMenu(null);
		},
		[board, nodeMenu, persistBoard]
	);

	if (error) {
		return <div className="tech-tree-empty">{error}</div>;
	}

	if (!board) {
		return <div className="tech-tree-empty">Loading tech tree...</div>;
	}

	const isQuestToggleDisabled = !questViewValidation.canEnter && !isQuestView;
	const questViewDisabledMessage = isQuestToggleDisabled
		? getQuestViewDisabledMessage(questViewValidation.reason)
		: null;
	const nodeMenuNode = nodeMenu ? board.nodes.find((node) => node.id === nodeMenu.nodeId) : null;
	const canRemoveNodeFromMenu = Boolean(nodeMenuNode && canDeleteNodeFromBoard(board, nodeMenuNode));

	return (
		<div
			className={["tech-tree-shell", isPlacingNode ? "is-placing-node" : ""].filter(Boolean).join(" ")}
			ref={shellRef}
			onPointerDownCapture={handleShellPointerDownCapture}
			onPointerMoveCapture={handleShellPointerMoveCapture}
			onPointerUpCapture={handleShellPointerUpCapture}
			onPointerCancelCapture={handleShellPointerCancelCapture}
		>
			<div className="tech-tree-mode-toggle nodrag nowheel">
				{isPlacingNode ? (
					<div className="tech-tree-placement-cancel-label">
						press alt again to cancel
					</div>
				) : null}
				<div className="tech-tree-quest-toggle">
					<label
						className={isQuestToggleDisabled ? "is-disabled" : ""}
						title={questViewDisabledMessage ?? "go into quest view"}
					>
						<input
							type="checkbox"
							checked={isQuestView}
							disabled={isQuestToggleDisabled}
							onChange={(event) => {
								handleQuestViewModeChange(event.currentTarget.checked);
							}}
						/>
						<span>go into quest view</span>
					</label>
					{questViewDisabledMessage ? (
						<div className="tech-tree-quest-toggle__reason">
							{questViewDisabledMessage}
						</div>
					) : null}
				</div>
			</div>
			<div className="tech-tree-board-toolbar nodrag nowheel nopan">
				<button
					type="button"
					className={["tech-tree-focus-mode-button", isFocusMode ? "is-active" : ""].filter(Boolean).join(" ")}
					aria-pressed={isFocusMode}
					onClick={toggleFocusMode}
				>
					Focus mode
				</button>
			</div>
			<ReactFlow
				nodes={flowNodes}
				edges={flowEdges}
				nodeTypes={nodeTypes}
				edgeTypes={edgeTypes}
				defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
				connectionLineType={ConnectionLineType.SmoothStep}
				connectionMode={ConnectionMode.Loose}
				connectOnClick={!isQuestView}
				nodesConnectable={!isQuestView}
				edgesReconnectable={!isQuestView}
				elevateEdgesOnSelect
				snapToGrid
				snapGrid={[20, 20]}
				deleteKeyCode={null}
				panOnDrag={[0]}
				panOnScroll={false}
				zoomOnScroll
				zoomOnPinch
				selectionKeyCode={null}
				selectionOnDrag={false}
				zoomOnDoubleClick={false}
				onlyRenderVisibleElements
				onNodesChange={handleNodesChange}
				onEdgesChange={handleEdgesChange}
				onNodeDragStop={persistTransientBoard}
				onConnect={handleConnect}
				onConnectEnd={handleConnectEnd}
				onReconnect={handleReconnect}
				onReconnectStart={handleReconnectStart}
				onReconnectEnd={handleReconnectEnd}
				onEdgeClick={handleEdgeClick}
				onEdgeContextMenu={handleEdgeContextMenu}
				onEdgeMouseEnter={handleEdgeMouseEnter}
				onEdgeMouseLeave={handleEdgeMouseLeave}
				onNodeContextMenu={handleNodeContextMenu}
				onPaneClick={handlePaneClick}
				onPaneContextMenu={handlePaneContextMenu}
				isValidConnection={isValidConnection}
				connectionRadius={CONNECTION_RADIUS}
				reconnectRadius={RECONNECT_RADIUS}
				minZoom={MIN_ZOOM}
				maxZoom={MAX_ZOOM}
				fitView
				fitViewOptions={{ padding: FIT_VIEW_PADDING }}
			>
				<TechTreeOriginBackground />
				<TechTreeViewportControls />
			</ReactFlow>
			{rightDragSelection?.active ? (
				<div
					className="tech-tree-drag-selection"
					style={getSelectionBoxStyle(rightDragSelection)}
				/>
			) : null}
			{paneMenu ? (
				<div
					className="tech-tree-pane-menu"
					style={{
						left: paneMenu.screenPosition.x,
						top: paneMenu.screenPosition.y
					}}
				>
					<button type="button" onClick={handleAddNodeFromMenu}>
						Add node
					</button>
				</div>
			) : null}
			{nodeMenu ? (
				<div
					className="tech-tree-pane-menu tech-tree-node-menu"
					style={{
						left: nodeMenu.screenPosition.x,
						top: nodeMenu.screenPosition.y
					}}
				>
					<button
						type="button"
						onClick={handleToggleNodeCompletionFromMenu}
					>
						{nodeMenuNode?.data.completed ? "Mark as undone" : "Mark as done"}
					</button>
					<button
						type="button"
						className="tech-tree-pane-menu__danger"
						disabled={!canRemoveNodeFromMenu}
						onClick={handleDeleteNodeFromMenu}
					>
						Delete node
					</button>
				</div>
			) : null}
		</div>
	);
}

function TechNodeComponent({ id, data, selected }: NodeProps<TechTreeNode>) {
	const noteRef = useRef<HTMLDivElement | null>(null);
	const nodeData = data;
	const locked = Boolean(nodeData.locked);
	const isPlacementPreview = Boolean(nodeData.isPlacementPreview);
	const isQuestView = Boolean(nodeData.isQuestView);
	const canEditNode = !isPlacementPreview && !isQuestView && !locked;
	const canToggleCompleted = !isPlacementPreview && !locked;
	const completed = Boolean(nodeData.completed);
	const showsPriorityOrder = !isPlacementPreview && nodeData.priority !== "goal";
	const hasCheckedNeighbor = Boolean(nodeData.hasCheckedNeighbor);
	const hasQuestPrerequisite = Boolean(nodeData.hasQuestPrerequisite);
	const priorityOptions = PRIORITY_OPTIONS.filter((option) => option.value !== "goal" || nodeData.priority === "goal" || !nodeData.hasOtherGoalNode);
	const priorityOrder = clampPriorityOrder(nodeData.priorityOrder);
	const nodeClassName = [
		"tech-tree-node",
		`is-status-${nodeData.statusKind}`,
		`is-progress-${nodeData.progressState}`,
		`is-priority-${nodeData.priority.replace(/\s+/g, "-")}`,
		locked ? "is-locked" : "is-unlocked",
		isPlacementPreview ? "is-placement-preview" : "",
		completed ? "is-completed" : "",
		hasCheckedNeighbor ? "has-checked-neighbor" : "",
		hasQuestPrerequisite ? "has-quest-prerequisite" : ""
	].filter(Boolean).join(" ");

	useEffect(() => {
		const note = noteRef.current;

		if (!note) {
			return;
		}

		const handleWheel = (event: WheelEvent) => {
			if (!event.ctrlKey) {
				return;
			}

			note.scrollTop += event.deltaY;
			note.scrollLeft += event.deltaX;
			event.preventDefault();
			event.stopPropagation();
		};

		note.addEventListener("wheel", handleWheel, { capture: true, passive: false });

		return () => {
			note.removeEventListener("wheel", handleWheel, { capture: true });
		};
	}, []);

	return (
		<div className={nodeClassName} aria-disabled={locked || isPlacementPreview}>
			<NodeResizer
				isVisible={selected && canEditNode}
				minWidth={MIN_NODE_WIDTH}
				minHeight={MIN_NODE_HEIGHT}
				color="#a5adba"
				handleClassName="tech-tree-node__resize-handle"
				lineClassName="tech-tree-node__resize-line"
			/>
			{HANDLE_POSITIONS.map((handle) => (
				<Handle
					key={handle.id}
					id={`handle-${handle.id}`}
					type="source"
					position={handle.position}
					isConnectable={canEditNode}
					className={`tech-tree-port tech-tree-port--${handle.id}`}
				/>
			))}
			<div className="tech-tree-node__header">
				<div className="tech-tree-node__drag-handle" title="Move node" aria-label="Move node">
					<GripIcon className="tech-tree-node__drag-icon" />
				</div>
				<label className="tech-tree-node__priority nodrag nowheel" title="Priority">
					<select
						aria-label="Priority"
						value={nodeData.priority}
						disabled={!canEditNode}
						onChange={(event) => {
							if (!canEditNode) {
								return;
							}

							nodeData.onPriorityChange?.(id, event.currentTarget.value as TechTreePriority);
						}}
						onClick={(event) => {
							event.stopPropagation();
						}}
					>
						{nodeData.priority === "medium impact" ? (
							<option value="medium impact" hidden>
								Medium impact
							</option>
						) : null}
						{priorityOptions.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</label>
				<label className="tech-tree-node__done nodrag nowheel" title="Mark done">
					<input
						type="checkbox"
						checked={completed}
						disabled={!canToggleCompleted}
						onChange={(event) => {
							if (!canToggleCompleted) {
								return;
							}

							nodeData.onCompletedChange?.(id, event.currentTarget.checked);
						}}
						onClick={(event) => {
							event.stopPropagation();
						}}
					/>
					<span aria-hidden="true" />
				</label>
			</div>
			{locked ? (
				<div className="tech-tree-node__lock" aria-label="Locked until previous node is done" title="Locked until previous node is done">
					<span aria-hidden="true" />
				</div>
			) : null}
			<div className="tech-tree-node__body">
				<div
					ref={noteRef}
					className="tech-tree-note nodrag nowheel"
					contentEditable={canEditNode}
					suppressContentEditableWarning
					onBlur={(event) => {
						if (!canEditNode) {
							return;
						}

						nodeData.onTextChange?.(id, event.currentTarget.innerText.trimEnd());
					}}
				>
					{nodeData.visibleText}
				</div>
			</div>
			{showsPriorityOrder ? (
				<label className="tech-tree-node__priority-order nodrag nowheel" title="Path priority">
					<input
						type="number"
						aria-label="Path priority"
						min={MIN_PRIORITY_ORDER}
						max={MAX_PRIORITY_ORDER}
						step={1}
						value={priorityOrder}
						disabled={!canEditNode}
						onChange={(event) => {
							if (!canEditNode) {
								return;
							}

							nodeData.onPriorityOrderChange?.(id, clampPriorityOrder(Number.parseInt(event.currentTarget.value || "0", 10)));
						}}
						onClick={(event) => {
							event.stopPropagation();
						}}
						onPointerDown={(event) => {
							event.stopPropagation();
						}}
					/>
				</label>
			) : null}
		</div>
	);
}

const TechNode = React.memo(TechNodeComponent, areTechNodePropsEqual);

function areTechNodePropsEqual(previous: NodeProps<TechTreeNode>, next: NodeProps<TechTreeNode>): boolean {
	return previous.id === next.id
		&& previous.selected === next.selected
		&& areTechTreeNodeDataEquivalent(previous.data, next.data);
}

function getMinimumNodeWidth(node: TechTreeNode): number {
	const width = typeof node.width === "number"
		? node.width
		: typeof node.measured?.width === "number"
			? node.measured.width
			: MIN_NODE_WIDTH;

	return Math.max(width, MIN_NODE_WIDTH);
}

function clampPriorityOrder(value: number): number {
	return Math.min(MAX_PRIORITY_ORDER, Math.max(MIN_PRIORITY_ORDER, Number.isFinite(value) ? Math.trunc(value) : MIN_PRIORITY_ORDER));
}

function getNodeDisplayHeight(node: TechTreeNode): number {
	const height = typeof node.height === "number"
		? node.height
		: typeof node.measured?.height === "number"
			? node.measured.height
			: MIN_NODE_HEIGHT;

	return height <= LEGACY_NODE_HEIGHT ? MIN_NODE_HEIGHT : Math.max(height, MIN_NODE_HEIGHT);
}

function getCachedFlowNode(cache: Map<string, TechTreeNode>, nextNode: TechTreeNode): TechTreeNode {
	const cachedNode = cache.get(nextNode.id);

	if (cachedNode && areFlowNodesEquivalent(cachedNode, nextNode)) {
		return cachedNode;
	}

	cache.set(nextNode.id, nextNode);
	return nextNode;
}

function areFlowNodesEquivalent(first: TechTreeNode, second: TechTreeNode): boolean {
	return first.id === second.id
		&& first.type === second.type
		&& first.position.x === second.position.x
		&& first.position.y === second.position.y
		&& first.width === second.width
		&& first.height === second.height
		&& first.selected === second.selected
		&& first.dragging === second.dragging
		&& first.draggable === second.draggable
		&& first.dragHandle === second.dragHandle
		&& first.selectable === second.selectable
		&& first.connectable === second.connectable
		&& first.deletable === second.deletable
		&& first.focusable === second.focusable
		&& first.zIndex === second.zIndex
		&& first.style?.width === second.style?.width
		&& first.style?.height === second.style?.height
		&& first.style?.pointerEvents === second.style?.pointerEvents
		&& areTechTreeNodeDataEquivalent(first.data, second.data);
}

function areTechTreeNodeDataEquivalent(first: TechTreeNode["data"], second: TechTreeNode["data"]): boolean {
	return first.text === second.text
		&& first.visibleText === second.visibleText
		&& first.title === second.title
		&& first.priority === second.priority
		&& first.priorityOrder === second.priorityOrder
		&& first.status === second.status
		&& first.statusKind === second.statusKind
		&& first.completed === second.completed
		&& first.locked === second.locked
		&& first.hasCheckedNeighbor === second.hasCheckedNeighbor
		&& first.hasQuestPrerequisite === second.hasQuestPrerequisite
		&& first.progressState === second.progressState
		&& first.questViewMode === second.questViewMode
		&& first.isQuestView === second.isQuestView
		&& first.isPlacementPreview === second.isPlacementPreview
		&& first.hasOtherGoalNode === second.hasOtherGoalNode
		&& first.onTextChange === second.onTextChange
		&& first.onCompletedChange === second.onCompletedChange
		&& first.onPriorityChange === second.onPriorityChange
		&& first.onPriorityOrderChange === second.onPriorityOrderChange;
}

function getCachedFlowEdge(cache: Map<string, Edge>, nextEdge: Edge): Edge {
	const cachedEdge = cache.get(nextEdge.id);

	if (cachedEdge && areFlowEdgesEquivalent(cachedEdge, nextEdge)) {
		return cachedEdge;
	}

	cache.set(nextEdge.id, nextEdge);
	return nextEdge;
}

function areFlowEdgesEquivalent(first: Edge, second: Edge): boolean {
	return first.id === second.id
		&& first.type === second.type
		&& first.source === second.source
		&& first.target === second.target
		&& first.sourceHandle === second.sourceHandle
		&& first.targetHandle === second.targetHandle
		&& first.selected === second.selected
		&& first.className === second.className
		&& first.zIndex === second.zIndex
		&& first.interactionWidth === second.interactionWidth
		&& first.selectable === second.selectable
		&& first.deletable === second.deletable
		&& first.reconnectable === second.reconnectable
		&& getMarkerType(first.markerEnd) === getMarkerType(second.markerEnd)
		&& getMarkerColor(first.markerEnd) === getMarkerColor(second.markerEnd)
		&& first.data?.isQuestView === second.data?.isQuestView
		&& first.data?.isStraight === second.data?.isStraight
		&& first.data?.isPriorityPath === second.data?.isPriorityPath
		&& first.data?.showToolbar === second.data?.showToolbar
		&& first.data?.onDelete === second.data?.onDelete
		&& first.data?.onReverse === second.data?.onReverse;
}

function getMarkerType(marker: Edge["markerEnd"]): unknown {
	return marker && typeof marker === "object" ? marker.type : marker;
}

function getMarkerColor(marker: Edge["markerEnd"]): string | undefined {
	return marker && typeof marker === "object" ? marker.color ?? undefined : undefined;
}

function pruneCache<T extends { id: string }>(cache: Map<string, T>, activeIds: Set<string>): void {
	for (const id of cache.keys()) {
		if (!activeIds.has(id)) {
			cache.delete(id);
		}
	}
}

function getSelectionBoxStyle(selection: RightDragSelectionState): React.CSSProperties {
	const left = Math.min(selection.startLocal.x, selection.currentLocal.x);
	const top = Math.min(selection.startLocal.y, selection.currentLocal.y);

	return {
		left,
		top,
		width: Math.abs(selection.currentLocal.x - selection.startLocal.x),
		height: Math.abs(selection.currentLocal.y - selection.startLocal.y)
	};
}

function pushBoardHistory(stack: BoardHistoryEntry[], historyEntry: BoardHistoryEntry): void {
	stack.push(historyEntry);

	if (stack.length > BOARD_HISTORY_LIMIT) {
		stack.shift();
	}
}

function createBoardHistoryEntry(previousBoard: TechTreeBoard, nextBoard: TechTreeBoard): BoardHistoryEntry | null {
	const redo = createBoardPatch(previousBoard, nextBoard);

	if (isBoardPatchEmpty(redo)) {
		return null;
	}

	return {
		undo: createBoardPatch(nextBoard, previousBoard),
		redo
	};
}

function createBoardPatch(fromBoard: TechTreeBoard, toBoard: TechTreeBoard): BoardPatch {
	const fromNodesById = new Map(fromBoard.nodes.map((node) => [node.id, node]));
	const toNodesById = new Map(toBoard.nodes.map((node) => [node.id, node]));
	const fromEdgesById = new Map(fromBoard.edges.map((edge) => [edge.id, edge]));
	const toEdgesById = new Map(toBoard.edges.map((edge) => [edge.id, edge]));

	return {
		removeNodeIds: fromBoard.nodes.filter((node) => !toNodesById.has(node.id)).map((node) => node.id),
		restoreNodes: toBoard.nodes
			.map((node, index) => ({ node, index }))
			.filter(({ node }) => !fromNodesById.has(node.id))
			.map(({ node, index }) => ({ node: cloneHistoryNode(node), index })),
		updateNodes: toBoard.nodes
			.filter((node) => {
				const previousNode = fromNodesById.get(node.id);
				return previousNode && !areHistoryNodesEqual(previousNode, node);
			})
			.map((node) => ({ id: node.id, node: cloneHistoryNode(node) })),
		removeEdgeIds: fromBoard.edges.filter((edge) => !toEdgesById.has(edge.id)).map((edge) => edge.id),
		restoreEdges: toBoard.edges
			.map((edge, index) => ({ edge, index }))
			.filter(({ edge }) => !fromEdgesById.has(edge.id))
			.map(({ edge, index }) => ({ edge: cloneHistoryEdge(edge), index })),
		updateEdges: toBoard.edges
			.filter((edge) => {
				const previousEdge = fromEdgesById.get(edge.id);
				return previousEdge && !areHistoryEdgesEqual(previousEdge, edge);
			})
			.map((edge) => ({ id: edge.id, edge: cloneHistoryEdge(edge) }))
	};
}

function applyBoardPatch(board: TechTreeBoard, patch: BoardPatch): TechTreeBoard {
	const removeNodeIds = new Set(patch.removeNodeIds);
	const removeEdgeIds = new Set(patch.removeEdgeIds);
	const updateNodesById = new Map(patch.updateNodes.map((update) => [update.id, update.node]));
	const updateEdgesById = new Map(patch.updateEdges.map((update) => [update.id, update.edge]));
	const nodes = insertHistoryNodes(
		board.nodes
			.filter((node) => !removeNodeIds.has(node.id))
			.map((node) => updateNodesById.get(node.id) ?? node),
		patch.restoreNodes
	);
	const nodeIds = new Set(nodes.map((node) => node.id));
	const edges = insertHistoryEdges(
		board.edges
			.filter((edge) => !removeEdgeIds.has(edge.id))
			.map((edge) => updateEdgesById.get(edge.id) ?? edge)
			.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)),
		patch.restoreEdges.filter(({ edge }) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
	);

	return {
		...board,
		nodes,
		edges
	};
}

function insertHistoryNodes(nodes: TechTreeNode[], restoreNodes: IndexedHistoryNode[]): TechTreeNode[] {
	const nextNodes = [...nodes];
	const nodeIds = new Set(nextNodes.map((node) => node.id));

	for (const { node, index } of [...restoreNodes].sort((a, b) => a.index - b.index)) {
		if (nodeIds.has(node.id)) {
			continue;
		}

		nextNodes.splice(Math.min(index, nextNodes.length), 0, cloneHistoryNode(node));
		nodeIds.add(node.id);
	}

	return nextNodes;
}

function insertHistoryEdges(edges: Edge[], restoreEdges: IndexedHistoryEdge[]): Edge[] {
	const nextEdges = [...edges];
	const edgeIds = new Set(nextEdges.map((edge) => edge.id));

	for (const { edge, index } of [...restoreEdges].sort((a, b) => a.index - b.index)) {
		if (edgeIds.has(edge.id)) {
			continue;
		}

		nextEdges.splice(Math.min(index, nextEdges.length), 0, cloneHistoryEdge(edge));
		edgeIds.add(edge.id);
	}

	return nextEdges;
}

function isBoardPatchEmpty(patch: BoardPatch): boolean {
	return patch.removeNodeIds.length === 0
		&& patch.restoreNodes.length === 0
		&& patch.updateNodes.length === 0
		&& patch.removeEdgeIds.length === 0
		&& patch.restoreEdges.length === 0
		&& patch.updateEdges.length === 0;
}

function cloneHistoryNode(node: TechTreeNode): TechTreeNode {
	return {
		...node,
		position: { ...node.position },
		measured: node.measured ? { ...node.measured } : node.measured,
		style: node.style ? { ...node.style } : node.style,
		data: { ...node.data }
	};
}

function cloneHistoryEdge(edge: Edge): Edge {
	return {
		...edge,
		data: edge.data ? { ...edge.data } : edge.data,
		markerStart: edge.markerStart && typeof edge.markerStart === "object" ? { ...edge.markerStart } : edge.markerStart,
		markerEnd: edge.markerEnd && typeof edge.markerEnd === "object" ? { ...edge.markerEnd } : edge.markerEnd,
		style: edge.style ? { ...edge.style } : edge.style
	};
}

function areHistoryNodesEqual(first: TechTreeNode, second: TechTreeNode): boolean {
	return first.type === second.type
		&& first.position.x === second.position.x
		&& first.position.y === second.position.y
		&& first.width === second.width
		&& first.height === second.height
		&& first.data.text === second.data.text;
}

function areHistoryEdgesEqual(first: Edge, second: Edge): boolean {
	return first.source === second.source
		&& first.target === second.target
		&& first.sourceHandle === second.sourceHandle
		&& first.targetHandle === second.targetHandle
		&& first.type === second.type;
}

function createEmptyPriorityPathState(): PriorityPathState {
	return {
		nodeIds: new Set(),
		edgeIds: new Set(),
		visibleEdgeIds: new Set(),
		pathNodeIds: [],
		priorityNodeOrders: new Map(),
		pathEndNodeId: null,
		hasActivePath: false
	};
}

function getNextPriorityPathState(
	previousBoard: TechTreeBoard | null,
	nextBoard: TechTreeBoard,
	currentState: PriorityPathState
): PriorityPathState {
	if (!previousBoard || previousBoard.path !== nextBoard.path) {
		return getPriorityPathState(nextBoard);
	}

	const changeSummary = getPriorityPathChangeSummary(previousBoard, nextBoard);

	if (!changeSummary.hasPriorityRelevantChange) {
		return currentState;
	}

	if (shouldRefreshPriorityPath(currentState, changeSummary)) {
		return getPriorityPathState(nextBoard, currentState);
	}

	return updatePriorityNodeOrders(nextBoard, currentState);
}

function getPriorityPathState(board: TechTreeBoard, currentState?: PriorityPathState): PriorityPathState {
	const state = createEmptyPriorityPathState();
	const goalNode = board.nodes.find((node) => node.data.priority === "goal");

	if (!goalNode) {
		return state;
	}

	const nodesById = new Map(board.nodes.map((node) => [node.id, node]));
	const connectedEdgesByNode = getConnectedEdgesByNode(board.edges);
	const directLinks = getDirectPriorityLinks(board, nodesById, goalNode.id);
	state.priorityNodeOrders = getPriorityNodeOrders(board.nodes);

	const directNodeIds = new Set(directLinks.map((link) => link.nodeId));
	const context: PriorityPathContext = {
		nodesById,
		connectedEdgesByNode,
		directNodeIds,
		priorityNodeOrders: state.priorityNodeOrders,
		preferredNextNodeByParentId: getPreferredNextNodeByParentId(currentState, nodesById),
		goalId: goalNode.id
	};
	const activeLink = getBestActivePriorityLink(directLinks, context);

	if (!activeLink) {
		return state;
	}

	const activeChain = getActivePriorityChain(activeLink, context);
	state.pathEndNodeId = activeChain.pathEndNodeId;
	state.pathNodeIds = activeChain.pathNodeIds;
	state.hasActivePath = true;

	for (const nodeId of activeChain.nodeIds) {
		state.nodeIds.add(nodeId);
	}

	for (const edgeId of activeChain.edgeIds) {
		state.edgeIds.add(edgeId);
	}

	for (const edgeId of activeChain.visibleEdgeIds) {
		state.visibleEdgeIds.add(edgeId);
	}

	return state;
}

function updatePriorityNodeOrders(board: TechTreeBoard, currentState: PriorityPathState): PriorityPathState {
	const nextState = clonePriorityPathState(currentState);
	nextState.priorityNodeOrders = getPriorityNodeOrders(board.nodes);

	return nextState;
}

function clonePriorityPathState(state: PriorityPathState): PriorityPathState {
	return {
		nodeIds: new Set(state.nodeIds),
		edgeIds: new Set(state.edgeIds),
		visibleEdgeIds: new Set(state.visibleEdgeIds),
		pathNodeIds: [...state.pathNodeIds],
		priorityNodeOrders: new Map(state.priorityNodeOrders),
		pathEndNodeId: state.pathEndNodeId,
		hasActivePath: state.hasActivePath
	};
}

function getDirectPriorityLinks(
	board: TechTreeBoard,
	nodesById: Map<string, TechTreeNode>,
	goalNodeId: string
): DirectPriorityLink[] {
	const directLinks: DirectPriorityLink[] = [];
	const seenNodeIds = new Set<string>();

	for (const edge of board.edges) {
		const source = nodesById.get(edge.source);
		const target = nodesById.get(edge.target);
		const directNode = edge.source === goalNodeId && target?.data.priority === "necessary"
			? target
			: edge.target === goalNodeId && source?.data.priority === "necessary"
				? source
				: null;

		if (!directNode || seenNodeIds.has(directNode.id)) {
			continue;
		}

		directLinks.push({ nodeId: directNode.id, edgeId: edge.id });
		seenNodeIds.add(directNode.id);
	}

	return directLinks;
}

function getPriorityNodeOrders(nodes: TechTreeNode[]): Map<string, number> {
	const priorityNodeOrders = new Map<string, number>();

	for (const node of nodes) {
		if (node.data.priority === "goal") {
			continue;
		}

		const priorityOrder = getActivePriorityOrder(node.data.priorityOrder);

		if (priorityOrder !== null) {
			priorityNodeOrders.set(node.id, priorityOrder);
		}
	}

	return priorityNodeOrders;
}

function getActivePriorityOrder(priorityOrder: number): number | null {
	const normalizedPriorityOrder = clampPriorityOrder(priorityOrder);

	return normalizedPriorityOrder > MIN_PRIORITY_ORDER ? normalizedPriorityOrder : null;
}

function getPreferredNextNodeByParentId(
	currentState: PriorityPathState | undefined,
	nodesById: Map<string, TechTreeNode>
): Map<string, string> {
	const preferredNextNodeByParentId = new Map<string, string>();

	if (!currentState?.hasActivePath) {
		return preferredNextNodeByParentId;
	}

	for (let index = 0; index < currentState.pathNodeIds.length - 1; index += 1) {
		const parentNodeId = currentState.pathNodeIds[index];
		const childNodeId = currentState.pathNodeIds[index + 1];

		if (!parentNodeId || !childNodeId) {
			continue;
		}

		const parentNode = nodesById.get(parentNodeId);
		const childNode = nodesById.get(childNodeId);

		if (!parentNode || !childNode || parentNode.data.completed || childNode.data.completed) {
			continue;
		}

		preferredNextNodeByParentId.set(parentNode.id, childNode.id);
	}

	return preferredNextNodeByParentId;
}

function getPriorityPathChangeSummary(previousBoard: TechTreeBoard, nextBoard: TechTreeBoard): PriorityPathChangeSummary {
	const previousNodesById = new Map(previousBoard.nodes.map((node) => [node.id, node]));
	const nextNodesById = new Map(nextBoard.nodes.map((node) => [node.id, node]));
	const previousEdgesById = new Map(previousBoard.edges.map((edge) => [getBaseEdgeId(edge.id), edge]));
	const nextEdgesById = new Map(nextBoard.edges.map((edge) => [getBaseEdgeId(edge.id), edge]));
	const addedNodeIds = new Set<string>();
	const removedNodeIds = new Set<string>();
	const priorityChangedNodeIds = new Set<string>();
	const priorityOrderChangedNodeIds = new Set<string>();
	const completionChangedNodeIds = new Set<string>();
	const addedEdges: Edge[] = [];
	const removedEdges: Edge[] = [];
	const changedEdges: Edge[] = [];

	for (const previousNode of previousBoard.nodes) {
		const nextNode = nextNodesById.get(previousNode.id);

		if (!nextNode) {
			removedNodeIds.add(previousNode.id);
			continue;
		}

		if (previousNode.data.priority !== nextNode.data.priority) {
			priorityChangedNodeIds.add(previousNode.id);
		}

		if (previousNode.data.priorityOrder !== nextNode.data.priorityOrder) {
			priorityOrderChangedNodeIds.add(previousNode.id);
		}

		if (previousNode.data.completed !== nextNode.data.completed) {
			completionChangedNodeIds.add(previousNode.id);
		}
	}

	for (const nextNode of nextBoard.nodes) {
		if (!previousNodesById.has(nextNode.id)) {
			addedNodeIds.add(nextNode.id);
		}
	}

	for (const previousEdge of previousBoard.edges) {
		const nextEdge = nextEdgesById.get(getBaseEdgeId(previousEdge.id));

		if (!nextEdge) {
			removedEdges.push(previousEdge);
			continue;
		}

		if (!arePriorityPathEdgesEquivalent(previousEdge, nextEdge)) {
			changedEdges.push(nextEdge);
		}
	}

	for (const nextEdge of nextBoard.edges) {
		if (!previousEdgesById.has(getBaseEdgeId(nextEdge.id))) {
			addedEdges.push(nextEdge);
		}
	}

	const hasPriorityRelevantChange = addedNodeIds.size > 0
		|| removedNodeIds.size > 0
		|| priorityChangedNodeIds.size > 0
		|| priorityOrderChangedNodeIds.size > 0
		|| completionChangedNodeIds.size > 0
		|| addedEdges.length > 0
		|| removedEdges.length > 0
		|| changedEdges.length > 0;

	return {
		addedNodeIds,
		removedNodeIds,
		priorityChangedNodeIds,
		priorityOrderChangedNodeIds,
		completionChangedNodeIds,
		addedEdges,
		removedEdges,
		changedEdges,
		hasPriorityRelevantChange
	};
}

function shouldRefreshPriorityPath(currentState: PriorityPathState, changeSummary: PriorityPathChangeSummary): boolean {
	if (!currentState.hasActivePath) {
		return true;
	}

	if (changeSummary.priorityChangedNodeIds.size > 0 || changeSummary.priorityOrderChangedNodeIds.size > 0) {
		return true;
	}

	if (setsIntersect(changeSummary.completionChangedNodeIds, currentState.nodeIds)) {
		return true;
	}

	if (setsIntersect(changeSummary.removedNodeIds, currentState.nodeIds)) {
		return true;
	}

	if (changeSummary.removedEdges.some((edge) => currentState.visibleEdgeIds.has(getBaseEdgeId(edge.id)))) {
		return true;
	}

	if (changeSummary.changedEdges.some((edge) => currentState.visibleEdgeIds.has(getBaseEdgeId(edge.id)) || edgeTouchesNodeIds(edge, currentState.nodeIds))) {
		return true;
	}

	if (changeSummary.addedEdges.some((edge) => edgeTouchesNodeIds(edge, currentState.nodeIds))) {
		return true;
	}

	return false;
}

function arePriorityPathEdgesEquivalent(first: Edge, second: Edge): boolean {
	return first.source === second.source
		&& first.target === second.target
		&& normalizeHandleId(first.sourceHandle, "handle-right") === normalizeHandleId(second.sourceHandle, "handle-right")
		&& normalizeHandleId(first.targetHandle, "handle-left") === normalizeHandleId(second.targetHandle, "handle-left");
}

function edgeTouchesNodeIds(edge: Edge, nodeIds: Set<string>): boolean {
	return nodeIds.has(edge.source) || nodeIds.has(edge.target);
}

function setsIntersect(first: Set<string>, second: Set<string>): boolean {
	for (const value of first) {
		if (second.has(value)) {
			return true;
		}
	}

	return false;
}

function getConnectedEdgesByNode(edges: Edge[]): Map<string, Edge[]> {
	const connectedEdgesByNode = new Map<string, Edge[]>();

	for (const edge of edges) {
		const sourceEdges = connectedEdgesByNode.get(edge.source) ?? [];
		sourceEdges.push(edge);
		connectedEdgesByNode.set(edge.source, sourceEdges);

		const targetEdges = connectedEdgesByNode.get(edge.target) ?? [];
		targetEdges.push(edge);
		connectedEdgesByNode.set(edge.target, targetEdges);
	}

	return connectedEdgesByNode;
}

function getBestActivePriorityLink(directLinks: DirectPriorityLink[], context: PriorityPathContext): DirectPriorityLink | null {
	let bestLink: DirectPriorityLink | null = null;
	let bestRank: PriorityBranchRank | null = null;
	const preferredNodeId = context.preferredNextNodeByParentId.get(context.goalId);

	if (preferredNodeId) {
		for (const link of directLinks) {
			if (link.nodeId !== preferredNodeId) {
				continue;
			}

			const rank = getPriorityBranchRank(link.nodeId, context, new Set());

			if (!rank.isComplete) {
				return link;
			}
		}
	}

	for (const link of directLinks) {
		const rank = getPriorityBranchRank(link.nodeId, context, new Set());

		if (isBetterPriorityBranchRank(rank, bestRank)) {
			bestLink = link;
			bestRank = rank;
		}
	}

	return bestLink;
}

function getActivePriorityChain(activeLink: DirectPriorityLink, context: PriorityPathContext): PriorityPathChain {
	const forwardChain = getPriorityForwardChain(activeLink.nodeId, context, new Set([context.goalId]));

	return {
		nodeIds: [context.goalId, ...forwardChain.nodeIds],
		pathNodeIds: [context.goalId, ...forwardChain.pathNodeIds],
		edgeIds: [activeLink.edgeId, ...forwardChain.edgeIds],
		visibleEdgeIds: [activeLink.edgeId, ...forwardChain.visibleEdgeIds],
		pathEndNodeId: forwardChain.pathEndNodeId ?? activeLink.nodeId
	};
}

function getPriorityForwardChain(nodeId: string, context: PriorityPathContext, seenNodeIds: Set<string>): PriorityPathChain {
	const node = context.nodesById.get(nodeId);

	if (!node || seenNodeIds.has(nodeId) || node.data.completed) {
		return { nodeIds: [], pathNodeIds: [], edgeIds: [], visibleEdgeIds: [], pathEndNodeId: null };
	}

	const nextSeenNodeIds = new Set(seenNodeIds);
	nextSeenNodeIds.add(nodeId);
	const childLinks = getRankedPriorityChildLinks(nodeId, context, nextSeenNodeIds);
	const activeChildLink = getBestRankedPriorityChildLink(nodeId, childLinks, context);

	if (activeChildLink) {
		const childChain = getPriorityForwardChain(activeChildLink.nodeId, context, nextSeenNodeIds);

		if (childChain.nodeIds.length > 0) {
			return {
				nodeIds: [nodeId, ...childChain.nodeIds],
				pathNodeIds: [nodeId, ...childChain.pathNodeIds],
				edgeIds: [activeChildLink.edge.id, ...childChain.edgeIds],
				visibleEdgeIds: [activeChildLink.edge.id, ...childChain.visibleEdgeIds],
				pathEndNodeId: childChain.pathEndNodeId ?? activeChildLink.nodeId
			};
		}
	}

	const completedChildLinks = childLinks.filter((link) => link.rank.isComplete);

	return {
		nodeIds: [nodeId, ...completedChildLinks.map((link) => link.nodeId)],
		pathNodeIds: [nodeId],
		edgeIds: [],
		visibleEdgeIds: completedChildLinks.map((link) => link.edge.id),
		pathEndNodeId: nodeId
	};
}

function getBestRankedPriorityChildLink(
	parentNodeId: string,
	childLinks: RankedPriorityChildLink[],
	context: PriorityPathContext
): RankedPriorityChildLink | null {
	let bestLink: RankedPriorityChildLink | null = null;
	let bestRank: PriorityBranchRank | null = null;
	const preferredNodeId = context.preferredNextNodeByParentId.get(parentNodeId);

	if (preferredNodeId) {
		const preferredLink = childLinks.find((link) => link.nodeId === preferredNodeId && !link.rank.isComplete);

		if (preferredLink) {
			return preferredLink;
		}
	}

	for (const link of childLinks) {
		if (isBetterPriorityBranchRank(link.rank, bestRank)) {
			bestLink = link;
			bestRank = link.rank;
		}
	}

	return bestLink;
}

function getRankedPriorityChildLinks(
	nodeId: string,
	context: PriorityPathContext,
	seenNodeIds: Set<string>
): RankedPriorityChildLink[] {
	return getPriorityChildLinks(nodeId, context, seenNodeIds).map((link) => ({
		...link,
		rank: getPriorityBranchRank(link.nodeId, context, new Set(seenNodeIds))
	}));
}

function getPriorityChildLinks(nodeId: string, context: PriorityPathContext, seenNodeIds: Set<string>): PriorityChildLink[] {
	const childLinks: PriorityChildLink[] = [];

	for (const edge of context.connectedEdgesByNode.get(nodeId) ?? []) {
		const nextNodeId = getOtherEdgeNodeId(edge, nodeId);

		if (!nextNodeId || seenNodeIds.has(nextNodeId) || !canFollowPriorityBranchEdge(edge, context, nodeId)) {
			continue;
		}

		childLinks.push({ nodeId: nextNodeId, edge });
	}

	return childLinks;
}

function getPriorityBranchRank(nodeId: string, context: PriorityPathContext, seenNodeIds: Set<string>): PriorityBranchRank {
	const node = context.nodesById.get(nodeId);

	if (!node || seenNodeIds.has(nodeId)) {
		return { priorityOrder: null, progressDepth: null, closureDepth: null, longestLength: 0, isComplete: true };
	}

	if (node.data.completed) {
		return { priorityOrder: null, progressDepth: null, closureDepth: null, longestLength: 0, isComplete: true };
	}

	const nextSeenNodeIds = new Set(seenNodeIds);
	nextSeenNodeIds.add(nodeId);
	let priorityOrder = context.priorityNodeOrders.get(nodeId) ?? null;
	let progressDepth: number | null = null;
	let closureDepth: number | null = null;
	let longestChildLength = 0;
	let hasChild = false;
	let hasIncompleteChild = false;

	for (const childLink of getPriorityChildLinks(nodeId, context, nextSeenNodeIds)) {
		const childNode = context.nodesById.get(childLink.nodeId);
		const childRank = getPriorityBranchRank(childLink.nodeId, context, nextSeenNodeIds);
		hasChild = true;

		if (childNode?.data.completed || childRank.progressDepth !== null) {
			progressDepth = 0;
		}

		if (!childRank.isComplete && childRank.priorityOrder !== null && (priorityOrder === null || childRank.priorityOrder < priorityOrder)) {
			priorityOrder = childRank.priorityOrder;
		}

		if (!childRank.isComplete) {
			hasIncompleteChild = true;
			longestChildLength = Math.max(longestChildLength, childRank.longestLength);
			closureDepth = getLowerClosureDepth(
				closureDepth,
				childRank.closureDepth === null ? null : childRank.closureDepth + 1
			);
		}
	}

	return {
		priorityOrder,
		progressDepth,
		closureDepth: hasChild && !hasIncompleteChild ? 0 : closureDepth,
		longestLength: 1 + longestChildLength,
		isComplete: false
	};
}

function isBetterPriorityBranchRank(nextRank: PriorityBranchRank, currentRank: PriorityBranchRank | null): boolean {
	if (nextRank.isComplete) {
		return false;
	}

	if (!currentRank || currentRank.isComplete) {
		return true;
	}

	if (nextRank.progressDepth !== null || currentRank.progressDepth !== null) {
		if (nextRank.progressDepth === null) {
			return false;
		}

		if (currentRank.progressDepth === null) {
			return true;
		}

		if (nextRank.progressDepth !== currentRank.progressDepth) {
			return nextRank.progressDepth < currentRank.progressDepth;
		}
	}

	if (nextRank.priorityOrder !== null || currentRank.priorityOrder !== null) {
		if (nextRank.priorityOrder === null) {
			return false;
		}

		if (currentRank.priorityOrder === null) {
			return true;
		}

		if (nextRank.priorityOrder !== currentRank.priorityOrder) {
			return nextRank.priorityOrder < currentRank.priorityOrder;
		}
	}

	if (nextRank.closureDepth !== null || currentRank.closureDepth !== null) {
		if (nextRank.closureDepth === null) {
			return false;
		}

		if (currentRank.closureDepth === null) {
			return true;
		}

		if (nextRank.closureDepth !== currentRank.closureDepth) {
			return nextRank.closureDepth < currentRank.closureDepth;
		}
	}

	return nextRank.longestLength > currentRank.longestLength;
}

function getLowerClosureDepth(currentDepth: number | null, nextDepth: number | null): number | null {
	if (nextDepth === null) {
		return currentDepth;
	}

	if (currentDepth === null) {
		return nextDepth;
	}

	return Math.min(currentDepth, nextDepth);
}

function canFollowPriorityBranchEdge(edge: Edge, context: PriorityPathContext, fromNodeId: string): boolean {
	const nextNodeId = getOtherEdgeNodeId(edge, fromNodeId);

	if (!nextNodeId || nextNodeId === context.goalId) {
		return false;
	}

	return !context.directNodeIds.has(nextNodeId);
}

function getOtherEdgeNodeId(edge: Edge, nodeId: string): string | null {
	if (edge.source === nodeId) {
		return edge.target;
	}

	if (edge.target === nodeId) {
		return edge.source;
	}

	return null;
}

function filterBoardToPriorityPath(board: TechTreeBoard, priorityPathState: PriorityPathState): TechTreeBoard {
	if (!priorityPathState.hasActivePath) {
		return board;
	}

	return {
		...board,
		nodes: board.nodes.filter((node) => priorityPathState.nodeIds.has(node.id)),
		edges: board.edges.filter((edge) => priorityPathState.visibleEdgeIds.has(getBaseEdgeId(edge.id)))
	};
}

function getBaseEdgeId(edgeId: string): string {
	const questPrefix = "quest-";
	return edgeId.startsWith(questPrefix) ? edgeId.slice(questPrefix.length) : edgeId;
}

function isUndoShortcut(event: KeyboardEvent): boolean {
	return (event.ctrlKey || event.metaKey)
		&& !event.altKey
		&& !event.shiftKey
		&& event.key.toLowerCase() === "z";
}

function isRedoShortcut(event: KeyboardEvent): boolean {
	const key = event.key.toLowerCase();

	return (event.ctrlKey || event.metaKey)
		&& !event.altKey
		&& (key === "y" || (event.shiftKey && key === "z"));
}

function isAltPlacementShortcut(event: KeyboardEvent): boolean {
	return event.key === "Alt"
		&& !event.repeat
		&& !event.ctrlKey
		&& !event.metaKey
		&& !event.shiftKey;
}

function isPlacementPreviewNodeChange(change: NodeChange<TechTreeNode>): boolean {
	if ("id" in change) {
		return change.id === PLACEMENT_PREVIEW_NODE_ID;
	}

	return change.type === "add" && change.item.id === PLACEMENT_PREVIEW_NODE_ID;
}

function isTransientNodePositionChange(changes: NodeChange<TechTreeNode>[]): boolean {
	return changes.length > 0 && changes.every((change) => change.type === "position" && change.dragging === true);
}

function isTransientNodeDimensionChange(changes: NodeChange<TechTreeNode>[]): boolean {
	return changes.length > 0 && changes.every((change) => change.type === "dimensions" && "resizing" in change && change.resizing === true);
}

function isNodeLayoutOnlyChange(changes: NodeChange<TechTreeNode>[]): boolean {
	return changes.length > 0 && changes.every((change) => change.type === "position" || change.type === "dimensions");
}

function shouldIgnoreRightDragSelectionTarget(target: EventTarget | null): boolean {
	return target instanceof HTMLElement && Boolean(target.closest(
		".tech-tree-pane-menu, .tech-tree-mode-toggle, .tech-tree-board-toolbar, .tech-tree-viewport-controls, .tech-tree-edge-toolbar, .react-flow__controls, .tech-tree-node__priority, .tech-tree-node__done"
	));
}

function shouldIgnoreNodePlacementTarget(target: EventTarget | null): boolean {
	return target instanceof HTMLElement && Boolean(target.closest(
		".tech-tree-pane-menu, .tech-tree-mode-toggle, .tech-tree-board-toolbar, .tech-tree-viewport-controls, .tech-tree-edge-toolbar, .react-flow__controls, button, input, select, textarea"
	));
}

function shouldIgnoreAltPlacementTarget(target: EventTarget | null): boolean {
	return target instanceof HTMLElement && Boolean(target.closest(
		".tech-tree-pane-menu, .tech-tree-mode-toggle, .tech-tree-board-toolbar, .tech-tree-viewport-controls, .tech-tree-edge-toolbar, .react-flow__controls, button, input, select, textarea"
	));
}

function isEdgeSliceTarget(target: EventTarget | null): boolean {
	return target instanceof Element && Boolean(target.closest(
		".react-flow__edgeupdater, .react-flow__edge-path, .react-flow__edge-interaction"
	));
}

function getSlicedEdgeId(target: EventTarget | null): string | null {
	if (!(target instanceof Element)) {
		return null;
	}

	return target.closest(".react-flow__edge")?.getAttribute("data-id")
		?? target.closest(".react-flow__edge-toolbar")?.getAttribute("data-id")
		?? null;
}

function shouldIgnoreBoardShortcutTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}

	return target.isContentEditable || Boolean(target.closest("input, select, textarea, [contenteditable='true']"));
}

function canDeleteNodeFromBoard(board: TechTreeBoard, node: TechTreeNode): boolean {
	if (node.data.priority === "goal") {
		return false;
	}

	if (node.data.completed) {
		return true;
	}

	const nodesById = new Map(board.nodes.map((candidate) => [candidate.id, candidate]));

	return board.edges
		.filter((edge) => edge.source === node.id || edge.target === node.id)
		.every((edge) => {
			const neighborId = edge.source === node.id ? edge.target : edge.source;
			return nodesById.get(neighborId)?.data.completed !== true;
		});
}

function addNodeWithSelectedLinks(board: TechTreeBoard, newNode: TechTreeNode): Pick<TechTreeBoard, "nodes" | "edges"> {
	const selectedSourceNodes = board.nodes.filter((node) => node.selected);
	const nextNodes = [...board.nodes, newNode];
	let nextEdges = [...board.edges];

	if (selectedSourceNodes.length < 1 || selectedSourceNodes.length > 2) {
		return {
			nodes: nextNodes,
			edges: nextEdges
		};
	}

	for (const sourceNode of selectedSourceNodes) {
		const edge = normalizeEdgeForNodes(nextNodes, {
			id: createEdgeId({
				source: sourceNode.id,
				target: newNode.id,
				sourceHandle: null,
				targetHandle: null
			}),
			source: sourceNode.id,
			target: newNode.id,
			sourceHandle: null,
			targetHandle: null,
			type: "techTreeEdge",
			markerEnd: {
				type: MarkerType.ArrowClosed
			},
			className: "tech-tree-edge"
		});

		if (!isAllowedConnectionForNodes(nextNodes, edge) || nextEdges.some((existingEdge) => isSameConnection(existingEdge, edge))) {
			continue;
		}

		nextEdges = addEdge(edge, nextEdges);
	}

	return {
		nodes: nextNodes,
		edges: nextEdges
	};
}

function getQuestViewDisabledMessage(reason: string | null): string | null {
	if (!reason) {
		return null;
	}

	const normalized = reason.toLowerCase();

	if (normalized.includes("necessary") && normalized.includes("path")) {
		return "necessary node(s) must be linked to goal";
	}

	if (normalized.includes("link") && normalized.includes("goal")) {
		return "necessary node(s) must be linked to goal";
	}

	if (normalized.includes("necessary")) {
		return "add at least one necessary node";
	}

	if (normalized.includes("goal")) {
		return "add a goal node";
	}

	return reason;
}

function isShellActiveForPlacement(container: HTMLElement | null, clientPosition: ClientPosition | null): boolean {
	if (!container) {
		return false;
	}

	const activeElement = document.activeElement;

	if (activeElement && container.contains(activeElement)) {
		return true;
	}

	if (!clientPosition) {
		return false;
	}

	const rect = container.getBoundingClientRect();

	return clientPosition.x >= rect.left
		&& clientPosition.x <= rect.right
		&& clientPosition.y >= rect.top
		&& clientPosition.y <= rect.bottom;
}

function getShellCenterClientPosition(container: HTMLElement | null): ClientPosition {
	const rect = container?.getBoundingClientRect();

	if (!rect) {
		return {
			x: window.innerWidth / 2,
			y: window.innerHeight / 2
		};
	}

	return {
		x: rect.left + rect.width / 2,
		y: rect.top + rect.height / 2
	};
}

function getPlacementFlowPosition(clientPosition: ClientPosition, reactFlow: ReactFlowInstance<TechTreeNode, Edge>): XYPosition {
	const zoom = reactFlow.getZoom();

	return reactFlow.screenToFlowPosition({
		x: clientPosition.x - (MIN_NODE_WIDTH * zoom) / 2,
		y: clientPosition.y - (MIN_NODE_HEIGHT * zoom) / 2
	}, {
		snapToGrid: true,
		snapGrid: [20, 20]
	});
}

function createPlacementPreviewNode(position: XYPosition): TechTreeNode {
	const node = createNode(position, {
		...DEFAULT_NEW_NODE_OPTIONS,
		text: "New note\n\nWhat must be true before this works?"
	});

	return {
		...node,
		id: PLACEMENT_PREVIEW_NODE_ID,
		selected: false,
		dragging: false,
		draggable: false,
		selectable: false,
		connectable: false,
		deletable: false,
		focusable: false,
		zIndex: 10000,
		width: MIN_NODE_WIDTH,
		height: MIN_NODE_HEIGHT,
		measured: {
			...node.measured,
			width: MIN_NODE_WIDTH,
			height: MIN_NODE_HEIGHT
		},
		style: {
			...node.style,
			width: MIN_NODE_WIDTH,
			height: MIN_NODE_HEIGHT,
			pointerEvents: "none"
		},
		data: {
			...node.data,
			isPlacementPreview: true,
			onTextChange: undefined,
			onCompletedChange: undefined,
			onPriorityChange: undefined
		}
	};
}

function createEditingViewBoard(board: TechTreeBoard): TechTreeBoard {
	return {
		...board,
		nodes: board.nodes.map((node) => {
			const completed = Boolean(node.data.completed);

			return {
				...node,
				data: {
					...node.data,
					status: completed ? "done" : "open",
					statusKind: completed ? "done" : "open",
					locked: false,
					progressState: completed ? "done" : node.data.progressState,
					isQuestView: false
				}
			};
		})
	};
}

function createQuestViewBoard(board: TechTreeBoard, mirrorBounds: HorizontalMirrorBounds): TechTreeBoard {
	const questBoard = applyNodeState({
		...board,
		nodes: mirrorNodesHorizontally(board.nodes, mirrorBounds).map((node) => ({
			...node,
			selected: false,
			dragging: false,
			data: {
				...node.data,
				isQuestView: true
			}
		})),
		edges: board.edges.map(reverseEdgeForQuestView)
	}, {
		lockGoalNodes: false,
		persistStatus: false
	});

	return unlockGoalConnectedQuestNodes(questBoard, board);
}

function unlockGoalConnectedQuestNodes(questBoard: TechTreeBoard, sourceBoard: TechTreeBoard): TechTreeBoard {
	const goalConnectedNodeIds = getGoalConnectedNodeIds(sourceBoard);

	if (goalConnectedNodeIds.size === 0) {
		return questBoard;
	}

	return {
		...questBoard,
		nodes: questBoard.nodes.map((node) => {
			if (!goalConnectedNodeIds.has(node.id)) {
				return node;
			}

			const completed = Boolean(node.data.completed);

			return {
				...node,
				data: {
					...node.data,
					status: completed ? "done" : "open",
					statusKind: completed ? "done" : "open",
					locked: false,
					progressState: completed ? "done" : node.data.progressState
				}
			};
		})
	};
}

function getGoalConnectedNodeIds(board: TechTreeBoard): Set<string> {
	const goalNode = board.nodes.find((node) => node.data.priority === "goal");
	const connectedNodeIds = new Set<string>();

	if (!goalNode) {
		return connectedNodeIds;
	}

	for (const edge of board.edges) {
		if (edge.source === goalNode.id) {
			connectedNodeIds.add(edge.target);
		}

		if (edge.target === goalNode.id) {
			connectedNodeIds.add(edge.source);
		}
	}

	return connectedNodeIds;
}

function getHorizontalMirrorBounds(nodes: TechTreeNode[]): HorizontalMirrorBounds {
	if (nodes.length === 0) {
		return { leftEdge: 0, rightEdge: 0 };
	}

	return {
		leftEdge: Math.min(...nodes.map((node) => node.position.x)),
		rightEdge: Math.max(...nodes.map((node) => node.position.x + getMinimumNodeWidth(node)))
	};
}

function mirrorNodesHorizontally(nodes: TechTreeNode[], mirrorBounds: HorizontalMirrorBounds): TechTreeNode[] {
	return nodes.map((node) => ({
		...node,
		position: getMirroredNodePosition(node, node.position, mirrorBounds)
	}));
}

function mergeQuestViewNodePositions(nodes: TechTreeNode[], displayNodes: TechTreeNode[], mirrorBounds: HorizontalMirrorBounds): TechTreeNode[] {
	const displayNodesById = new Map(displayNodes.map((node) => [node.id, node]));

	return nodes.map((node) => {
		const displayNode = displayNodesById.get(node.id);

		if (!displayNode) {
			return node;
		}

		return {
			...node,
			position: getMirroredNodePosition(node, displayNode.position, mirrorBounds)
		};
	});
}

function getMirroredNodePosition(node: TechTreeNode, position: TechTreeNode["position"], mirrorBounds: HorizontalMirrorBounds): TechTreeNode["position"] {
	return {
		...position,
		x: mirrorBounds.leftEdge + mirrorBounds.rightEdge - position.x - getMinimumNodeWidth(node)
	};
}

function reverseEdgeForQuestView(edge: Edge): Edge {
	return {
		...edge,
		id: `quest-${edge.id}`,
		source: edge.target,
		target: edge.source,
		sourceHandle: null,
		targetHandle: null,
		selected: false
	};
}

function getQuestViewValidation(board: TechTreeBoard): QuestViewValidation {
	const goalNode = board.nodes.find((node) => node.data.priority === "goal");

	if (!goalNode) {
		return { canEnter: false, reason: "Add a goal node before quest view." };
	}

	const necessaryNodeIds = new Set(board.nodes
		.filter((node) => node.data.priority === "necessary")
		.map((node) => node.id));

	if (necessaryNodeIds.size === 0) {
		return { canEnter: false, reason: "Add a necessary node before quest view." };
	}

	const goalHasNecessaryLink = board.edges.some((edge) => (
		(edge.source === goalNode.id && necessaryNodeIds.has(edge.target))
		|| (edge.target === goalNode.id && necessaryNodeIds.has(edge.source))
	));

	if (!goalHasNecessaryLink) {
		return { canEnter: false, reason: "Link the goal to a necessary node before quest view." };
	}

	const questOutgoingByNode = new Map<string, string[]>();

	for (const edge of board.edges) {
		const outgoing = questOutgoingByNode.get(edge.target) ?? [];
		outgoing.push(edge.source);
		questOutgoingByNode.set(edge.target, outgoing);
	}

	for (const necessaryNodeId of necessaryNodeIds) {
		if (!canReachNode(necessaryNodeId, goalNode.id, questOutgoingByNode)) {
			return { canEnter: false, reason: "Every necessary node needs a path to the goal before quest view." };
		}
	}

	return { canEnter: true, reason: null };
}

function canReachNode(sourceId: string, targetId: string, outgoingByNode: Map<string, string[]>): boolean {
	const pending = [sourceId];
	const seen = new Set<string>();

	while (pending.length > 0) {
		const nodeId = pending.pop();

		if (!nodeId || seen.has(nodeId)) {
			continue;
		}

		if (nodeId === targetId) {
			return true;
		}

		seen.add(nodeId);
		pending.push(...(outgoingByNode.get(nodeId) ?? []));
	}

	return false;
}

function GripIcon({ className }: { className?: string }) {
	return (
		<svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true">
			<path
				fill="currentColor"
				d="M5 3h2v2H5zm0 4h2v2H5zm0 4h2v2H5zm4-8h2v2H9zm0 4h2v2H9zm0 4h2v2H9z"
			/>
		</svg>
	);
}

const nodeTypes: NodeTypes = {
	techNode: TechNode
};

const edgeTypes: EdgeTypes = {
	techTreeEdge: TechTreeEdge
};

function TechTreeEdge({
	id,
	sourceX,
	sourceY,
	targetX,
	targetY,
	sourcePosition,
	targetPosition,
	markerEnd,
	style,
	selected,
	data,
	interactionWidth
}: EdgeProps<Edge<TechTreeEdgeData>>) {
	const [edgePath, labelX, labelY] = data?.isStraight
		? getStraightPath({
			sourceX,
			sourceY,
			targetX,
			targetY
		})
		: getSmoothStepPath({
			sourceX,
			sourceY,
			sourcePosition,
			targetX,
			targetY,
			targetPosition,
			borderRadius: 28,
			offset: 24
		});

	return (
		<>
			<BaseEdge
				id={id}
				path={edgePath}
				markerEnd={markerEnd}
				style={style}
				interactionWidth={interactionWidth ?? 28}
			/>
			<EdgeToolbar edgeId={id} x={labelX} y={labelY} isVisible={selected && data?.showToolbar === true && !data?.isQuestView}>
				<div className="tech-tree-edge-toolbar nodrag nowheel">
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							data?.onReverse?.(id);
						}}
					>
						Reverse
					</button>
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation();
							data?.onDelete?.(id);
						}}
					>
						Remove
					</button>
				</div>
			</EdgeToolbar>
		</>
	);
}

function createEdgeId(connection: Connection): string {
	return `edge-${connection.source}-${connection.target}-${Date.now().toString(36)}`;
}

function createDroppedConnectionEdge(sourceNode: TechTreeNode, newNode: TechTreeNode, sourceHandleId: string | null | undefined): Edge {
	const sourceHandle = normalizeHandleId(sourceHandleId, "handle-right");
	const forwardEdge: Edge = {
		id: createEdgeId({
			source: sourceNode.id,
			target: newNode.id,
			sourceHandle,
			targetHandle: null
		}),
		source: sourceNode.id,
		target: newNode.id,
		sourceHandle,
		targetHandle: null,
		type: "techTreeEdge",
		markerEnd: {
			type: MarkerType.ArrowClosed
		},
		className: "tech-tree-edge"
	};

	if (isAllowedPriorityEdge(sourceNode, newNode)) {
		return forwardEdge;
	}

	if (isAllowedPriorityEdge(newNode, sourceNode)) {
		return {
			...forwardEdge,
			id: createEdgeId({
				source: newNode.id,
				target: sourceNode.id,
				sourceHandle: null,
				targetHandle: sourceHandle
			}),
			source: newNode.id,
			target: sourceNode.id,
			sourceHandle: null,
			targetHandle: sourceHandle
		};
	}

	return forwardEdge;
}

function normalizeEdgeForNodes(nodes: TechTreeNode[], edge: Edge): Edge {
	const source = nodes.find((node) => node.id === edge.source);
	const target = nodes.find((node) => node.id === edge.target);

	if (!source || !target) {
		return {
			...edge,
			sourceHandle: normalizeHandleId(edge.sourceHandle, "handle-right"),
			targetHandle: normalizeHandleId(edge.targetHandle, "handle-left")
		};
	}

	const edgeHandles = getEdgeHandles(source, target, edge);

	return {
		...edge,
		source: source.id,
		target: target.id,
		sourceHandle: edgeHandles.sourceHandle,
		targetHandle: edgeHandles.targetHandle
	};
}

function getEventClientPosition(event: MouseEvent | TouchEvent | React.MouseEvent<Element, MouseEvent>): ClientPosition | null {
	if ("changedTouches" in event) {
		const touch = event.changedTouches[0];

		return touch ? { x: touch.clientX, y: touch.clientY } : null;
	}

	return {
		x: event.clientX,
		y: event.clientY
	};
}

function getLocalMenuPosition(
	clientPosition: ClientPosition,
	container: HTMLElement | null,
	offset: ClientPosition
): ClientPosition {
	const rect = container?.getBoundingClientRect();

	return {
		x: clientPosition.x - (rect?.left ?? 0) + offset.x,
		y: clientPosition.y - (rect?.top ?? 0) + offset.y
	};
}

function normalizeHandleId(handleId: string | null | undefined, fallback: string): string {
	if (!handleId || handleId === "out") {
		return fallback;
	}

	if (handleId === "in") {
		return "handle-left";
	}

	const side = handleId.split("-").pop();

	return side === "top" || side === "right" || side === "bottom" || side === "left"
		? `handle-${side}`
		: fallback;
}

function getEdgeClassName(source: TechTreeNode | undefined, target: TechTreeNode | undefined, isQuestView: boolean): string {
	const sourceCompleted = Boolean(source?.data.completed);
	const targetCompleted = Boolean(target?.data.completed);
	const sourceGoal = source?.data.priority === "goal";
	const sourceNecessary = source?.data.priority === "necessary";
	const sourceQuest = source?.data.priority === "quest";
	const sourceMediumImpact = source?.data.priority === "medium impact";
	const targetNecessary = target?.data.priority === "necessary";
	const targetGoal = target?.data.priority === "goal";
	const targetQuest = target?.data.priority === "quest";
	const targetMediumImpact = target?.data.priority === "medium impact";
	const targetLocked = Boolean(target?.data.locked);
	const targetInProgress = !targetCompleted && !targetLocked && target?.data.progressState === "partial";
	const className: string[] = [EDGE_CLASSES.base];

	if ((sourceQuest && targetGoal) || (sourceGoal && targetQuest)) {
		const questEndpointCompleted = sourceQuest ? sourceCompleted : targetCompleted;
		className.push(questEndpointCompleted ? EDGE_CLASSES.questDoneToDone : EDGE_CLASSES.questGoalPath);
		return className.join(" ");
	}

	if (sourceQuest && targetQuest) {
		className.push(sourceCompleted && targetCompleted ? EDGE_CLASSES.questDoneToDone : EDGE_CLASSES.questPath);
		return className.join(" ");
	}

	if ((sourceQuest && targetMediumImpact) || (sourceMediumImpact && targetQuest)) {
		if (sourceCompleted && targetCompleted) {
			className.push(EDGE_CLASSES.questMediumDoneToDone);
			return className.join(" ");
		}

		if (sourceCompleted && !targetCompleted) {
			className.push(EDGE_CLASSES.questMediumDoneToUndone);
			return className.join(" ");
		}

		if (!sourceCompleted && targetCompleted) {
			className.push(EDGE_CLASSES.questMediumUndoneToDone);
			return className.join(" ");
		}

		className.push(EDGE_CLASSES.questMediumPath);
		return className.join(" ");
	}

	if (sourceNecessary && targetCompleted && (targetNecessary || targetGoal || targetMediumImpact)) {
		className.push(EDGE_CLASSES.necessaryComplete);
		return className.join(" ");
	}

	if (sourceCompleted && targetCompleted) {
		className.push(EDGE_CLASSES.complete);
		return className.join(" ");
	}

	if (sourceCompleted && !targetCompleted) {
		className.push(EDGE_CLASSES.doneToUndone);
		return className.join(" ");
	}

	if (!sourceCompleted && targetCompleted) {
		className.push(EDGE_CLASSES.undoneToDone);
		return className.join(" ");
	}

	if (sourceNecessary && targetNecessary) {
		className.push(EDGE_CLASSES.necessaryChain);
		return className.join(" ");
	}

	if (sourceNecessary && targetGoal) {
		className.push(EDGE_CLASSES.necessaryPath);
		return className.join(" ");
	}

	if (targetNecessary && (sourceGoal || sourceNecessary)) {
		className.push(EDGE_CLASSES.necessaryPath);
		return className.join(" ");
	}

	if (targetInProgress) {
		className.push(EDGE_CLASSES.inProgress);
		return className.join(" ");
	}

	if (targetQuest) {
		className.push(targetLocked ? EDGE_CLASSES.questLockedPath : EDGE_CLASSES.questPath);
	}

	return className.join(" ");
}

function getEdgeMarkerColor(className: string): string {
	if (hasEdgeClass(className, EDGE_CLASSES.priorityPath)) {
		return EDGE_MARKER_COLORS.progress;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.necessaryComplete)) {
		return EDGE_MARKER_COLORS.done;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.doneToUndone)) {
		return EDGE_MARKER_COLORS.muted;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.undoneToDone)) {
		return EDGE_MARKER_COLORS.muted;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.questActivePath)) {
		return EDGE_MARKER_COLORS.progress;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.questGoalPath)) {
		return EDGE_MARKER_COLORS.muted;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.questDoneToDone)) {
		return EDGE_MARKER_COLORS.quest;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.questDoneToUndone)) {
		return EDGE_MARKER_COLORS.muted;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.questMediumDoneToDone)) {
		return EDGE_MARKER_COLORS.done;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.questMediumDoneToUndone)) {
		return EDGE_MARKER_COLORS.progress;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.questMediumUndoneToDone)) {
		return EDGE_MARKER_COLORS.done;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.questMediumPath)) {
		return EDGE_MARKER_COLORS.progress;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.questLockedPath)) {
		return EDGE_MARKER_COLORS.muted;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.questPath)) {
		return EDGE_MARKER_COLORS.muted;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.necessaryChain)) {
		return EDGE_MARKER_COLORS.muted;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.necessaryPath)) {
		return EDGE_MARKER_COLORS.muted;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.complete)) {
		return EDGE_MARKER_COLORS.done;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.inProgress)) {
		return EDGE_MARKER_COLORS.muted;
	}

	return EDGE_MARKER_COLORS.default;
}

function isStraightQuestLine(className: string): boolean {
	return hasEdgeClass(className, EDGE_CLASSES.questPath)
		|| hasEdgeClass(className, EDGE_CLASSES.questGoalPath)
		|| hasEdgeClass(className, EDGE_CLASSES.questActivePath)
		|| hasEdgeClass(className, EDGE_CLASSES.questDoneToDone)
		|| hasEdgeClass(className, EDGE_CLASSES.questDoneToUndone)
		|| hasEdgeClass(className, EDGE_CLASSES.questLockedPath);
}

function getEdgeZIndex(className: string): number {
	if (hasEdgeClass(className, EDGE_CLASSES.priorityPath)) {
		return 7000;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.necessaryComplete)) {
		return 6000;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.necessaryPath)) {
		return 5000;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.necessaryChain)) {
		return 4000;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.questLockedPath)) {
		return 20;
	}

	if (
		hasEdgeClass(className, EDGE_CLASSES.questActivePath)
		|| hasEdgeClass(className, EDGE_CLASSES.questDoneToDone)
		|| hasEdgeClass(className, EDGE_CLASSES.questDoneToUndone)
		|| hasEdgeClass(className, EDGE_CLASSES.questGoalPath)
		|| hasEdgeClass(className, EDGE_CLASSES.questMediumDoneToDone)
		|| hasEdgeClass(className, EDGE_CLASSES.questMediumDoneToUndone)
		|| hasEdgeClass(className, EDGE_CLASSES.questMediumUndoneToDone)
		|| hasEdgeClass(className, EDGE_CLASSES.questMediumPath)
		|| hasEdgeClass(className, EDGE_CLASSES.questPath)
	) {
		return 20;
	}

	if (
		hasEdgeClass(className, EDGE_CLASSES.complete)
		|| hasEdgeClass(className, EDGE_CLASSES.inProgress)
		|| hasEdgeClass(className, EDGE_CLASSES.doneToUndone)
		|| hasEdgeClass(className, EDGE_CLASSES.undoneToDone)
	) {
		return 10;
	}

	return 0;
}

function hasEdgeClass(className: string, classToken: string): boolean {
	return className.split(/\s+/).includes(classToken);
}

function isAllowedConnectionForNodes(nodes: TechTreeNode[], connection: ConnectionLike): boolean {
	const source = nodes.find((node) => node.id === connection.source);
	const target = nodes.find((node) => node.id === connection.target);

	return Boolean(
		source
		&& target
		&& source.id !== target.id
		&& isAllowedPriorityEdge(source, target)
	);
}

function isAllowedConnectionForNodeMap(nodesById: Map<string, TechTreeNode>, connection: ConnectionLike): boolean {
	const source = nodesById.get(connection.source);
	const target = nodesById.get(connection.target);

	return Boolean(
		source
		&& target
		&& source.id !== target.id
		&& isAllowedPriorityEdge(source, target)
	);
}

function isAllowedDisplayEdge(source: TechTreeNode, target: TechTreeNode, isQuestView: boolean): boolean {
	return Boolean(
		source
		&& target
		&& source.id !== target.id
		&& (isQuestView || isAllowedPriorityEdge(source, target))
	);
}

function isAllowedEdgeForNodes(nodes: TechTreeNode[], edge: ConnectionLike): boolean {
	const source = nodes.find((node) => node.id === edge.source);
	const target = nodes.find((node) => node.id === edge.target);

	return Boolean(source && target && source.id !== target.id && isAllowedPriorityEdge(source, target));
}

function isAllowedPriorityEdge(source: TechTreeNode, target: TechTreeNode): boolean {
	const connectsMediumImpactToGoal = (
		(source.data.priority === "medium impact" && target.data.priority === "goal")
		|| (source.data.priority === "goal" && target.data.priority === "medium impact")
	);

	return target.data.priority !== "goal"
		&& !connectsMediumImpactToGoal
		&& !(source.data.priority === "quest" && target.data.priority === "necessary");
}

function getHorizontalHandles(source: TechTreeNode, target: TechTreeNode): { sourceHandle: string; targetHandle: string } {
	return target.position.x >= source.position.x
		? { sourceHandle: "handle-right", targetHandle: "handle-left" }
		: { sourceHandle: "handle-left", targetHandle: "handle-right" };
}

function getEdgeHandles(source: TechTreeNode, target: TechTreeNode, edge: ConnectionLike): { sourceHandle: string; targetHandle: string } {
	if (source.data.priority === "necessary" && target.data.priority === "necessary") {
		return getHorizontalHandles(source, target);
	}

	const directionalHandles = getDirectionalHandles(source, target);

	return {
		sourceHandle: normalizeHandleId(edge.sourceHandle, directionalHandles.sourceHandle),
		targetHandle: normalizeHandleId(edge.targetHandle, directionalHandles.targetHandle)
	};
}

function getDirectionalHandles(source: TechTreeNode, target: TechTreeNode): { sourceHandle: string; targetHandle: string } {
	const xDelta = target.position.x - source.position.x;
	const yDelta = target.position.y - source.position.y;

	if (Math.abs(xDelta) >= Math.abs(yDelta)) {
		return xDelta >= 0
			? { sourceHandle: "handle-right", targetHandle: "handle-left" }
			: { sourceHandle: "handle-left", targetHandle: "handle-right" };
	}

	return yDelta >= 0
		? { sourceHandle: "handle-bottom", targetHandle: "handle-top" }
		: { sourceHandle: "handle-top", targetHandle: "handle-bottom" };
}

function persistChangedNodeDimensions(nodes: TechTreeNode[], changes: NodeChange<TechTreeNode>[]): TechTreeNode[] {
	const changedDimensions = new Map<string, { width?: number; height?: number }>();

	for (const change of changes) {
		if (change.type === "dimensions" && change.dimensions) {
			changedDimensions.set(change.id, change.dimensions);
		}
	}

	if (changedDimensions.size === 0) {
		return nodes;
	}

	return nodes.map((node) => {
		const dimensions = changedDimensions.get(node.id);
		const width = getFiniteNumber(dimensions?.width) ?? getFiniteNumber(node.width) ?? getFiniteNumber(node.measured?.width);
		const height = getFiniteNumber(dimensions?.height) ?? getFiniteNumber(node.height) ?? getFiniteNumber(node.measured?.height);

		return {
			...node,
			width,
			height,
			measured: {
				...node.measured,
				width,
				height
			},
			style: {
				...node.style,
				...(width ? { width } : {}),
				...(height ? { height } : {})
			}
		};
	});
}

function mergeChangedNodesIntoBoard(boardNodes: TechTreeNode[], changedNodes: TechTreeNode[], changes: NodeChange<TechTreeNode>[]): TechTreeNode[] {
	const changedNodesById = new Map(changedNodes.map((node) => [node.id, node]));
	const removedNodeIds = new Set(changes
		.filter((change): change is NodeChange<TechTreeNode> & { id: string } => change.type === "remove" && "id" in change)
		.map((change) => change.id));
	const boardNodeIds = new Set(boardNodes.map((node) => node.id));
	const nextNodes = boardNodes
		.filter((node) => !removedNodeIds.has(node.id))
		.map((node) => changedNodesById.get(node.id) ?? node);

	for (const node of changedNodes) {
		if (!boardNodeIds.has(node.id) && !removedNodeIds.has(node.id)) {
			nextNodes.push(node);
		}
	}

	return nextNodes;
}

function isSameConnection(edge: Edge, connection: ConnectionLike): boolean {
	return edge.source === connection.source
		&& edge.target === connection.target
		&& normalizeHandleId(edge.sourceHandle, "handle-right") === normalizeHandleId(connection.sourceHandle, "handle-right")
		&& normalizeHandleId(edge.targetHandle, "handle-left") === normalizeHandleId(connection.targetHandle, "handle-left");
}

function getConnectionKey(connection: ConnectionLike): string {
	return `${connection.source}:${normalizeHandleId(connection.sourceHandle, "handle-right")}->${connection.target}:${normalizeHandleId(connection.targetHandle, "handle-left")}`;
}

function selectOnlyEdge(board: TechTreeBoard, edgeId: string): TechTreeBoard {
	return {
		...board,
		nodes: board.nodes.map((node) => ({
			...node,
			selected: false
		})),
		edges: board.edges.map((edge) => ({
			...edge,
			selected: edge.id === edgeId
		}))
	};
}

function getFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
