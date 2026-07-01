import type { Edge, Node } from "@xyflow/react";

export type TechTreePriority = "quest" | "medium impact" | "necessary" | "goal";
export type TechTreeStatusKind = "open" | "in-progress" | "blocked" | "done";
export type TechTreeProgressState = "none" | "partial" | "done";

export type TechTreeNodeData = Record<string, unknown> & {
	text: string;
	visibleText: string;
	title: string;
	priority: TechTreePriority;
	priorityOrder: number;
	status: string;
	statusKind: TechTreeStatusKind;
	completed: boolean;
	locked: boolean;
	hasCheckedNeighbor: boolean;
	hasQuestPrerequisite: boolean;
	progressState: TechTreeProgressState;
	questViewMode: boolean;
	boardPath: string | null;
	isQuestView?: boolean;
	isPriorityPathNode?: boolean;
	isPlacementPreview?: boolean;
	onTextChange?: (nodeId: string, text: string) => void;
	onCompletedChange?: (nodeId: string, completed: boolean) => void;
	onPriorityChange?: (nodeId: string, priority: TechTreePriority) => void;
	onPriorityOrderChange?: (nodeId: string, priorityOrder: number) => void;
	onOpenBoard?: (path: string) => void;
	hasOtherGoalNode?: boolean;
};

export type TechTreeNode = Node<TechTreeNodeData, "techNode">;

export type TechTreeBoard = {
	path: string;
	name: string;
	nodes: TechTreeNode[];
	edges: Edge[];
	stickyNote: TechTreeStickyNote;
	updatedAt: number;
};

export type TechTreeStickyNote = {
	text: string;
	x: number;
	y: number;
	isOpen: boolean;
};
