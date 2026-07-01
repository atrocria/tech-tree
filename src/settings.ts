export type TechTreeColorSeries = "winter" | "summer" | "autumn" | "spring" | "night";

export type TechTreeSettings = {
	colorSeries: TechTreeColorSeries;
};

export const DEFAULT_TECH_TREE_SETTINGS: TechTreeSettings = {
	colorSeries: "winter"
};

export const TECH_TREE_COLOR_SERIES_OPTIONS: Record<TechTreeColorSeries, string> = {
	winter: "Winter",
	summer: "Summer",
	autumn: "Autumn",
	spring: "Spring",
	night: "Night time"
};

export function normalizeTechTreeSettings(settings: unknown): TechTreeSettings {
	if (!isRecord(settings)) {
		return { ...DEFAULT_TECH_TREE_SETTINGS };
	}

	return {
		colorSeries: normalizeColorSeries(settings.colorSeries)
	};
}

export function isTechTreeColorSeries(value: unknown): value is TechTreeColorSeries {
	return value === "winter" || value === "summer" || value === "autumn" || value === "spring" || value === "night";
}

function normalizeColorSeries(value: unknown): TechTreeColorSeries {
	return isTechTreeColorSeries(value) ? value : DEFAULT_TECH_TREE_SETTINGS.colorSeries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
