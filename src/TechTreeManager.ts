import { Notice, TFile, type App, type Plugin, type TFolder } from "obsidian";
import type { Edge, XYPosition } from "@xyflow/react";
import type { TechTreeBoard, TechTreeNode, TechTreePriority, TechTreeProgressState, TechTreeStatusKind, TechTreeStickyNote } from "./types";

type CanvasSide = "top" | "right" | "bottom" | "left";

type CanvasTextNode = Record<string, unknown> & {
	id: string;
	type: "text";
	x: number;
	y: number;
	width?: number;
	height?: number;
	text: string;
	color?: string;
};

type CanvasNode = CanvasTextNode | (Record<string, unknown> & {
	id: string;
	type: string;
});

type CanvasEdge = Record<string, unknown> & {
	id: string;
	fromNode: string;
	fromSide?: CanvasSide;
	toNode: string;
	toSide?: CanvasSide;
	label?: string;
	color?: string;
};

type CanvasFile = Record<string, unknown> & {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
};

type CanvasInspection = {
	mtime: number;
	isTechTree: boolean;
};

type TechTreeConnectionMetadata = {
	target: string;
	sourceSide: CanvasSide;
	targetSide: CanvasSide;
};

type BoardListener = (board: TechTreeBoard) => void;

type TechTreePluginData = Record<string, unknown> & {
	stickyNotes?: Record<string, Partial<TechTreeStickyNote> | undefined>;
};

export const DEFAULT_BOARD_NAME = "untitled tech-tree";
const BOARD_EXTENSION = ".canvas";
const LEGACY_BOARD_SUFFIX = "(metadata).canvas";
const DEFAULT_NODE_WIDTH = 320;
const DEFAULT_NODE_HEIGHT = 130;
const STICKY_NOTE_CANVAS_NODE_ID = "tech-tree-sticky-note";
const STICKY_NOTE_CANVAS_NODE_MARKER = "tech-tree sticky note";
const STICKY_NOTE_CANVAS_NODE_WIDTH = 320;
const STICKY_NOTE_CANVAS_NODE_HEIGHT = 180;
const STICKY_NOTE_CANVAS_NODE_GAP = 160;
const SAVE_DELAY_MS = 250;
const BOARD_FILE_INSPECTION_CONCURRENCY = 8;
const BOARD_PATH_METADATA_KEY = "board";
const CONNECTIONS_METADATA_KEY = "connections";
const QUEST_VIEW_METADATA_KEY = "quest view";
const PRIORITY_ORDER_METADATA_KEY = "priority order";
const MIN_PRIORITY_ORDER = 0;
const MAX_PRIORITY_ORDER = 10;
const DEFAULT_STICKY_NOTE: TechTreeStickyNote = {
	text: "",
	x: 24,
	y: 96,
	isOpen: false
};
const HIDDEN_METADATA_KEYS = new Set(["priority", PRIORITY_ORDER_METADATA_KEY, "status", BOARD_PATH_METADATA_KEY, CONNECTIONS_METADATA_KEY, QUEST_VIEW_METADATA_KEY]);
const ORDERED_METADATA_KEYS = ["priority", PRIORITY_ORDER_METADATA_KEY, BOARD_PATH_METADATA_KEY, CONNECTIONS_METADATA_KEY, "status", QUEST_VIEW_METADATA_KEY];
const METADATA_LINE_PATTERN = /^([a-z][\w -]*):\s*(.*)$/i;

type ParsedNodeText = Pick<TechTreeNode["data"], "title" | "visibleText" | "priority" | "priorityOrder" | "status" | "completed" | "questViewMode"> & {
	boardPath: string | null;
	connections: TechTreeConnectionMetadata[];
	partial: boolean;
	statusKind: TechTreeStatusKind;
};

type ApplyNodeStateOptions = {
	lockGoalNodes?: boolean;
	persistStatus?: boolean;
};

export type CreateTechTreeNodeOptions = {
	priority?: TechTreePriority;
	text?: string;
};

export class TechTreeManager {
	private static instance: TechTreeManager | null = null;
	private boards = new Map<string, TechTreeBoard>();
	private sourceCanvases = new Map<string, CanvasFile>();
	private knownTechTreePaths = new Set<string>();
	private canvasInspectionCache = new Map<string, CanvasInspection>();
	private listeners = new Map<string, Set<BoardListener>>();
	private saveTimers = new Map<string, number>();
	private pendingSaves = new Map<string, TechTreeBoard>();
	private savingPaths = new Set<string>();

	private constructor(
		private app: App,
		private plugin: Plugin
	) {}

	static getInstance(app: App, plugin: Plugin): TechTreeManager {
		if (!TechTreeManager.instance) {
			TechTreeManager.instance = new TechTreeManager(app, plugin);
		} else {
			TechTreeManager.instance.app = app;
			TechTreeManager.instance.plugin = plugin;
		}

		return TechTreeManager.instance;
	}

	async dispose(): Promise<void> {
		for (const timer of this.saveTimers.values()) {
			window.clearTimeout(timer);
		}

		this.saveTimers.clear();
		const pendingSaves = [...this.pendingSaves.entries()];
		this.pendingSaves.clear();

		await Promise.all(pendingSaves.map(async ([path, board]) => {
			try {
				await this.saveBoard(path, board);
			} catch (error) {
				console.error("Failed to save pending tech tree canvas", error);
			}
		}));

		this.listeners.clear();
		this.boards.clear();
		this.sourceCanvases.clear();
		this.knownTechTreePaths.clear();
		this.canvasInspectionCache.clear();
		this.savingPaths.clear();

		if (TechTreeManager.instance === this) {
			TechTreeManager.instance = null;
		}
	}

	subscribe(path: string, listener: BoardListener): () => void {
		const listeners = this.listeners.get(path) ?? new Set<BoardListener>();
		listeners.add(listener);
		this.listeners.set(path, listeners);

		return () => {
			listeners.delete(listener);

			if (listeners.size === 0) {
				this.listeners.delete(path);
			}
		};
	}

	async loadBoard(path: string): Promise<TechTreeBoard> {
		const file = this.getCanvasFile(path);

		if (!file) {
			throw new Error(`Tech tree canvas not found: ${path}`);
		}

		const rawCanvas = await this.app.vault.read(file);
		const canvas = parseCanvas(rawCanvas);

		if (!canvasHasTechTreeGoal(canvas)) {
			throw new Error("This canvas is not a tech tree. Add a text node with priority: goal to open it as a tech tree.");
		}

		const previousBoard = this.boards.get(path);
		const previousGoalId = previousBoard?.nodes.find((node) => node.data.priority === "goal")?.id;
		const board = applyNodeState(enforceSingleGoalNode(protectGoalNode(normalizeBoard(path, canvas), previousBoard), previousGoalId));
		this.boards.set(path, board);
		this.sourceCanvases.set(path, canvas);
		this.knownTechTreePaths.add(path);
		this.cacheCanvasInspection(file, true);

		return cloneBoard(board);
	}

	async updateBoard(path: string, board: TechTreeBoard): Promise<TechTreeBoard> {
		const previousBoard = this.boards.get(path);
		const protectedBoard = protectGoalNode({
			...board,
			nodes: board.nodes.map(stripNodeRuntimeData),
			edges: board.edges.map((edge) => ({ ...edge }))
		}, previousBoard);
		const goalId = previousBoard?.nodes.find((node) => node.data.priority === "goal")?.id
			?? protectedBoard.nodes.find((node) => node.data.priority === "goal")?.id;
		const normalizedGoalBoard = enforceSingleGoalNode(protectedBoard, goalId);
		const nodes = normalizedGoalBoard.nodes;
		const edges = normalizeEdgesForBoard(nodes, normalizedGoalBoard.edges);
		const nodesWithImpliedPriorities = applyEdgeImpliedPriorities(nodes, edges);
		const normalizedEdges = normalizeEdgesForBoard(nodesWithImpliedPriorities, edges);
		const nodesWithConnections = syncConnectionMetadata(nodesWithImpliedPriorities, normalizedEdges);
		const nextBoard = applyNodeState({
			...board,
			path,
			name: getBoardName(path),
			updatedAt: Date.now(),
			nodes: nodesWithConnections,
			edges: normalizedEdges
		});

		this.boards.set(path, nextBoard);
		this.notify(path, nextBoard);
		this.queueSave(path, nextBoard);

		return cloneBoard(nextBoard);
	}

	async createBoardFile(folder?: TFolder, name = DEFAULT_BOARD_NAME): Promise<TFile> {
		const targetFolder = folder ?? this.app.fileManager.getNewFileParent(this.app.workspace.getActiveFile()?.path ?? "");
		const path = await this.getAvailableBoardPath(targetFolder, name);
		const board = createDefaultBoard(path);
		const canvas = boardToCanvas(board);
		const file = await this.app.vault.create(path, stringifyCanvas(canvas));

		this.boards.set(file.path, board);
		this.sourceCanvases.set(file.path, canvas);
		this.knownTechTreePaths.add(file.path);
		this.cacheCanvasInspection(file, true);
		this.notify(file.path, board);

		return file;
	}

	async createBoardFromNode(sourceBoardPath: string, nodeText: string): Promise<TFile> {
		const sourceFile = this.getCanvasFile(sourceBoardPath);
		const targetFolder = sourceFile?.parent ?? this.app.fileManager.getNewFileParent(sourceBoardPath);
		const path = await this.getAvailableBoardPath(targetFolder, getBoardNameFromText(nodeText));
		const board = createBoardWithGoal(path, nodeText);
		const canvas = boardToCanvas(board);
		const file = await this.app.vault.create(path, stringifyCanvas(canvas));

		this.boards.set(file.path, board);
		this.sourceCanvases.set(file.path, canvas);
		this.knownTechTreePaths.add(file.path);
		this.cacheCanvasInspection(file, true);
		this.notify(file.path, board);

		return file;
	}

	async syncLinkedBoardWithNode(linkedBoardPath: string, nodeText: string): Promise<string> {
		const file = this.getCanvasFile(linkedBoardPath);

		if (!file) {
			throw new Error(`Linked tech tree canvas not found: ${linkedBoardPath}`);
		}

		const renamedFile = await this.renameBoardFileToMatchText(file, nodeText);
		const loadedCanvas = this.boards.has(renamedFile.path)
			? null
			: parseCanvas(await this.app.vault.read(renamedFile));
		const board = this.boards.get(renamedFile.path)
			?? normalizeBoard(renamedFile.path, loadedCanvas ?? createEmptyCanvas());

		if (loadedCanvas) {
			this.sourceCanvases.set(renamedFile.path, loadedCanvas);
			this.cacheCanvasInspection(renamedFile, canvasHasTechTreeGoal(loadedCanvas));
		}
		const goalNode = board.nodes.find((node) => node.data.priority === "goal");

		if (!goalNode) {
			throw new Error(`Linked tech tree canvas has no goal node: ${renamedFile.path}`);
		}

		await this.updateBoard(renamedFile.path, {
			...board,
			path: renamedFile.path,
			name: getBoardName(renamedFile.path),
			nodes: board.nodes.map((node) => node.id === goalNode.id
				? {
					...node,
					data: {
						...node.data,
						text: updateNodeVisibleText(node.data.text, nodeText)
					}
				}
				: node)
		});

		this.knownTechTreePaths.add(renamedFile.path);
		return renamedFile.path;
	}

	async getBoardFiles(): Promise<TFile[]> {
		const files = this.getCanvasFiles();
		const checks = await getCanvasFileChecks(files, (file) => this.isTechTreeCanvasFile(file));

		return checks
			.filter(({ isTechTree }) => isTechTree)
			.map(({ file }) => file)
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	getKnownBoardFiles(): TFile[] {
		return this.getCanvasFiles()
			.filter((file) => this.knownTechTreePaths.has(file.path))
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	getBoardFileData(path: string): string | null {
		const board = this.boards.get(path);

		return board ? stringifyCanvas(boardToCanvas(board, this.sourceCanvases.get(path))) : null;
	}

	async loadStickyNote(path: string): Promise<TechTreeStickyNote> {
		const board = this.boards.get(path) ?? await this.loadBoard(path);
		const legacyNote = await this.loadLegacyStickyNote(path);

		if (isDefaultStickyNote(board.stickyNote) && !isDefaultStickyNote(legacyNote)) {
			const migratedNote = await this.updateStickyNote(path, legacyNote);
			void this.clearLegacyStickyNote(path);
			return migratedNote;
		}

		return cloneStickyNote(board.stickyNote);
	}

	async updateStickyNote(path: string, note: TechTreeStickyNote): Promise<TechTreeStickyNote> {
		const normalizedNote = normalizeStickyNote(note);
		const board = this.boards.get(path) ?? await this.loadBoard(path);
		const nextBoard = {
			...board,
			updatedAt: Date.now(),
			stickyNote: normalizedNote
		};

		this.boards.set(path, nextBoard);
		this.notify(path, nextBoard);
		this.queueSave(path, nextBoard);

		return cloneStickyNote(normalizedNote);
	}

	async isTechTreeCanvasFile(file: TFile): Promise<boolean> {
		if (!isCanvasPath(file.path)) {
			return false;
		}

		try {
			const cachedInspection = this.canvasInspectionCache.get(file.path);

			if (cachedInspection?.mtime === file.stat.mtime) {
				this.updateKnownTechTreePath(file.path, cachedInspection.isTechTree);
				return cachedInspection.isTechTree;
			}

			const rawCanvas = await this.app.vault.read(file);
			const canvas = parseCanvas(rawCanvas);
			const isTechTree = canvasHasTechTreeGoal(canvas);

			this.sourceCanvases.set(file.path, canvas);
			this.cacheCanvasInspection(file, isTechTree);
			this.updateKnownTechTreePath(file.path, isTechTree);

			return isTechTree;
		} catch (error) {
			console.error("Failed to inspect tech tree canvas", error);
			return false;
		}
	}

	async handleCanvasModified(file: TFile): Promise<void> {
		if (!isCanvasPath(file.path) || this.savingPaths.has(file.path)) {
			return;
		}

		const hasInterestedView = this.listeners.has(file.path) || this.boards.has(file.path);

		if (!hasInterestedView) {
			return;
		}

		try {
			const board = await this.loadBoard(file.path);
			this.notify(file.path, board);
		} catch (error) {
			console.error("Failed to reload tech tree canvas", error);
		}
	}

	handleCanvasRenamed(file: TFile, oldPath: string): void {
		if (!isCanvasPath(oldPath)) {
			return;
		}

		const board = this.boards.get(oldPath);
		const sourceCanvas = this.sourceCanvases.get(oldPath);
		const cachedInspection = this.canvasInspectionCache.get(oldPath);
		const listeners = this.listeners.get(oldPath);
		const pendingSave = this.pendingSaves.get(oldPath);
		const saveTimer = this.saveTimers.get(oldPath);

		this.boards.delete(oldPath);
		this.sourceCanvases.delete(oldPath);
		this.knownTechTreePaths.delete(oldPath);
		this.canvasInspectionCache.delete(oldPath);
		this.listeners.delete(oldPath);
		this.pendingSaves.delete(oldPath);
		this.saveTimers.delete(oldPath);

		if (saveTimer) {
			window.clearTimeout(saveTimer);
		}

		if (board && isCanvasPath(file.path)) {
			this.boards.set(file.path, {
				...board,
				path: file.path,
				name: getBoardName(file.path)
			});
			this.knownTechTreePaths.add(file.path);
		}

		if (sourceCanvas && isCanvasPath(file.path)) {
			this.sourceCanvases.set(file.path, sourceCanvas);
		}

		if (cachedInspection && isCanvasPath(file.path)) {
			this.canvasInspectionCache.set(file.path, {
				...cachedInspection,
				mtime: file.stat.mtime
			});
		}

		if (listeners && isCanvasPath(file.path)) {
			this.listeners.set(file.path, listeners);
		}

		if (pendingSave && isCanvasPath(file.path)) {
			this.queueSave(file.path, {
				...pendingSave,
				path: file.path,
				name: getBoardName(file.path)
			});
		}
	}

	getCanvasFile(path: string): TFile | null {
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile && file.extension === "canvas" ? file : null;
	}

	private getCanvasFiles(): TFile[] {
		return this.app.vault.getFiles()
			.filter((file) => isCanvasPath(file.path));
	}

	private cacheCanvasInspection(file: TFile, isTechTree: boolean): void {
		this.canvasInspectionCache.set(file.path, {
			mtime: file.stat.mtime,
			isTechTree
		});
	}

	private updateKnownTechTreePath(path: string, isTechTree: boolean): void {
		if (isTechTree) {
			this.knownTechTreePaths.add(path);
		} else {
			this.knownTechTreePaths.delete(path);
		}
	}

	private queueSave(path: string, board: TechTreeBoard): void {
		const existingTimer = this.saveTimers.get(path);

		if (existingTimer) {
			window.clearTimeout(existingTimer);
		}

		this.pendingSaves.set(path, board);

		const timer = window.setTimeout(() => {
			this.saveTimers.delete(path);
			const pendingBoard = this.pendingSaves.get(path);
			this.pendingSaves.delete(path);

			if (!pendingBoard) {
				return;
			}

			this.saveBoard(path, pendingBoard).catch((error) => console.error("Failed to save tech tree canvas", error));
		}, SAVE_DELAY_MS);

		this.saveTimers.set(path, timer);
	}

	private async saveBoard(path: string, board: TechTreeBoard): Promise<void> {
		const file = this.getCanvasFile(path);

		if (!file) {
			new Notice("Unable to save tech tree board because the canvas file is missing.");
			return;
		}

		const canvas = boardToCanvas(board, this.sourceCanvases.get(path));

		this.savingPaths.add(path);

		try {
			await this.app.vault.modify(file, stringifyCanvas(canvas));
			this.sourceCanvases.set(path, canvas);
			this.cacheCanvasInspection(file, true);
		} finally {
			window.setTimeout(() => this.savingPaths.delete(path), 500);
		}
	}

	private async loadLegacyStickyNote(path: string): Promise<TechTreeStickyNote> {
		try {
			const data = normalizePluginData(await this.plugin.loadData());
			return normalizeStickyNote(data.stickyNotes?.[path]);
		} catch (error) {
			console.error("Failed to load legacy tech tree sticky note", error);
			return { ...DEFAULT_STICKY_NOTE };
		}
	}

	private async clearLegacyStickyNote(path: string): Promise<void> {
		try {
			const data = normalizePluginData(await this.plugin.loadData());

			if (!data.stickyNotes?.[path]) {
				return;
			}

			const stickyNotes = { ...data.stickyNotes };
			delete stickyNotes[path];

			await this.plugin.saveData({
				...data,
				stickyNotes
			});
		} catch (error) {
			console.error("Failed to clear legacy tech tree sticky note", error);
		}
	}

	private notify(path: string, board: TechTreeBoard): void {
		const listeners = this.listeners.get(path);

		if (!listeners) {
			return;
		}

		for (const listener of listeners) {
			listener(cloneBoard(board));
		}
	}

	private async renameBoardFileToMatchText(file: TFile, nodeText: string): Promise<TFile> {
		const targetFolder = file.parent ?? this.app.fileManager.getNewFileParent(file.path);
		const nextPath = await this.getAvailableBoardPath(targetFolder, getBoardNameFromText(nodeText), file.path);

		if (nextPath === file.path) {
			return file;
		}

		const oldPath = file.path;
		await this.app.fileManager.renameFile(file, nextPath);
		const renamedFile = this.getCanvasFile(nextPath);

		if (!renamedFile) {
			throw new Error(`Unable to find renamed tech tree canvas: ${nextPath}`);
		}

		this.handleCanvasRenamed(renamedFile, oldPath);
		return renamedFile;
	}

	private async getAvailableBoardPath(folder: TFolder, rawName: string, existingPath?: string): Promise<string> {
		const folderPath = folder.path === "/" ? "" : `${folder.path}/`;
		const baseName = sanitizeBoardName(rawName) || DEFAULT_BOARD_NAME;
		let candidate = `${folderPath}${baseName}${BOARD_EXTENSION}`;
		let index = 1;

		while (candidate !== existingPath && await this.app.vault.adapter.exists(candidate)) {
			candidate = `${folderPath}${baseName} ${index}${BOARD_EXTENSION}`;
			index += 1;
		}

		return candidate;
	}
}

export function isCanvasPath(path: string): boolean {
	return path.toLowerCase().endsWith(BOARD_EXTENSION);
}

export function isTechTreeCanvasPath(path: string): boolean {
	return isCanvasPath(path);
}

export function getBoardName(path: string): string {
	const fileName = path.split("/").pop() ?? DEFAULT_BOARD_NAME;

	if (fileName.endsWith(LEGACY_BOARD_SUFFIX)) {
		return fileName.slice(0, -LEGACY_BOARD_SUFFIX.length) || DEFAULT_BOARD_NAME;
	}

	return fileName.replace(/\.canvas$/i, "") || DEFAULT_BOARD_NAME;
}

async function getCanvasFileChecks(
	files: TFile[],
	isTechTreeCanvasFile: (file: TFile) => Promise<boolean>
): Promise<{ file: TFile; isTechTree: boolean }[]> {
	const checks: { file: TFile; isTechTree: boolean }[] = [];
	let nextIndex = 0;
	const workerCount = Math.min(BOARD_FILE_INSPECTION_CONCURRENCY, files.length);

	await Promise.all(Array.from({ length: workerCount }, async () => {
		while (nextIndex < files.length) {
			const file = files[nextIndex];
			nextIndex += 1;

			if (!file) {
				continue;
			}

			checks.push({
				file,
				isTechTree: await isTechTreeCanvasFile(file)
			});
		}
	}));

	return checks;
}

function normalizePluginData(data: unknown): TechTreePluginData {
	if (!isRecord(data)) {
		return {};
	}

	const stickyNotes = isRecord(data.stickyNotes)
		? Object.fromEntries(Object.entries(data.stickyNotes).map(([path, note]) => [path, normalizeStickyNote(note)]))
		: undefined;

	return {
		...data,
		...(stickyNotes ? { stickyNotes } : {})
	};
}

function normalizeStickyNote(note: unknown): TechTreeStickyNote {
	if (!isRecord(note)) {
		return { ...DEFAULT_STICKY_NOTE };
	}

	return {
		text: typeof note.text === "string" ? note.text : DEFAULT_STICKY_NOTE.text,
		x: getNumber(note.x, DEFAULT_STICKY_NOTE.x),
		y: getNumber(note.y, DEFAULT_STICKY_NOTE.y),
		isOpen: typeof note.isOpen === "boolean" ? note.isOpen : normalizeBooleanMetadata(typeof note.open === "string" ? note.open : undefined)
	};
}

function isDefaultStickyNote(note: TechTreeStickyNote): boolean {
	return note.text === DEFAULT_STICKY_NOTE.text
		&& note.x === DEFAULT_STICKY_NOTE.x
		&& note.y === DEFAULT_STICKY_NOTE.y
		&& note.isOpen === DEFAULT_STICKY_NOTE.isOpen;
}

function cloneStickyNote(note: TechTreeStickyNote): TechTreeStickyNote {
	return { ...note };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createNode(
	position: XYPosition,
	input: string | CreateTechTreeNodeOptions = {}
): TechTreeNode {
	const text = typeof input === "string" ? input : createConfiguredNodeText(input);

	return toFlowNode({
		id: createId("node"),
		type: "text",
		x: position.x,
		y: position.y,
		width: DEFAULT_NODE_WIDTH,
		height: DEFAULT_NODE_HEIGHT,
		text
	});
}

export function updateNodeVisibleText(existingText: string, visibleText: string): string {
	const metadata = getHiddenMetadataMap(existingText);
	const visibleLines = normalizeVisibleLines(visibleText);

	return formatNodeText(metadata, visibleLines);
}

export function updateNodeCompletionStatus(existingText: string, completed: boolean): string {
	return upsertHiddenMetadata(existingText, "status", completed ? "done" : "open");
}

export function updateNodePriority(existingText: string, priority: TechTreePriority): string {
	return upsertHiddenMetadata(existingText, "priority", priority);
}

export function updateNodePriorityOrder(existingText: string, priorityOrder: number): string {
	const normalizedPriorityOrder = clampPriorityOrder(priorityOrder);

	return normalizedPriorityOrder > MIN_PRIORITY_ORDER
		? upsertHiddenMetadata(existingText, PRIORITY_ORDER_METADATA_KEY, normalizedPriorityOrder.toString())
		: removeHiddenMetadata(existingText, PRIORITY_ORDER_METADATA_KEY);
}

export function updateNodeBoardPath(existingText: string, boardPath: string | null): string {
	return boardPath
		? upsertHiddenMetadata(existingText, BOARD_PATH_METADATA_KEY, boardPath)
		: removeHiddenMetadata(existingText, BOARD_PATH_METADATA_KEY);
}

export function updateGoalQuestViewMode(existingText: string, enabled: boolean): string {
	return upsertHiddenMetadata(existingText, QUEST_VIEW_METADATA_KEY, enabled ? "on" : "off");
}

function createDefaultBoard(path: string): TechTreeBoard {
	const outcome = createNode(
		{ x: -520, y: -65 },
		getDefaultNodeText("inevitable outcome", "goal")
	);
	const firstNecessary = createNode(
		{ x: 200, y: -160 },
		getDefaultNodeText("broken down", "necessary")
	);
	const secondNecessary = createNode(
		{ x: 200, y: 30 },
		getDefaultNodeText("broken down", "necessary")
	);

	const board: TechTreeBoard = {
		path,
		name: getBoardName(path),
		updatedAt: Date.now(),
		stickyNote: { ...DEFAULT_STICKY_NOTE },
		nodes: [outcome, firstNecessary, secondNecessary],
		edges: [
			createEdge(outcome.id, firstNecessary.id),
			createEdge(outcome.id, secondNecessary.id)
		]
	};

	return applyNodeState({
		...board,
		nodes: syncConnectionMetadata(board.nodes, board.edges)
	});
}

function createBoardWithGoal(path: string, goalText: string): TechTreeBoard {
	const goalNode = createNode(
		{ x: -160, y: -65 },
		{
			priority: "goal",
			text: goalText
		}
	);
	const board: TechTreeBoard = {
		path,
		name: getBoardName(path),
		updatedAt: Date.now(),
		stickyNote: { ...DEFAULT_STICKY_NOTE },
		nodes: [goalNode],
		edges: []
	};

	return applyNodeState(board);
}

function createConfiguredNodeText(options: CreateTechTreeNodeOptions): string {
	const priority = options.priority ?? "necessary";
	const visibleText = normalizeLineEndings(options.text ?? "").trimEnd();

	if (!visibleText.trim()) {
		return getDefaultNodeText("truth", priority);
	}

	return updateNodeVisibleText(getDefaultNodeText("Untitled note", priority), visibleText);
}

function parseCanvas(rawCanvas: string): CanvasFile {
	try {
		const parsed: unknown = JSON.parse(rawCanvas);

		if (!isRecord(parsed)) {
			return createEmptyCanvas();
		}

		return {
			...parsed,
			nodes: Array.isArray(parsed.nodes) ? parsed.nodes.filter(isCanvasNode) : [],
			edges: Array.isArray(parsed.edges) ? parsed.edges.filter(isCanvasEdge) : []
		};
	} catch (error) {
		console.error("Failed to parse tech tree canvas", error);
		return createEmptyCanvas();
	}
}

function canvasHasTechTreeGoal(canvas: CanvasFile): boolean {
	return canvas.nodes.some((node) => isCanvasTextNode(node) && !isStickyNoteCanvasNode(node) && parseNodeText(node.text).priority === "goal");
}

function normalizeBoard(path: string, canvas: CanvasFile): TechTreeBoard {
	const stickyNote = getStickyNoteFromCanvas(canvas.nodes);
	const nodes = canvas.nodes
		.filter(isCanvasTextNode)
		.filter((node) => !isStickyNoteCanvasNode(node))
		.map(toFlowNode);
	const nodeIds = new Set(nodes.map((node) => node.id));
	const canvasEdges = normalizeEdgesForBoard(nodes, canvas.edges
		.map(toFlowEdge)
		.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)));
	const metadataEdges = getMetadataEdges(nodes);
	const edges = canvasEdges.length > 0 ? canvasEdges : metadataEdges;
	const nodesWithImpliedPriorities = applyEdgeImpliedPriorities(nodes, edges);
	const normalizedEdges = normalizeEdgesForBoard(nodesWithImpliedPriorities, edges);

	return applyNodeState({
		path,
		name: getBoardName(path),
		updatedAt: Date.now(),
		stickyNote,
		nodes: syncConnectionMetadata(nodesWithImpliedPriorities, normalizedEdges),
		edges: normalizedEdges
	});
}

function boardToCanvas(board: TechTreeBoard, sourceCanvas = createEmptyCanvas()): CanvasFile {
	const boardNodesById = new Map(board.nodes.map((node) => [node.id, toCanvasNode(node)]));
	const boardNodeIds = new Set(boardNodesById.keys());
	const stickyNoteNode = toStickyNoteCanvasNode(board.stickyNote, board.nodes);
	const nodes: CanvasNode[] = [];
	const writtenNodeIds = new Set<string>();
	let stickyNoteWritten = false;

	for (const sourceNode of sourceCanvas.nodes) {
		if (isCanvasTextNode(sourceNode) && isStickyNoteCanvasNode(sourceNode)) {
			if (!stickyNoteWritten) {
				nodes.push(mergeCanvasTextNode(sourceNode, stickyNoteNode));
				stickyNoteWritten = true;
			}

			continue;
		}

		const boardNode = boardNodesById.get(sourceNode.id);

		if (boardNode) {
			nodes.push(mergeCanvasTextNode(sourceNode, boardNode));
			writtenNodeIds.add(sourceNode.id);
			continue;
		}

		if (isCanvasTextNode(sourceNode)) {
			continue;
		}

		nodes.push(cloneCanvasNode(sourceNode));
	}

	for (const [nodeId, node] of boardNodesById) {
		if (!writtenNodeIds.has(nodeId)) {
			nodes.push(node);
		}
	}

	if (!stickyNoteWritten) {
		nodes.unshift(stickyNoteNode);
	}

	const finalNodeIds = new Set(nodes.map((node) => node.id));
	const boardEdgesById = new Map(board.edges.map((edge) => [edge.id, toCanvasEdge(edge)]));
	const edges: CanvasEdge[] = [];
	const writtenEdgeIds = new Set<string>();

	for (const sourceEdge of sourceCanvas.edges) {
		const boardEdge = boardEdgesById.get(sourceEdge.id);

		if (boardEdge) {
			edges.push(mergeCanvasEdge(sourceEdge, boardEdge));
			writtenEdgeIds.add(sourceEdge.id);
			continue;
		}

		if (boardNodeIds.has(sourceEdge.fromNode) && boardNodeIds.has(sourceEdge.toNode)) {
			continue;
		}

		if (finalNodeIds.has(sourceEdge.fromNode) && finalNodeIds.has(sourceEdge.toNode)) {
			edges.push(cloneCanvasEdge(sourceEdge));
		}
	}

	for (const [edgeId, edge] of boardEdgesById) {
		if (!writtenEdgeIds.has(edgeId)) {
			edges.push(edge);
		}
	}

	return {
		...sourceCanvas,
		nodes,
		edges
	};
}

function toFlowNode(node: CanvasTextNode): TechTreeNode {
	const parsed = parseNodeText(node.text);
	const width = getNumber(node.width, DEFAULT_NODE_WIDTH);
	const height = normalizeNodeHeight(getNumber(node.height, DEFAULT_NODE_HEIGHT));

	return {
		id: node.id,
		type: "techNode",
		position: {
			x: node.x,
			y: node.y
		},
		width,
		height,
		style: {
			width,
			height
		},
		data: {
			text: node.text,
			visibleText: parsed.visibleText,
			title: parsed.title,
			priority: parsed.priority,
			priorityOrder: parsed.priorityOrder,
			status: parsed.status,
			statusKind: parsed.statusKind,
			completed: parsed.completed,
			questViewMode: parsed.questViewMode,
			boardPath: parsed.boardPath,
			locked: false,
			hasCheckedNeighbor: false,
			hasQuestPrerequisite: false,
			progressState: getProgressState(parsed, false, false)
		}
	};
}

function toCanvasNode(node: TechTreeNode): CanvasTextNode {
	const width = getNumber(node.width, getNumber(node.measured?.width, DEFAULT_NODE_WIDTH));
	const height = normalizeNodeHeight(getNumber(node.height, getNumber(node.measured?.height, DEFAULT_NODE_HEIGHT)));

	return {
		id: node.id,
		type: "text",
		x: Math.round(node.position.x),
		y: Math.round(node.position.y),
		width: Math.round(width),
		height: Math.round(height),
		text: node.data.text
	};
}

function toStickyNoteCanvasNode(note: TechTreeStickyNote, nodes: TechTreeNode[]): CanvasTextNode {
	const position = getStickyNoteCanvasNodePosition(nodes);

	return {
		id: STICKY_NOTE_CANVAS_NODE_ID,
		type: "text",
		x: position.x,
		y: position.y,
		width: STICKY_NOTE_CANVAS_NODE_WIDTH,
		height: STICKY_NOTE_CANVAS_NODE_HEIGHT,
		text: formatStickyNoteCanvasText(note)
	};
}

function getStickyNoteCanvasNodePosition(nodes: TechTreeNode[]): XYPosition {
	if (nodes.length === 0) {
		return {
			x: -STICKY_NOTE_CANVAS_NODE_WIDTH - STICKY_NOTE_CANVAS_NODE_GAP,
			y: -STICKY_NOTE_CANVAS_NODE_HEIGHT - STICKY_NOTE_CANVAS_NODE_GAP
		};
	}

	const left = Math.min(...nodes.map((node) => node.position.x));
	const top = Math.min(...nodes.map((node) => node.position.y));

	return {
		x: Math.round(left - STICKY_NOTE_CANVAS_NODE_WIDTH - STICKY_NOTE_CANVAS_NODE_GAP),
		y: Math.round(top - STICKY_NOTE_CANVAS_NODE_HEIGHT - STICKY_NOTE_CANVAS_NODE_GAP)
	};
}

function getStickyNoteFromCanvas(nodes: CanvasNode[]): TechTreeStickyNote {
	const stickyNode = nodes.find((node): node is CanvasTextNode => isCanvasTextNode(node) && isStickyNoteCanvasNode(node));

	return stickyNode ? parseStickyNoteCanvasNode(stickyNode) : { ...DEFAULT_STICKY_NOTE };
}

function isStickyNoteCanvasNode(node: CanvasNode): boolean {
	return isCanvasTextNode(node)
		&& (node.id === STICKY_NOTE_CANVAS_NODE_ID || normalizeLineEndings(node.text).startsWith(`%% ${STICKY_NOTE_CANVAS_NODE_MARKER}`));
}

function parseStickyNoteCanvasNode(node: CanvasTextNode): TechTreeStickyNote {
	const lines = normalizeLineEndings(node.text).split("\n");
	const metadata = new Map<string, string>();
	let contentStartIndex = 0;

	if (lines[0]?.trim() === `%% ${STICKY_NOTE_CANVAS_NODE_MARKER}`) {
		contentStartIndex = lines.length;

		for (let index = 1; index < lines.length; index += 1) {
			const line = lines[index] ?? "";

			if (line.trim() === "%%") {
				contentStartIndex = index + 1;
				break;
			}

			const match = parseMetadataLine(line);

			if (match) {
				metadata.set(match.key, match.value);
			}
		}
	}

	return normalizeStickyNote({
		text: lines.slice(contentStartIndex).join("\n").trimEnd(),
		x: Number(metadata.get("x")),
		y: Number(metadata.get("y")),
		isOpen: normalizeBooleanMetadata(metadata.get("open"))
	});
}

function formatStickyNoteCanvasText(note: TechTreeStickyNote): string {
	const normalizedNote = normalizeStickyNote(note);
	const content = normalizeLineEndings(normalizedNote.text).trimEnd();
	const metadataLines = [
		`%% ${STICKY_NOTE_CANVAS_NODE_MARKER}`,
		`x: ${Math.round(normalizedNote.x)}`,
		`y: ${Math.round(normalizedNote.y)}`,
		`open: ${normalizedNote.isOpen ? "on" : "off"}`,
		"%%"
	];

	return content ? `${metadataLines.join("\n")}\n${content}` : metadataLines.join("\n");
}

function normalizeNodeHeight(height: number): number {
	return Math.max(height, DEFAULT_NODE_HEIGHT);
}

function toFlowEdge(edge: CanvasEdge): Edge {
	return {
		id: edge.id,
		source: edge.fromNode,
		target: edge.toNode,
		sourceHandle: `handle-${edge.fromSide ?? "right"}`,
		targetHandle: `handle-${edge.toSide ?? "left"}`,
		type: "smoothstep"
	};
}

function toCanvasEdge(edge: Edge): CanvasEdge {
	return {
		id: edge.id,
		fromNode: edge.source,
		fromSide: getCanvasSide(edge.sourceHandle, "right"),
		toNode: edge.target,
		toSide: getCanvasSide(edge.targetHandle, "left")
	};
}

function createEdge(source: string, target: string): Edge {
	return {
		id: createId("edge"),
		source,
		target,
		sourceHandle: "handle-right",
		targetHandle: "handle-left",
		type: "smoothstep"
	};
}

function normalizeEdgesForBoard(nodes: TechTreeNode[], edges: Edge[]): Edge[] {
	const nodesById = new Map(nodes.map((node) => [node.id, node]));
	const seen = new Set<string>();
	const nextEdges: Edge[] = [];

	for (const edge of edges) {
		const source = nodesById.get(edge.source);
		const target = nodesById.get(edge.target);

		if (!source || !target) {
			const normalized = {
				...edge,
				sourceHandle: normalizeHandleId(edge.sourceHandle, "handle-right"),
				targetHandle: normalizeHandleId(edge.targetHandle, "handle-left")
			};

			if (!seen.has(normalized.id)) {
				seen.add(normalized.id);
				nextEdges.push(normalized);
			}

			continue;
		}

		const edgeHandles = getEdgeHandles(source, target, edge);
		const normalizedEdge = {
			...edge,
			source: source.id,
			target: target.id,
			sourceHandle: edgeHandles.sourceHandle,
			targetHandle: edgeHandles.targetHandle
		};

		if (!isAllowedEdge(source, target)) {
			continue;
		}

		const key = `${source.id}:${normalizedEdge.sourceHandle}->${target.id}:${normalizedEdge.targetHandle}`;

		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		nextEdges.push(normalizedEdge);
	}

	return nextEdges;
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

function getHorizontalHandles(source: TechTreeNode, target: TechTreeNode): { sourceHandle: string; targetHandle: string } {
	return target.position.x >= source.position.x
		? { sourceHandle: "handle-right", targetHandle: "handle-left" }
		: { sourceHandle: "handle-left", targetHandle: "handle-right" };
}

function getEdgeHandles(source: TechTreeNode, target: TechTreeNode, edge: Edge): { sourceHandle: string; targetHandle: string } {
	if (source.data.priority === "necessary" && target.data.priority === "necessary") {
		return getHorizontalHandles(source, target);
	}

	const directionalHandles = getDirectionalHandles(source, target);

	return {
		sourceHandle: normalizeHandleId(edge.sourceHandle, directionalHandles.sourceHandle),
		targetHandle: normalizeHandleId(edge.targetHandle, directionalHandles.targetHandle)
	};
}

function getMetadataEdges(nodes: TechTreeNode[]): Edge[] {
	const nodesById = new Map(nodes.map((node) => [node.id, node]));
	const edges: Edge[] = [];
	const seen = new Set<string>();

	for (const node of nodes) {
		const parsed = parseNodeText(node.data.text);

		for (const connection of parsed.connections) {
			const target = nodesById.get(connection.target);

			if (!target || connection.target === node.id) {
				continue;
			}

			const edge = {
				id: createMetadataEdgeId(node.id, connection.target, connection.sourceSide, connection.targetSide),
				source: node.id,
				target: connection.target,
				sourceHandle: `handle-${connection.sourceSide}`,
				targetHandle: `handle-${connection.targetSide}`,
				type: "smoothstep"
			};
			const edgeHandles = getEdgeHandles(node, target, edge);
			const normalizedEdge = {
				...edge,
				sourceHandle: edgeHandles.sourceHandle,
				targetHandle: edgeHandles.targetHandle
			};

			if (!isAllowedEdge(node, target)) {
				continue;
			}

			const sourceSide = getCanvasSide(normalizedEdge.sourceHandle, "right");
			const targetSide = getCanvasSide(normalizedEdge.targetHandle, "left");
			const key = `${node.id}:${sourceSide}->${connection.target}:${targetSide}`;
			const normalizedEdgeWithId = {
				...normalizedEdge,
				id: createMetadataEdgeId(node.id, connection.target, sourceSide, targetSide)
			};

			if (seen.has(key)) {
				continue;
			}

			seen.add(key);
			edges.push(normalizedEdgeWithId);
		}
	}

	return edges;
}

function syncConnectionMetadata(nodes: TechTreeNode[], edges: Edge[]): TechTreeNode[] {
	const outgoingBySource = new Map<string, TechTreeConnectionMetadata[]>();

	for (const edge of edges) {
		const sourceSide = getCanvasSide(edge.sourceHandle, "right");
		const targetSide = getCanvasSide(edge.targetHandle, "left");
		const outgoing = outgoingBySource.get(edge.source) ?? [];
		outgoing.push({
			target: edge.target,
			sourceSide,
			targetSide
		});
		outgoingBySource.set(edge.source, outgoing);
	}

	return nodes.map((node) => {
		const connections = outgoingBySource.get(node.id) ?? [];
		const text = connections.length > 0
			? upsertHiddenMetadata(node.data.text, CONNECTIONS_METADATA_KEY, stringifyConnectionMetadata(connections))
			: removeHiddenMetadata(node.data.text, CONNECTIONS_METADATA_KEY);

		return {
			...node,
			data: {
				...node.data,
				text
			}
		};
	});
}

function applyEdgeImpliedPriorities(nodes: TechTreeNode[], edges: Edge[]): TechTreeNode[] {
	const nodesById = new Map(nodes.map((node) => [node.id, node]));
	const mediumImpactTargets = new Set<string>();

	for (const edge of edges) {
		const source = nodesById.get(edge.source);
		const target = nodesById.get(edge.target);

		if (
			source?.data.priority === "necessary"
			&& (target?.data.priority === "quest" || target?.data.priority === "medium impact")
		) {
			mediumImpactTargets.add(target.id);
		}
	}

	return nodes.map((node) => {
		if (mediumImpactTargets.has(node.id) && node.data.priority === "quest") {
			return setNodePriority(node, "medium impact");
		}

		if (!mediumImpactTargets.has(node.id) && node.data.priority === "medium impact") {
			return setNodePriority(node, "quest");
		}

		return node;
	});
}

function stringifyConnectionMetadata(connections: TechTreeConnectionMetadata[]): string {
	return connections
		.map((connection) => `${connection.target}|${connection.sourceSide}|${connection.targetSide}`)
		.join(",");
}

function parseConnectionMetadata(value: string | undefined): TechTreeConnectionMetadata[] {
	if (!value) {
		return [];
	}

	return value
		.split(",")
		.map((entry) => {
			const [target, sourceSide, targetSide] = entry.split("|");

			if (!target || !isCanvasSide(sourceSide) || !isCanvasSide(targetSide)) {
				return null;
			}

			return {
				target,
				sourceSide,
				targetSide
			};
		})
		.filter((connection): connection is TechTreeConnectionMetadata => Boolean(connection));
}

export function applyNodeState(board: TechTreeBoard, options: ApplyNodeStateOptions = {}): TechTreeBoard {
	const lockGoalNodes = options.lockGoalNodes ?? true;
	const persistStatus = options.persistStatus ?? true;
	const nodesById = new Map(board.nodes.map((node) => [node.id, node]));
	const parsedById = new Map(board.nodes.map((node) => [node.id, parseNodeText(node.data.text)]));
	const incomingEdgesByTarget = new Map<string, Edge[]>();
	const connectedEdgesByNode = new Map<string, Edge[]>();

	for (const edge of board.edges) {
		const incoming = incomingEdgesByTarget.get(edge.target) ?? [];
		incoming.push(edge);
		incomingEdgesByTarget.set(edge.target, incoming);

		const sourceEdges = connectedEdgesByNode.get(edge.source) ?? [];
		sourceEdges.push(edge);
		connectedEdgesByNode.set(edge.source, sourceEdges);

		const targetEdges = connectedEdgesByNode.get(edge.target) ?? [];
		targetEdges.push(edge);
		connectedEdgesByNode.set(edge.target, targetEdges);
	}

	const lockCache = new Map<string, boolean>();
	const isLocked = (nodeId: string, seen = new Set<string>()): boolean => {
		if (lockCache.has(nodeId)) {
			return lockCache.get(nodeId) ?? false;
		}

		const parsedNode = parsedById.get(nodeId);
		const node = nodesById.get(nodeId);

		if (!lockGoalNodes && node?.data.priority === "goal") {
			lockCache.set(nodeId, false);
			return false;
		}

		if (parsedNode?.completed) {
			lockCache.set(nodeId, false);
			return false;
		}

		if (seen.has(nodeId)) {
			return false;
		}

		seen.add(nodeId);

		const incomingEdges = incomingEdgesByTarget.get(nodeId) ?? [];
		const locked = incomingEdges.some((edge) => {
			const source = nodesById.get(edge.source);
			const target = nodesById.get(edge.target);

			if (source && target && isNecessaryToNonNecessaryEdge(source, target)) {
				return false;
			}

			if (source && target && isMediumImpactToNecessaryEdge(source, target)) {
				return false;
			}

			return !source || isLocked(source.id, new Set(seen)) || !isParsedNodeUnlocked(parsedById.get(source.id));
		});

		lockCache.set(nodeId, locked);
		return locked;
	};

	return {
		...board,
		nodes: board.nodes.map((node) => {
			const parsed = parsedById.get(node.id) ?? parseNodeText(node.data.text);
			const locked = isLocked(node.id);
			const runtimeStatus = getRuntimeStatus(parsed.completed, locked);
			const connectedEdges = connectedEdgesByNode.get(node.id) ?? [];
			const hasCheckedNeighbor = connectedEdges.some((edge) => {
				const neighborId = edge.source === node.id ? edge.target : edge.source;
				return Boolean(parsedById.get(neighborId)?.completed);
			});
			const incomingEdges = incomingEdgesByTarget.get(node.id) ?? [];
			const hasQuestPrerequisite = incomingEdges.some((edge) => {
				const source = nodesById.get(edge.source);
				return source?.data.priority === "quest";
			});

			return {
				...node,
				data: {
					...node.data,
					text: persistStatus ? upsertHiddenMetadata(node.data.text, "status", runtimeStatus) : node.data.text,
					visibleText: parsed.visibleText,
					title: parsed.title,
					priority: parsed.priority,
					priorityOrder: parsed.priorityOrder,
					status: runtimeStatus,
					statusKind: getRuntimeStatusKind(runtimeStatus),
					completed: parsed.completed,
					questViewMode: parsed.questViewMode,
					boardPath: parsed.boardPath,
					locked,
					hasCheckedNeighbor,
					hasQuestPrerequisite,
					progressState: getProgressState(parsed, hasCheckedNeighbor, locked)
				}
			};
		})
	};
}

function isParsedNodeUnlocked(parsed: ParsedNodeText | undefined): boolean {
	return Boolean(parsed?.completed);
}

function getRuntimeStatus(completed: boolean, locked: boolean): string {
	if (completed) {
		return "done";
	}

	return locked ? "locked" : "open";
}

function getRuntimeStatusKind(status: string): TechTreeStatusKind {
	return status === "done"
		? "done"
		: status === "locked"
			? "blocked"
			: "open";
}

function isAllowedEdge(source: TechTreeNode | undefined, target: TechTreeNode | undefined): boolean {
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

function isNecessaryToNonNecessaryEdge(source: TechTreeNode, target: TechTreeNode): boolean {
	return source.data.priority === "necessary" && target.data.priority !== "necessary";
}

function isMediumImpactToNecessaryEdge(source: TechTreeNode, target: TechTreeNode): boolean {
	return source.data.priority === "medium impact" && target.data.priority === "necessary";
}

function parseNodeText(text: string): ParsedNodeText {
	const lines = normalizeLineEndings(text).split("\n");
	const metadata = new Map<string, string>();

	for (const line of lines) {
		const match = parseMetadataLine(line);

		if (match && HIDDEN_METADATA_KEYS.has(match.key)) {
			metadata.set(match.key, match.value);
		}
	}

	const firstContentLine = lines.find((line) => {
		const trimmed = line.trim();
		return trimmed && !isHiddenMetadataLine(line);
	});
	const priority = normalizePriority(metadata.get("priority"));
	const priorityOrder = normalizePriorityOrder(metadata.get(PRIORITY_ORDER_METADATA_KEY));
	const rawStatus = metadata.get("status")?.trim();
	const statusKind = normalizeStatusKind(rawStatus);
	const questViewMode = normalizeBooleanMetadata(metadata.get(QUEST_VIEW_METADATA_KEY));
	const checkboxStates = getCheckboxStates(text);
	const completed = rawStatus
		? statusKind === "done"
		: checkboxStates.length > 0 && checkboxStates.every(Boolean);
	const partial = !completed && (
		statusKind === "in-progress"
		|| statusKind === "blocked"
		|| checkboxStates.some(Boolean)
	);

	return {
		title: firstContentLine?.replace(/^#+\s*/, "").trim() || "Untitled note",
		visibleText: getVisibleNodeText(text),
		priority,
		priorityOrder,
		connections: parseConnectionMetadata(metadata.get(CONNECTIONS_METADATA_KEY)),
		status: rawStatus || (completed ? "done" : "open"),
		statusKind: completed ? "done" : statusKind,
		completed,
		questViewMode,
		boardPath: normalizeBoardPath(metadata.get(BOARD_PATH_METADATA_KEY)),
		partial
	};
}

function getCheckboxStates(text: string): boolean[] {
	return text
		.split(/\r?\n/)
		.map((line) => /^\s*[-*]\s+\[([ xX])\]/.exec(line)?.[1])
		.filter((value): value is string => typeof value === "string")
		.map((value) => value.toLowerCase() === "x");
}

function normalizePriority(value: string | undefined): TechTreePriority {
	const normalized = value?.toLowerCase().trim().replace(/[-_]+/g, " ");

	if (normalized === "critical" || normalized === "necessary") {
		return "necessary";
	}

	if (normalized === "goal" || normalized === "outcome") {
		return "goal";
	}

	if (normalized === "high" || normalized === "normal" || normalized === "medium" || normalized === "medium impact") {
		return "medium impact";
	}

	if (normalized === "low" || normalized === "quest") {
		return "quest";
	}

	return "quest";
}

function normalizePriorityOrder(value: string | undefined): number {
	const parsedValue = Number.parseInt(value ?? "", 10);

	return clampPriorityOrder(Number.isFinite(parsedValue) ? parsedValue : MIN_PRIORITY_ORDER);
}

function clampPriorityOrder(value: number): number {
	return Math.min(MAX_PRIORITY_ORDER, Math.max(MIN_PRIORITY_ORDER, Math.trunc(value)));
}

function getProgressState(parsed: ParsedNodeText, hasIncomingEdges: boolean, locked: boolean): TechTreeProgressState {
	if (parsed.completed) {
		return "done";
	}

	if (parsed.partial || hasIncomingEdges || locked) {
		return "partial";
	}

	return "none";
}

function getDefaultNodeText(title: string, priority: TechTreePriority = "necessary", prompt = ""): string {
	const metadata = new Map<string, string>([
		["priority", priority],
		["status", "open"]
	]);
	const visibleLines = prompt ? [title, "", prompt] : [title];

	return formatNodeText(metadata, visibleLines);
}

function getBoardNameFromText(text: string): string {
	const firstLine = normalizeLineEndings(text)
		.split("\n")
		.find((line) => line.trim())
		?.replace(/^#+\s*/, "")
		.trim();

	return firstLine || DEFAULT_BOARD_NAME;
}

function stripNodeRuntimeData(node: TechTreeNode): TechTreeNode {
	const parsed = parseNodeText(node.data.text);
	const progressState: TechTreeProgressState = node.data.progressState
		?? getProgressState(parsed, false, node.data.locked);

	return {
		...node,
		data: {
			text: node.data.text,
			visibleText: parsed.visibleText,
			title: parsed.title,
			priority: parsed.priority,
			priorityOrder: parsed.priorityOrder,
			status: parsed.status,
			statusKind: parsed.statusKind,
			completed: parsed.completed,
			questViewMode: parsed.questViewMode,
			boardPath: parsed.boardPath,
			locked: node.data.locked,
			hasCheckedNeighbor: node.data.hasCheckedNeighbor,
			hasQuestPrerequisite: node.data.hasQuestPrerequisite,
			progressState
		}
	};
}

function protectGoalNode(board: TechTreeBoard, previousBoard: TechTreeBoard | undefined): TechTreeBoard {
	const previousGoal = previousBoard?.nodes.find((node) => node.data.priority === "goal");

	if (!previousGoal || board.nodes.some((node) => node.id === previousGoal.id)) {
		return board;
	}

	const nodes = [...board.nodes, previousGoal];
	const nodeIds = new Set(nodes.map((node) => node.id));
	const existingEdgeIds = new Set(board.edges.map((edge) => edge.id));
	const restoredEdges = (previousBoard?.edges ?? []).filter((edge) => (
		(edge.source === previousGoal.id || edge.target === previousGoal.id)
		&& nodeIds.has(edge.source)
		&& nodeIds.has(edge.target)
		&& !existingEdgeIds.has(edge.id)
	));

	return {
		...board,
		nodes,
		edges: [...board.edges, ...restoredEdges]
	};
}

function enforceSingleGoalNode(board: TechTreeBoard, preferredGoalId?: string): TechTreeBoard {
	const goalNodes = board.nodes.filter((node) => node.data.priority === "goal");

	if (goalNodes.length <= 1) {
		return board;
	}

	const firstGoal = goalNodes[0];

	if (!firstGoal) {
		return board;
	}

	const keptGoalId = preferredGoalId && goalNodes.some((node) => node.id === preferredGoalId)
		? preferredGoalId
		: firstGoal.id;

	return {
		...board,
		nodes: board.nodes.map((node) => node.data.priority === "goal" && node.id !== keptGoalId
			? setNodePriority(node, "necessary")
			: node)
	};
}

function setNodePriority(node: TechTreeNode, priority: TechTreePriority): TechTreeNode {
	const text = updateNodePriority(node.data.text, priority);
	const parsed = parseNodeText(text);

	return {
		...node,
		data: {
			...node.data,
			text,
			visibleText: parsed.visibleText,
			title: parsed.title,
			priority: parsed.priority,
			priorityOrder: parsed.priorityOrder,
			status: parsed.status,
			statusKind: parsed.statusKind,
			completed: parsed.completed,
			questViewMode: parsed.questViewMode,
			boardPath: parsed.boardPath,
			progressState: getProgressState(parsed, node.data.hasCheckedNeighbor, node.data.locked)
		}
	};
}

function createEmptyCanvas(): CanvasFile {
	return {
		nodes: [],
		edges: []
	};
}

function isCanvasNode(node: unknown): node is CanvasNode {
	if (!node || typeof node !== "object") {
		return false;
	}

	const candidate = node as Partial<CanvasNode>;
	return typeof candidate.id === "string" && typeof candidate.type === "string";
}

function isCanvasTextNode(node: unknown): node is CanvasTextNode {
	if (!isCanvasNode(node)) {
		return false;
	}

	const candidate = node as Partial<CanvasTextNode>;
	return candidate.type === "text"
		&& typeof candidate.id === "string"
		&& typeof candidate.text === "string"
		&& typeof candidate.x === "number"
		&& typeof candidate.y === "number";
}

function isCanvasEdge(edge: unknown): edge is CanvasEdge {
	if (!edge || typeof edge !== "object") {
		return false;
	}

	const candidate = edge as Partial<CanvasEdge>;
	return typeof candidate.id === "string" && typeof candidate.fromNode === "string" && typeof candidate.toNode === "string";
}

function stringifyCanvas(canvas: CanvasFile): string {
	return `${JSON.stringify(canvas, null, 2)}\n`;
}

function cloneCanvasNode(node: CanvasNode): CanvasNode {
	return { ...node };
}

function cloneCanvasEdge(edge: CanvasEdge): CanvasEdge {
	return { ...edge };
}

function mergeCanvasTextNode(sourceNode: CanvasNode | undefined, node: CanvasTextNode): CanvasTextNode {
	return {
		...(sourceNode ?? {}),
		...node
	};
}

function mergeCanvasEdge(sourceEdge: CanvasEdge | undefined, edge: CanvasEdge): CanvasEdge {
	return {
		...(sourceEdge ?? {}),
		...edge
	};
}

function getVisibleNodeText(text: string): string {
	const visibleLines = normalizeLineEndings(text)
		.split("\n")
		.filter((line) => !isHiddenMetadataLine(line));

	while (visibleLines.length > 0 && !visibleLines[0]?.trim()) {
		visibleLines.shift();
	}

	return visibleLines.join("\n")
		.trimEnd();
}

function upsertHiddenMetadata(text: string, key: string, value: string): string {
	const metadata = getHiddenMetadataMap(text);
	metadata.set(key, value);

	return formatNodeText(metadata, getVisibleNodeLines(text));
}

function removeHiddenMetadata(text: string, key: string): string {
	const metadata = getHiddenMetadataMap(text);
	metadata.delete(key);

	return formatNodeText(metadata, getVisibleNodeLines(text));
}

function getHiddenMetadataMap(text: string): Map<string, string> {
	const metadata = new Map<string, string>();

	for (const line of normalizeLineEndings(text).split("\n")) {
		const parsed = parseMetadataLine(line);

		if (parsed && HIDDEN_METADATA_KEYS.has(parsed.key)) {
			metadata.set(parsed.key, parsed.value);
		}
	}

	return metadata;
}

function getVisibleNodeLines(text: string): string[] {
	return normalizeVisibleLines(
		normalizeLineEndings(text)
			.split("\n")
			.filter((line) => !isHiddenMetadataLine(line))
			.join("\n")
	);
}

function normalizeVisibleLines(text: string): string[] {
	const lines = normalizeLineEndings(text).trimEnd().split("\n");

	while (lines.length > 0 && !lines[0]?.trim()) {
		lines.shift();
	}

	while (lines.length > 0 && !lines[lines.length - 1]?.trim()) {
		lines.pop();
	}

	return lines.some((line) => line.trim()) ? lines : ["Untitled note"];
}

function formatNodeText(metadata: Map<string, string>, visibleLines: string[]): string {
	const metadataLines = formatMetadataLines(metadata);
	return [...metadataLines, "", ...normalizeVisibleLines(visibleLines.join("\n"))].join("\n").trimEnd();
}

function formatMetadataLines(metadata: Map<string, string>): string[] {
	const lines: string[] = [];

	for (const key of ORDERED_METADATA_KEYS) {
		const value = metadata.get(key);

		if (value !== undefined) {
			lines.push(`${key}: ${value}`);
		}
	}

	for (const [key, value] of metadata) {
		if (!ORDERED_METADATA_KEYS.includes(key)) {
			lines.push(`${key}: ${value}`);
		}
	}

	return lines;
}

function isHiddenMetadataLine(line: string): boolean {
	const metadata = parseMetadataLine(line);
	return Boolean(metadata && HIDDEN_METADATA_KEYS.has(metadata.key));
}

function parseMetadataLine(line: string): { key: string; value: string } | null {
	const match = METADATA_LINE_PATTERN.exec(line.trim());

	if (!match?.[1]) {
		return null;
	}

	return {
		key: match[1].toLowerCase(),
		value: match[2]?.trim() ?? ""
	};
}

function isDoneStatus(status: string): boolean {
	return status === "done" || status === "complete" || status === "completed";
}

function normalizeStatusKind(status: string | undefined): TechTreeStatusKind {
	const normalized = status?.toLowerCase().trim();

	if (!normalized) {
		return "open";
	}

	if (isDoneStatus(normalized)) {
		return "done";
	}

	if (["in progress", "in-progress", "partial", "started", "doing"].includes(normalized)) {
		return "in-progress";
	}

	if (["blocked", "locked", "missing", "stuck"].some((value) => normalized.includes(value))) {
		return "blocked";
	}

	return "open";
}

function normalizeBooleanMetadata(value: string | undefined): boolean {
	const normalized = value?.toLowerCase().trim();

	return normalized === "true" || normalized === "on" || normalized === "yes" || normalized === "quest";
}

function normalizeBoardPath(value: string | undefined): string | null {
	const normalized = value?.trim();

	return normalized && isCanvasPath(normalized) ? normalized : null;
}

function getCanvasSide(handleId: string | null | undefined, fallback: CanvasSide): CanvasSide {
	const side = normalizeHandleId(handleId, `handle-${fallback}`).split("-").pop();

	return side === "top" || side === "right" || side === "bottom" || side === "left"
		? side
		: fallback;
}

function isCanvasSide(value: string | undefined): value is CanvasSide {
	return value === "top" || value === "right" || value === "bottom" || value === "left";
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

function normalizeLineEndings(text: string): string {
	return text.replace(/\r\n?/g, "\n");
}

function sanitizeBoardName(name: string): string {
	return name
		.trim()
		.replace(/\(metadata\)\.canvas$/i, "")
		.replace(/\.canvas$/i, "")
		.replace(/[\\/:*?"<>|]/g, "-")
		.replace(/\s+/g, " ");
}

function getNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function cloneBoard(board: TechTreeBoard): TechTreeBoard {
	return {
		...board,
		stickyNote: cloneStickyNote(board.stickyNote),
		nodes: board.nodes.map(cloneNode),
		edges: board.edges.map(cloneEdge)
	};
}

function cloneNode(node: TechTreeNode): TechTreeNode {
	return {
		...node,
		position: { ...node.position },
		measured: node.measured ? { ...node.measured } : node.measured,
		style: node.style ? { ...node.style } : node.style,
		data: { ...node.data }
	};
}

function cloneEdge(edge: Edge): Edge {
	return {
		...edge,
		data: edge.data ? { ...edge.data } : edge.data,
		markerStart: edge.markerStart && typeof edge.markerStart === "object" ? { ...edge.markerStart } : edge.markerStart,
		markerEnd: edge.markerEnd && typeof edge.markerEnd === "object" ? { ...edge.markerEnd } : edge.markerEnd,
		style: edge.style ? { ...edge.style } : edge.style
	};
}

function createId(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createMetadataEdgeId(source: string, target: string, sourceSide: CanvasSide, targetSide: CanvasSide): string {
	return `edge-${source}-${sourceSide}-${target}-${targetSide}`;
}
