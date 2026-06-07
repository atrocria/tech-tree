import type { Edge, Node } from "@xyflow/react";

export type TechTreePriority = "quest" | "medium impact" | "necessary" | "goal";
export type TechTreeStatusKind = "open" | "in-progress" | "blocked" | "done";
export type TechTreeProgressState = "none" | "partial" | "done";

export type TechTreeNodeData = Record<string, unknown> & {
	text: string;
	visibleText: string;
	title: string;
	priority: TechTreePriority;
	status: string;
	statusKind: TechTreeStatusKind;
	completed: boolean;
	locked: boolean;
	hasCheckedNeighbor: boolean;
	hasQuestPrerequisite: boolean;
	progressState: TechTreeProgressState;
	isQuestView?: boolean;
	onTextChange?: (nodeId: string, text: string) => void;
	onCompletedChange?: (nodeId: string, completed: boolean) => void;
	onPriorityChange?: (nodeId: string, priority: TechTreePriority) => void;
	hasOtherGoalNode?: boolean;
};

export type TechTreeNode = Node<TechTreeNodeData, "techNode">;

export type TechTreeBoard = {
	path: string;
	name: string;
	nodes: TechTreeNode[];
	edges: Edge[];
	updatedAt: number;
};
