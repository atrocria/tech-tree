import React from "react";
import {
	addIcon,
	ItemView,
	Menu,
	Modal,
	Notice,
	Plugin,
	Setting,
	SuggestModal,
	TFile,
	TFolder,
	WorkspaceLeaf,
	type ViewStateResult
} from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import {
	DEFAULT_BOARD_NAME,
	TechTreeManager,
	type CreateTechTreeNodeOptions,
	getBoardName,
	isCanvasPath
} from "./TechTreeManager";
import { TechTreeApp, TechTreeBoardPicker } from "./TechTreeView";
import type { TechTreePriority } from "./types";

export const TECH_TREE_VIEW_TYPE = "tech-tree-view";
const CANVAS_VIEW_TYPE = "canvas";
const TECH_TREE_ICON = "tech-tree-bonsai";
const TECH_TREE_ICON_SVG = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
	<path d="M7 20h10l-1 2H8l-1-2Z"/>
	<path d="M12 20c.8-3.4.2-6.2-1.8-8.5"/>
	<path d="M11.5 15.5c2.4-1.2 4.3-2.9 5.7-5"/>
	<path d="M5.5 8.2c3.3-2.8 8.1-3.5 13-1.8"/>
	<path d="M7.2 11.4c3.7-1.9 7.8-2 11.8-.2"/>
	<path d="M9 5.4c2.4-1.5 5.2-1.9 8.1-1"/>
</svg>`;

type TechTreeBoardMode = "tech-tree" | "canvas";

export default class TechTreePlugin extends Plugin {
	private manager!: TechTreeManager;
	private boardModes = new Map<string, TechTreeBoardMode>();

	async onload() {
		this.manager = TechTreeManager.getInstance(this.app, this);
		addIcon(TECH_TREE_ICON, TECH_TREE_ICON_SVG);

		this.registerView(
			TECH_TREE_VIEW_TYPE,
			(leaf) => new TechTreeItemView(leaf, this.manager, this)
		);

		this.addRibbonIcon(TECH_TREE_ICON, "Open tech tree board", () => {
			void this.openOrCreateFromRibbon();
		});

		this.addCommand({
			id: "create-tech-tree-board",
			name: "Create tech tree board",
			callback: () => {
				void this.createBoardAndOpen();
			}
		});

		this.addCommand({
			id: "open-tech-tree-board",
			name: "Open tech tree board",
			callback: () => {
				void this.openBoardPicker();
			}
		});

		this.addCommand({
			id: "open-active-canvas-as-tech-tree",
			name: "Open active canvas as tech tree",
			checkCallback: (checking) => {
				const activeFile = this.app.workspace.getActiveFile();
				const canOpen = Boolean(activeFile && isCanvasPath(activeFile.path));

				if (checking) {
					return canOpen;
				}

				if (activeFile) {
					void this.openBoard(activeFile.path);
				}

				return true;
			}
		});

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file, _source, leaf) => {
				this.addFileMenuItems(menu, file, leaf);
			})
		);

		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				void this.handleFileOpen(file);
			})
		);

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile) {
					void this.manager.handleCanvasModified(file);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile) {
					this.manager.handleCanvasRenamed(file, oldPath);
					this.updateRenamedViews(file.path, oldPath);
				}
			})
		);
	}

	onunload() {
		this.boardModes.clear();
		this.manager.dispose();
	}

	async createBoardAndOpen(folder?: TFolder, leaf?: WorkspaceLeaf | null, name = DEFAULT_BOARD_NAME) {
		const file = await this.manager.createBoardFile(folder, name);
		await this.openBoard(file.path, leaf);
		new Notice(`Created ${getBoardName(file.path)}.`);
	}

	async openOrCreateFromRibbon(): Promise<void> {
		await this.openBoardPicker();
	}

	async openBoardPicker(leaf?: WorkspaceLeaf | null): Promise<void> {
		const boards = await this.manager.getBoardFiles();

		new TechTreeBoardSuggestModal(this, boards, leaf).open();
	}

	async openBoard(path: string, leaf?: WorkspaceLeaf | null) {
		const file = this.manager.getCanvasFile(path);

		if (!file || !await this.manager.isTechTreeCanvasFile(file)) {
			new Notice("Add a text node with priority: goal to open this canvas as a tech tree.");
			return;
		}

		const targetLeaf = leaf ?? this.findOpenBoardLeaf(path) ?? this.app.workspace.getLeaf("tab");
		this.setBoardMode(targetLeaf, path, "tech-tree");

		await targetLeaf.setViewState({
			type: TECH_TREE_VIEW_TYPE,
			state: { file: path },
			active: true
		});

		await this.app.workspace.revealLeaf(targetLeaf);
	}

	async openCanvasView(path: string, leaf?: WorkspaceLeaf | null): Promise<void> {
		const targetLeaf = leaf ?? this.app.workspace.getLeaf("tab");
		this.setBoardMode(targetLeaf, path, "canvas");

		await targetLeaf.setViewState({
			type: CANVAS_VIEW_TYPE,
			state: { file: path },
			active: true
		});

		await this.app.workspace.revealLeaf(targetLeaf);
	}

	private addFileMenuItems(menu: Menu, file: unknown, leaf?: WorkspaceLeaf) {
		if (file instanceof TFolder) {
			menu.addItem((item) => {
				item
					.setSection("action-primary")
					.setTitle("New tech tree board")
					.setIcon(TECH_TREE_ICON)
					.onClick(() => {
						void this.createBoardAndOpen(file);
					});
			});
			return;
		}

		if (!(file instanceof TFile) || !isCanvasPath(file.path)) {
			return;
		}

		menu.addItem((item) => {
			item
				.setSection("pane")
				.setTitle("Open as tech tree")
				.setIcon(TECH_TREE_ICON)
				.onClick(() => {
					void this.openBoard(file.path, leaf);
				});
		});
	}

	private findOpenBoardLeaf(path: string): WorkspaceLeaf | null {
		let boardLeaf: WorkspaceLeaf | null = null;

		this.app.workspace.iterateRootLeaves((leaf) => {
			const state = leaf.view.getState();

			if (!boardLeaf && leaf.view.getViewType() === TECH_TREE_VIEW_TYPE && state.file === path) {
				boardLeaf = leaf;
			}
		});

		return boardLeaf;
	}

	private updateRenamedViews(newPath: string, oldPath: string): void {
		this.app.workspace.getLeavesOfType(TECH_TREE_VIEW_TYPE).forEach((leaf) => {
			const view = leaf.view;

			if (view instanceof TechTreeItemView) {
				view.handleRename(newPath, oldPath);
			}
		});
	}

	private async handleFileOpen(file: TFile | null): Promise<void> {
		if (!(file instanceof TFile) || !isCanvasPath(file.path)) {
			return;
		}

		const activeLeaf = this.app.workspace.getLeaf(false);

		if (activeLeaf && this.getBoardMode(activeLeaf, file.path) === "canvas") {
			return;
		}

		if (!await this.manager.isTechTreeCanvasFile(file)) {
			return;
		}

		if (activeLeaf?.view.getViewType() === TECH_TREE_VIEW_TYPE) {
			return;
		}

		void this.openBoard(file.path, activeLeaf);
	}

	private getBoardMode(leaf: WorkspaceLeaf, path: string): TechTreeBoardMode | undefined {
		return this.boardModes.get(getBoardModeKey(leaf, path));
	}

	private setBoardMode(leaf: WorkspaceLeaf, path: string, mode: TechTreeBoardMode): void {
		this.boardModes.set(getBoardModeKey(leaf, path), mode);
	}
}

class TechTreeItemView extends ItemView {
	private root: Root | null = null;
	private boardPath: string | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly manager: TechTreeManager,
		private readonly plugin: TechTreePlugin
	) {
		super(leaf);
		this.navigation = true;
	}

	getViewType() {
		return TECH_TREE_VIEW_TYPE;
	}

	getDisplayText() {
		return this.boardPath ? getBoardName(this.boardPath) : "Tech tree";
	}

	getIcon() {
		return TECH_TREE_ICON;
	}

	getState(): Record<string, unknown> {
		return {
			...super.getState(),
			file: this.boardPath
		};
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (state && typeof state === "object" && "file" in state && typeof state.file === "string") {
			this.boardPath = state.file;
		} else {
			this.boardPath = null;
		}

		await super.setState(state, result);
		this.render();
	}

	async onOpen() {
		this.contentEl.empty();
		this.contentEl.addClass("tech-tree-view-container");
		this.addAction("plus-circle", "Add tech tree node", () => {
			this.openAddNodeModal();
		});
		this.addAction("layout-dashboard", "Open canvas view", () => {
			this.openCanvasView();
		});
		this.addAction("folder-open", "Open tech tree board", () => {
			void this.plugin.openBoardPicker(this.leaf);
		});
		this.render();
	}

	async onClose() {
		this.root?.unmount();
		this.root = null;
		this.contentEl.removeClass("tech-tree-view-container");
	}

	handleRename(newPath: string, oldPath: string): void {
		if (this.boardPath !== oldPath) {
			return;
		}

		this.boardPath = newPath;
		this.render();
	}

	private render(): void {
		if (!this.root) {
			this.root = createRoot(this.contentEl);
		}

		this.root.render(
			React.createElement(
				React.StrictMode,
				null,
				this.boardPath && isCanvasPath(this.boardPath)
					? React.createElement(TechTreeApp, {
						boardPath: this.boardPath,
						manager: this.manager
					})
					: React.createElement(TechTreeBoardPicker, {
						boards: this.manager.getKnownBoardFiles().map((file) => ({
							name: getBoardName(file.path),
							path: file.path
						})),
						onCreateBoard: (name?: string) => {
							void this.plugin.createBoardAndOpen(undefined, this.leaf, name);
						},
						onOpenBoard: (path: string) => {
							void this.plugin.openBoard(path, this.leaf);
						}
					})
			)
		);
	}

	private openCanvasView(): void {
		if (!this.boardPath) {
			new Notice("Open a tech tree board first.");
			return;
		}

		void this.plugin.openCanvasView(this.boardPath, this.leaf);
	}

	private openAddNodeModal(): void {
		if (!this.boardPath) {
			new Notice("Open a tech tree board first.");
			return;
		}

		const boardPath = this.boardPath;
		new TechTreeAddNodeModal(this.plugin, (options) => this.manager.addNodeToBoard(boardPath, options)).open();
	}
}

type TechTreeBoardSuggestion =
	| { type: "board"; file: TFile }
	| { type: "create"; name: string };

class TechTreeBoardSuggestModal extends SuggestModal<TechTreeBoardSuggestion> {
	constructor(
		private readonly plugin: TechTreePlugin,
		private readonly boards: TFile[],
		private readonly leaf?: WorkspaceLeaf | null
	) {
		super(plugin.app);
		this.setPlaceholder("Choose a tech tree canvas");
		this.emptyStateText = "Type a board name to create it.";
	}

	getSuggestions(query: string): TechTreeBoardSuggestion[] {
		const trimmedQuery = query.trim();
		const lowerQuery = trimmedQuery.toLowerCase();
		const matchingBoards = this.boards
			.filter((file) => {
				if (!lowerQuery) {
					return true;
				}

				return `${getBoardName(file.path)} ${getBoardDisplayPath(file.path)}`
					.toLowerCase()
					.includes(lowerQuery);
			})
			.map<TechTreeBoardSuggestion>((file) => ({ type: "board", file }));

		if (!trimmedQuery || this.hasExactBoardName(trimmedQuery)) {
			return matchingBoards;
		}

		return [{ type: "create", name: trimmedQuery }, ...matchingBoards];
	}

	renderSuggestion(suggestion: TechTreeBoardSuggestion, el: HTMLElement): void {
		if (suggestion.type === "create") {
			appendSuggestionText(el, `Create "${suggestion.name}"`, "New tech tree board");
			return;
		}

		appendSuggestionText(el, getBoardName(suggestion.file.path), getBoardDisplayPath(suggestion.file.path));
	}

	onChooseSuggestion(suggestion: TechTreeBoardSuggestion): void {
		this.close();

		if (suggestion.type === "create") {
			void this.plugin.createBoardAndOpen(undefined, this.leaf, suggestion.name);
			return;
		}

		void this.plugin.openBoard(suggestion.file.path, this.leaf);
	}

	private hasExactBoardName(name: string): boolean {
		const lowerName = name.toLowerCase();

		return this.boards.some((file) => (
			getBoardName(file.path).toLowerCase() === lowerName
			|| getBoardDisplayPath(file.path).toLowerCase() === lowerName
		));
	}
}

class TechTreeAddNodeModal extends Modal {
	private priority: TechTreePriority = "necessary";
	private text = "truth";

	constructor(
		plugin: TechTreePlugin,
		private readonly onSubmit: (options: CreateTechTreeNodeOptions) => Promise<unknown>
	) {
		super(plugin.app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("tech-tree-add-node-modal");
		contentEl.createEl("h2", { text: "Add tech tree node" });

		new Setting(contentEl)
			.setName("Priority")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("quest", "Quest")
					.addOption("medium impact", "Medium impact")
					.addOption("necessary", "Necessary")
					.addOption("goal", "Goal")
					.setValue(this.priority)
					.onChange((value) => {
						this.priority = value as TechTreePriority;
					});
			});

		new Setting(contentEl)
			.setName("Text")
			.addTextArea((textArea) => {
				textArea
					.setValue(this.text)
					.onChange((value) => {
						this.text = value;
					});
				textArea.inputEl.rows = 6;
				textArea.inputEl.addClass("tech-tree-add-node-modal__text");
			});

		new Setting(contentEl)
			.addButton((button) => {
				button
					.setButtonText("Add node")
					.setCta()
					.onClick(() => {
						void this.submit();
					});
			})
			.addButton((button) => {
				button
					.setButtonText("Cancel")
					.onClick(() => this.close());
			});
	}

	private async submit(): Promise<void> {
		if (!this.text.trim()) {
			new Notice("Add node text first.");
			return;
		}

		try {
			await this.onSubmit({
				priority: this.priority,
				text: this.text
			});
			this.close();
		} catch (error) {
			console.error("Failed to add tech tree node", error);
			new Notice("Unable to add tech tree node.");
		}
	}
}

function appendSuggestionText(el: HTMLElement, title: string, note: string): void {
	const titleEl = document.createElement("div");
	titleEl.className = "tech-tree-suggest__title";
	titleEl.textContent = title;
	el.appendChild(titleEl);

	const noteEl = document.createElement("small");
	noteEl.className = "tech-tree-suggest__note";
	noteEl.textContent = note;
	el.appendChild(noteEl);
}

function getBoardDisplayPath(path: string): string {
	const parts = path.split("/");
	const fileName = parts.pop();
	const displayFileName = `${getBoardName(path)}.canvas`;

	return [...parts, fileName ? displayFileName : path].join("/");
}

function getBoardModeKey(leaf: WorkspaceLeaf, path: string): string {
	return `${getLeafId(leaf) ?? "path"}:${path}`;
}

function getLeafId(leaf: WorkspaceLeaf): string | undefined {
	return (leaf as WorkspaceLeaf & { id?: string }).id;
}
