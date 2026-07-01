import React from "react";
import {
	Notice,
	SuggestModal,
	TextFileView,
	type App,
	type TFile,
	type TFolder,
	type ViewStateResult,
	type WorkspaceLeaf
} from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import {
	TechTreeManager,
	getBoardName,
	isCanvasPath
} from "./TechTreeManager";
import { TechTreeApp, TechTreeBoardPicker } from "./TechTreeView";
import { TECH_TREE_ICON, TECH_TREE_VIEW_TYPE } from "./constants";
import type { TechTreeSettings } from "./settings";

export interface TechTreePluginHost {
	app: App;
	getSettings(): TechTreeSettings;
	onSettingsChange(listener: () => void): () => void;
	createBoardAndOpen(folder?: TFolder, leaf?: WorkspaceLeaf | null, name?: string): Promise<void>;
	openBoardPicker(leaf?: WorkspaceLeaf | null): Promise<void>;
	openBoard(path: string, leaf?: WorkspaceLeaf | null): Promise<void>;
	openCanvasView(path: string, leaf?: WorkspaceLeaf | null): Promise<void>;
}

export class TechTreeItemView extends TextFileView {
	private root: Root | null = null;
	private unsubscribeSettings: (() => void) | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly manager: TechTreeManager,
		private readonly plugin: TechTreePluginHost
	) {
		super(leaf);
		this.allowNoFile = true;
		this.navigation = true;
	}

	getViewType() {
		return TECH_TREE_VIEW_TYPE;
	}

	getDisplayText() {
		return this.file?.basename ?? "Tech tree";
	}

	getIcon() {
		return TECH_TREE_ICON;
	}

	canAcceptExtension(extension: string): boolean {
		return extension === "canvas";
	}

	getViewData(): string {
		if (!this.file) {
			return this.data ?? "";
		}

		return this.manager.getBoardFileData(this.file.path) ?? this.data ?? "";
	}

	setViewData(data: string, clear: boolean): void {
		this.data = data;

		if (clear) {
			this.contentEl.addClass("tech-tree-view-container");
		}

		this.render();
	}

	clear(): void {
		this.data = "";
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		await super.setState(state, result);
		this.render();
	}

	async onOpen() {
		await super.onOpen();
		this.contentEl.empty();
		this.contentEl.addClass("tech-tree-view-container");
		this.unsubscribeSettings?.();
		this.unsubscribeSettings = this.plugin.onSettingsChange(() => {
			this.render();
		});

		this.addAction("folder-open", "Open board", () => {
			void this.plugin.openBoardPicker(this.leaf);
		});
		this.addAction("layout-dashboard", "Open canvas view", () => {
			this.openCanvasView();
		});
		this.render();
	}

	async onClose() {
		await super.onClose();
		this.unsubscribeSettings?.();
		this.unsubscribeSettings = null;
		this.root?.unmount();
		this.root = null;
		this.contentEl.removeClass("tech-tree-view-container");
	}

	handleRename(newPath: string, oldPath: string): void {
		if (this.file?.path !== newPath && this.file?.path !== oldPath) {
			return;
		}

		this.render();
	}

	async onRename(file: TFile): Promise<void> {
		await super.onRename(file);
		this.render();
	}

	private render(): void {
		if (!this.root) {
			this.root = createRoot(this.contentEl);
		}

		const boardPath = this.file && isCanvasPath(this.file.path) ? this.file.path : null;
		const child = boardPath
			? React.createElement(TechTreeApp, {
				boardPath,
				manager: this.manager,
				colorSeries: this.plugin.getSettings().colorSeries,
				onOpenBoard: (path: string) => {
					void this.plugin.openBoard(path, this.leaf);
				}
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
			});

		this.root.render(
			React.createElement(
				React.StrictMode,
				null,
				child
			)
		);
	}

	private openCanvasView(): void {
		if (!this.file) {
			new Notice("Open a tech tree board first.");
			return;
		}

		void this.plugin.openCanvasView(this.file.path, this.leaf);
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
