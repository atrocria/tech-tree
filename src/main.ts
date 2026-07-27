import {
	addIcon,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	TFolder,
	type App,
	type Menu,
	type ViewState,
	type WorkspaceLeaf
} from "obsidian";
import {
	DEFAULT_BOARD_NAME,
	TechTreeManager,
	getBoardName,
	isCanvasPath
} from "./TechTreeManager";
import { TechTreeBoardSuggestModal, TechTreeItemView } from "./TechTreeItemView";
import { CANVAS_VIEW_TYPE, TECH_TREE_ICON, TECH_TREE_VIEW_TYPE } from "./constants";
import {
	DEFAULT_TECH_TREE_SETTINGS,
	TECH_TREE_COLOR_SERIES_OPTIONS,
	isTechTreeColorSeries,
	normalizeTechTreeSettings,
	type TechTreeSettings
} from "./settings";
import bonsaiRibbonIcon from "./assets/bonsai_ribbon.svg";

type TechTreeBoardMode = "tech-tree" | "canvas";

export default class TechTreePlugin extends Plugin {
	private manager!: TechTreeManager;
	private boardModes = new WeakMap<WorkspaceLeaf, Map<string, TechTreeBoardMode>>();
	private pluginSettings: TechTreeSettings = { ...DEFAULT_TECH_TREE_SETTINGS };
	private settingsListeners = new Set<() => void>();

	async onload() {
		await this.loadSettings();
		this.manager = TechTreeManager.getInstance(this.app);
		addIcon(TECH_TREE_ICON, bonsaiRibbonIcon);
		this.addSettingTab(new TechTreeSettingsTab(this.app, this));

		this.registerView(
			TECH_TREE_VIEW_TYPE,
			(leaf) => new TechTreeItemView(leaf, this.manager, this)
		);

		this.addRibbonIcon(TECH_TREE_ICON, "Open board", () => {
			void this.openOrCreateFromRibbon();
		});

		this.addCommand({
			id: "create-board",
			name: "Create board",
			callback: () => {
				void this.createBoardAndOpen();
			}
		});

		this.addCommand({
			id: "open-board",
			name: "Open board",
			callback: () => {
				void this.openBoardPicker();
			}
		});

		this.addCommand({
			id: "open-active-canvas",
			name: "Open active canvas",
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

	unload(): void {
		super.unload();
		void this.restoreCanvasViewsForUnload();
	}

	onunload() {
		this.boardModes = new WeakMap();
		this.settingsListeners.clear();
		void this.manager.dispose();
	}

	getSettings(): TechTreeSettings {
		return this.pluginSettings;
	}

	onSettingsChange(listener: () => void): () => void {
		this.settingsListeners.add(listener);

		return () => {
			this.settingsListeners.delete(listener);
		};
	}

	async updateSettings(settings: Partial<TechTreeSettings>): Promise<void> {
		this.pluginSettings = normalizeTechTreeSettings({
			...this.pluginSettings,
			...settings
		});
		await this.saveSettings();
		this.notifySettingsChanged();
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

		const targetLeaf = leaf
			?? this.findOpenBoardLeaf(path)
			?? this.app.workspace.getLeaf("tab");
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

	private async detachLeafSafely(leaf: WorkspaceLeaf): Promise<void> {
		try {
			await Promise.resolve(leaf.detach());
		} catch (error) {
			console.error("Failed to detach duplicate tech tree view", error);
		}
	}

	private async restoreCanvasViewsForUnload(): Promise<void> {
		await Promise.all(this.app.workspace
			.getLeavesOfType(TECH_TREE_VIEW_TYPE)
			.map((leaf) => this.restoreCanvasViewForUnload(leaf)));
	}

	private async restoreCanvasViewForUnload(leaf: WorkspaceLeaf): Promise<void> {
		const state = leaf.view.getState();
		const file = getViewStateFile(state);

		if (!file || !isCanvasPath(file)) {
			await this.detachLeafSafely(leaf);
			return;
		}

		this.setBoardMode(leaf, file, "canvas");

		try {
			await leaf.setViewState(
				{
					type: CANVAS_VIEW_TYPE,
					state: { ...state, file },
					popstate: true
				} as ViewState,
				{ focus: false }
			);
		} catch (error) {
			console.error("Failed to restore canvas view for tech tree", error);
			await this.detachLeafSafely(leaf);
		}
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

		if (activeLeaf?.view.getViewType() === TECH_TREE_VIEW_TYPE) {
			return;
		}

		if (!await this.manager.isTechTreeCanvasFile(file)) {
			return;
		}

		void this.openBoard(file.path, activeLeaf);
	}

	private getBoardMode(leaf: WorkspaceLeaf, path: string): TechTreeBoardMode | undefined {
		return this.boardModes.get(leaf)?.get(path);
	}

	private setBoardMode(leaf: WorkspaceLeaf, path: string, mode: TechTreeBoardMode): void {
		const leafModes = this.boardModes.get(leaf) ?? new Map<string, TechTreeBoardMode>();
		leafModes.set(path, mode);
		this.boardModes.set(leaf, leafModes);
	}

	private async loadSettings(): Promise<void> {
		const data = getPluginDataRecord(await this.loadData());
		this.pluginSettings = normalizeTechTreeSettings(data.settings);
	}

	private async saveSettings(): Promise<void> {
		const data = getPluginDataRecord(await this.loadData());
		await this.saveData({
			...data,
			settings: this.pluginSettings
		});
	}

	private notifySettingsChanged(): void {
		for (const listener of this.settingsListeners) {
			listener();
		}
	}
}

class TechTreeSettingsTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: TechTreePlugin
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Color series")
			.setDesc("Sets the completion color series.")
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(TECH_TREE_COLOR_SERIES_OPTIONS)) {
					dropdown.addOption(value, label);
				}

				dropdown
					.setValue(this.plugin.getSettings().colorSeries)
					.onChange(async (value) => {
						if (!isTechTreeColorSeries(value)) {
							return;
						}

						await this.plugin.updateSettings({
							colorSeries: value
						});
					});
			});
	}
}

function getPluginDataRecord(data: unknown): Record<string, unknown> {
	return typeof data === "object" && data !== null && !Array.isArray(data)
		? data as Record<string, unknown>
		: {};
}

function getViewStateFile(state: unknown): string | null {
	const record = getPluginDataRecord(state);
	return typeof record.file === "string" ? record.file : null;
}
