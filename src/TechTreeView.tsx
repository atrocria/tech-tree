import {
	addEdge,
	applyEdgeChanges,
	applyNodeChanges,
	Background,
	BaseEdge,
	ConnectionLineType,
	ConnectionMode,
	Controls,
	EdgeToolbar,
	getSmoothStepPath,
	getStraightPath,
	Handle,
	MarkerType,
	NodeResizer,
	Position,
	ReactFlow,
	ReactFlowProvider,
	reconnectEdge,
	useReactFlow,
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
	type NodeTypes
} from "@xyflow/react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { TechTreeManager, applyNodeState, createNode, updateNodeCompletionStatus, updateNodePriority, updateNodeVisibleText } from "./TechTreeManager";
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
	screenPosition: { x: number; y: number };
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
	onDelete?: (edgeId: string) => void;
	onReverse?: (edgeId: string) => void;
};

type QuestViewValidation = {
	canEnter: boolean;
	reason: string | null;
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
	done: "#22c55e"
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
const MIN_NODE_HEIGHT = 170;

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

function TechTreeCanvas({ boardPath, manager }: TechTreeAppProps) {
	const reactFlow = useReactFlow<TechTreeNode, Edge>();
	const [board, setBoard] = useState<TechTreeBoard | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [paneMenu, setPaneMenu] = useState<PaneMenuState | null>(null);
	const [isQuestView, setIsQuestView] = useState(false);
	const [questMirrorBounds, setQuestMirrorBounds] = useState<HorizontalMirrorBounds | null>(null);

	useEffect(() => {
		let disposed = false;
		const unsubscribe = manager.subscribe(boardPath, (nextBoard) => {
			if (!disposed) {
				setBoard(nextBoard);
			}
		});

		manager.loadBoard(boardPath)
			.then((nextBoard) => {
				if (!disposed) {
					setBoard(nextBoard);
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
	}, [boardPath, manager]);

	const persistBoard = useCallback(
		async (nextBoard: TechTreeBoard) => {
			const savedBoard = await manager.updateBoard(boardPath, nextBoard);
			setBoard(savedBoard);
		},
		[boardPath, manager]
	);

	const questViewValidation = useMemo(
		() => board ? getQuestViewValidation(board) : { canEnter: false, reason: "Open a tech tree board first." },
		[board]
	);

	const activeBoard = useMemo(
		() => {
			if (!board) {
				return null;
			}

			return isQuestView ? createQuestViewBoard(board, questMirrorBounds ?? getHorizontalMirrorBounds(board.nodes)) : createEditingViewBoard(board);
		},
		[board, isQuestView, questMirrorBounds]
	);

	useEffect(() => {
		if (isQuestView && !questViewValidation.canEnter) {
			setQuestMirrorBounds(null);
			setIsQuestView(false);
		}
	}, [isQuestView, questViewValidation.canEnter]);

	useEffect(() => {
		setPaneMenu(null);
		window.requestAnimationFrame(() => {
			void reactFlow.fitView({ padding: 0.18 });
		});
	}, [isQuestView, reactFlow]);

	const handleTextChange = useCallback(
		(nodeId: string, text: string) => {
			if (!board || isQuestView) {
				return;
			}

			const existingNode = board.nodes.find((node) => node.id === nodeId);

			if (!existingNode) {
				return;
			}

			void persistBoard({
				...board,
				nodes: board.nodes.map((node) => node.id === nodeId
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
		[board, isQuestView, persistBoard]
	);

	const handleCompletedChange = useCallback(
		(nodeId: string, completed: boolean) => {
			if (!board) {
				return;
			}

			const activeNode = activeBoard?.nodes.find((node) => node.id === nodeId);

			if (activeNode?.data.locked) {
				return;
			}

			void persistBoard({
				...board,
				nodes: board.nodes.map((node) => node.id === nodeId
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
		[activeBoard?.nodes, board, persistBoard]
	);

	const handlePriorityChange = useCallback(
		(nodeId: string, priority: TechTreePriority) => {
			if (!board || isQuestView) {
				return;
			}

			const existingNode = board.nodes.find((node) => node.id === nodeId);

			if (!existingNode) {
				return;
			}

			if (priority === "goal" && board.nodes.some((node) => node.id !== nodeId && node.data.priority === "goal")) {
				return;
			}

			void persistBoard({
				...board,
				nodes: board.nodes.map((node) => node.id === nodeId
					? {
						...node,
						data: {
							...node.data,
							text: updateNodePriority(node.data.text, priority)
						}
					}
					: node)
			});
		},
		[board, isQuestView, persistBoard]
	);

	const handleDeleteEdge = useCallback(
		(edgeId: string) => {
			if (!board || isQuestView) {
				return;
			}

			void persistBoard({
				...board,
				edges: board.edges.filter((edge) => edge.id !== edgeId)
			});
		},
		[board, isQuestView, persistBoard]
	);

	const handleReverseEdge = useCallback(
		(edgeId: string) => {
			if (!board || isQuestView) {
				return;
			}

			void persistBoard({
				...board,
				edges: board.edges.map((edge) => {
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

					return isAllowedEdgeForNodes(board.nodes, reversedEdge) ? reversedEdge : edge;
				})
			});
		},
		[board, isQuestView, persistBoard]
	);

	const flowNodes = useMemo(
		() => {
			if (!activeBoard) {
				return [];
			}

			return activeBoard.nodes.map((node) => {
				const locked = Boolean(node.data.locked);
				const isGoal = node.data.priority === "goal";
				const hasOtherGoalNode = activeBoard.nodes.some((candidate) => candidate.id !== node.id && candidate.data.priority === "goal");
				const width = getMinimumNodeWidth(node);
				const canEditStructure = !isQuestView && !locked;
				const canMoveNode = isQuestView || canEditStructure;

				return {
					...node,
					width,
					measured: {
						...node.measured,
						width
					},
					style: {
						...node.style,
						width
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
						hasOtherGoalNode,
						isQuestView
					}
				};
			});
		},
		[activeBoard, handleCompletedChange, handlePriorityChange, handleTextChange, isQuestView]
	);

	const flowEdges = useMemo(
		() => {
			const nodesById = new Map(flowNodes.map((node) => [node.id, node]));

			return activeBoard?.edges.flatMap((edge) => {
				const source = nodesById.get(edge.source);
				const target = nodesById.get(edge.target);

				if (!source || !target || !isAllowedDisplayEdgeForNodes(flowNodes, edge, isQuestView)) {
					return [];
				}

				const edgeHandles = getEdgeHandles(source, target, edge);
				const edgeClassName = getEdgeClassName(source, target, isQuestView);
				const edgeMarkerColor = getEdgeMarkerColor(edgeClassName);
				const isStraight = isStraightQuestLine(edgeClassName);

				return [{
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
						onDelete: handleDeleteEdge,
						onReverse: handleReverseEdge
					},
					className: edgeClassName,
					zIndex: getEdgeZIndex(edgeClassName)
				}];
			}) ?? [];
		},
		[activeBoard?.edges, flowNodes, handleDeleteEdge, handleReverseEdge, isQuestView]
	);

	const handleNodesChange = useCallback(
		(changes: NodeChange<TechTreeNode>[]) => {
			if (!board) {
				return;
			}

			if (isQuestView) {
				const questChanges = changes.filter((change) => change.type === "position");

				if (questChanges.length === 0) {
					return;
				}

				const mirrorBounds = questMirrorBounds ?? getHorizontalMirrorBounds(board.nodes);
				const nextDisplayNodes = applyNodeChanges(questChanges, flowNodes);

				void persistBoard({
					...board,
					nodes: mergeQuestViewNodePositions(board.nodes, nextDisplayNodes, mirrorBounds)
				});
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

			void persistBoard({
				...board,
				nodes: persistChangedNodeDimensions(applyNodeChanges(safeChanges, flowNodes), safeChanges)
			});
		},
		[board, flowNodes, isQuestView, persistBoard, questMirrorBounds]
	);

	const handleEdgesChange = useCallback(
		(changes: EdgeChange[]) => {
			if (!board || isQuestView) {
				return;
			}

			void persistBoard({
				...board,
				edges: applyEdgeChanges(changes, board.edges)
			});
		},
		[board, isQuestView, persistBoard]
	);

	const normalizeEdgeForBoard = useCallback(
		(edge: Edge): Edge => {
			if (!board) {
				return edge;
			}

			const source = board.nodes.find((node) => node.id === edge.source);
			const target = board.nodes.find((node) => node.id === edge.target);

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
	}, []);

	const isValidConnection = useCallback<IsValidConnection>(
		(connection) => Boolean(
			!isQuestView
			&& connection.source
			&& connection.target
			&& connection.source !== connection.target
			&& isAllowedConnectionForNodes(flowNodes, connection)
			&& !flowEdges.some((edge) => isSameConnection(edge, connection))
		),
		[flowEdges, flowNodes, isQuestView]
	);

	const handlePaneDoubleClick = useCallback(
		(event: React.MouseEvent) => {
			if (!board || isQuestView) {
				return;
			}

			const target = event.target;

			if (target instanceof HTMLElement && target.closest(".react-flow__node, .react-flow__controls, .react-flow__minimap")) {
				return;
			}

			const position = reactFlow.screenToFlowPosition({
				x: event.clientX,
				y: event.clientY
			});

			void persistBoard({
				...board,
				nodes: [...board.nodes, createNode(position)]
			});
		},
		[board, isQuestView, persistBoard, reactFlow]
	);

	const handlePaneContextMenu = useCallback(
		(event: MouseEvent | React.MouseEvent<Element, MouseEvent>) => {
			event.preventDefault();

			if (!board || isQuestView) {
				return;
			}

			const clientX = 'clientX' in event ? event.clientX : 0;
			const clientY = 'clientY' in event ? event.clientY : 0;

			setPaneMenu({
				flowPosition: reactFlow.screenToFlowPosition({
					x: clientX,
					y: clientY
				}),
				screenPosition: {
					x: clientX,
					y: clientY
				}
			});
		},
		[board, isQuestView, reactFlow]
	);

	const handleAddNodeFromMenu = useCallback(
		() => {
			if (!board || isQuestView || !paneMenu) {
				return;
			}

			void persistBoard({
				...board,
				nodes: [...board.nodes, createNode(paneMenu.flowPosition)]
			});
			setPaneMenu(null);
		},
		[board, isQuestView, paneMenu, persistBoard]
	);

	const handlePaneClick = useCallback(() => {
		setPaneMenu(null);
	}, []);

	const handleEdgeClick = useCallback(
		(event: React.MouseEvent, clickedEdge: Edge) => {
			if (!board || isQuestView) {
				return;
			}

			event.stopPropagation();
			setPaneMenu(null);
			void persistBoard({
				...selectOnlyEdge(board, clickedEdge.id)
			});
		},
		[board, isQuestView, persistBoard]
	);

	const handleEdgeContextMenu = useCallback(
		(event: React.MouseEvent, clickedEdge: Edge) => {
			event.preventDefault();
			event.stopPropagation();

			if (!board || isQuestView) {
				return;
			}

			setPaneMenu(null);
			void persistBoard({
				...selectOnlyEdge(board, clickedEdge.id)
			});
		},
		[board, isQuestView, persistBoard]
	);

	if (error) {
		return <div className="tech-tree-empty">{error}</div>;
	}

	if (!board) {
		return <div className="tech-tree-empty">Loading tech tree...</div>;
	}

	const isQuestToggleDisabled = !questViewValidation.canEnter && !isQuestView;

	return (
		<div className="tech-tree-shell" onDoubleClick={handlePaneDoubleClick}>
			<div className="tech-tree-mode-toggle nodrag nowheel">
				<label
					className={isQuestToggleDisabled ? "is-disabled" : ""}
					title={questViewValidation.reason ?? "go into quest view"}
				>
					<input
						type="checkbox"
						checked={isQuestView}
						disabled={isQuestToggleDisabled}
						onChange={(event) => {
							const nextValue = event.currentTarget.checked;

							if (nextValue && !questViewValidation.canEnter) {
								setQuestMirrorBounds(null);
								setIsQuestView(false);
								return;
							}

							setQuestMirrorBounds(nextValue && board ? getHorizontalMirrorBounds(board.nodes) : null);
							setIsQuestView(nextValue);
						}}
					/>
					<span>go into quest view</span>
				</label>
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
				onlyRenderVisibleElements
				snapToGrid
				snapGrid={[20, 20]}
				deleteKeyCode={null}
				onNodesChange={handleNodesChange}
				onEdgesChange={handleEdgesChange}
				onConnect={handleConnect}
				onReconnect={handleReconnect}
				onReconnectStart={handleReconnectStart}
				onReconnectEnd={handleReconnectEnd}
				onEdgeClick={handleEdgeClick}
				onEdgeContextMenu={handleEdgeContextMenu}
				onPaneClick={handlePaneClick}
				onPaneContextMenu={handlePaneContextMenu}
				isValidConnection={isValidConnection}
				connectionRadius={28}
				reconnectRadius={26}
				fitView
				fitViewOptions={{ padding: 0.18 }}
			>
				<Background />
				<Controls />
			</ReactFlow>
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
		</div>
	);
}

function TechNode({ id, data, selected }: NodeProps<TechTreeNode>) {
	const nodeData = data;
	const locked = Boolean(nodeData.locked);
	const isQuestView = Boolean(nodeData.isQuestView);
	const canEditNode = !isQuestView && !locked;
	const completed = Boolean(nodeData.completed);
	const hasCheckedNeighbor = Boolean(nodeData.hasCheckedNeighbor);
	const hasQuestPrerequisite = Boolean(nodeData.hasQuestPrerequisite);
	const priorityOptions = PRIORITY_OPTIONS.filter((option) => option.value !== "goal" || nodeData.priority === "goal" || !nodeData.hasOtherGoalNode);
	const nodeClassName = [
		"tech-tree-node",
		`is-status-${nodeData.statusKind}`,
		`is-progress-${nodeData.progressState}`,
		`is-priority-${nodeData.priority.replace(/\s+/g, "-")}`,
		locked ? "is-locked" : "is-unlocked",
		completed ? "is-completed" : "",
		hasCheckedNeighbor ? "has-checked-neighbor" : "",
		hasQuestPrerequisite ? "has-quest-prerequisite" : ""
	].filter(Boolean).join(" ");

	return (
		<div className={nodeClassName} aria-disabled={locked}>
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
						disabled={locked}
						onChange={(event) => {
							if (locked) {
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
		</div>
	);
}

function getMinimumNodeWidth(node: TechTreeNode): number {
	const width = typeof node.width === "number"
		? node.width
		: typeof node.measured?.width === "number"
			? node.measured.width
			: MIN_NODE_WIDTH;

	return Math.max(width, MIN_NODE_WIDTH);
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
	return applyNodeState({
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
			<EdgeToolbar edgeId={id} x={labelX} y={labelY} isVisible={selected && !data?.isQuestView}>
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
		className.push(EDGE_CLASSES.questGoalPath);
		return className.join(" ");
	}

	if (sourceQuest && targetQuest) {
		className.push(EDGE_CLASSES.questPath);
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

	if (sourceNecessary && targetNecessary && sourceCompleted && targetCompleted) {
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
	if (hasEdgeClass(className, EDGE_CLASSES.necessaryComplete)) {
		return EDGE_MARKER_COLORS.done;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.doneToUndone)) {
		return EDGE_MARKER_COLORS.progress;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.undoneToDone)) {
		return EDGE_MARKER_COLORS.done;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.questActivePath)) {
		return EDGE_MARKER_COLORS.progress;
	}

	if (hasEdgeClass(className, EDGE_CLASSES.questGoalPath)) {
		return EDGE_MARKER_COLORS.quest;
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
		return EDGE_MARKER_COLORS.quest;
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
		return EDGE_MARKER_COLORS.progress;
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
		&& !source.data.locked
		&& !target.data.locked
	);
}

function isAllowedDisplayEdgeForNodes(nodes: TechTreeNode[], edge: ConnectionLike, isQuestView: boolean): boolean {
	const source = nodes.find((node) => node.id === edge.source);
	const target = nodes.find((node) => node.id === edge.target);

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

function isSameConnection(edge: Edge, connection: ConnectionLike): boolean {
	return edge.source === connection.source
		&& edge.target === connection.target
		&& normalizeHandleId(edge.sourceHandle, "handle-right") === normalizeHandleId(connection.sourceHandle, "handle-right")
		&& normalizeHandleId(edge.targetHandle, "handle-left") === normalizeHandleId(connection.targetHandle, "handle-left");
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
