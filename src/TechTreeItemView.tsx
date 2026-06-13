import React from "react";
import {
	ItemView,
	Modal,
	Notice,
	Setting,
	SuggestModal,
	type App,
	type TFile,
	type TFolder,
	type ViewStateResult,
	type WorkspaceLeaf
} from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import {
	TechTreeManager,
	type CreateTechTreeNodeOptions,
	getBoardName,
	isCanvasPath
} from "./TechTreeManager";
import { TechTreeApp, TechTreeBoardPicker } from "./TechTreeView";
import { TECH_TREE_ICON, TECH_TREE_VIEW_TYPE } from "./constants";
import type { TechTreePriority } from "./types";

export interface TechTreePluginHost {
	app: App;
	createBoardAndOpen(folder?: TFolder, leaf?: WorkspaceLeaf | null, name?: string): Promise<void>;
	openBoardPicker(leaf?: WorkspaceLeaf | null): Promise<void>;
	openBoard(path: string, leaf?: WorkspaceLeaf | null): Promise<void>;
	openCanvasView(path: string, leaf?: WorkspaceLeaf | null): Promise<void>;
}

export class TechTreeItemView extends ItemView {
	private root: Root | null = null;
	private boardPath: string | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly manager: TechTreeManager,
		private readonly plugin: TechTreePluginHost
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
		this.addAction("folder-open", "Open board", () => {
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
		new TechTreeAddNodeModal(this.plugin.app, (options) => this.manager.addNodeToBoard(boardPath, options)).open();
	}
}

type TechTreeBoardSuggestion =
	| { type: "board"; file: TFile }
	| { type: "create"; name: string };

export class TechTreeBoardSuggestModal extends SuggestModal<TechTreeBoardSuggestion> {
	constructor(
		private readonly plugin: TechTreePluginHost,
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
		app: App,
		private readonly onSubmit: (options: CreateTechTreeNodeOptions) => Promise<unknown>
	) {
		super(app);
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
