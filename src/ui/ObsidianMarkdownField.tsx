import { Component, MarkdownRenderer, type App } from "obsidian";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";

type ObsidianMarkdownFieldProps = {
	app: App;
	sourcePath: string;
	markdown: string;
	className: string;
	placeholder?: string;
	readOnly?: boolean;
	insertTaskRequest?: number;
	onDraft?: (markdown: string) => void;
	onCommit?: (markdown: string) => void;
};

type MarkdownPreviewProps = {
	app: App;
	sourcePath: string;
	markdown: string;
	placeholder?: string;
	readOnly: boolean;
	onEdit: () => void;
	onToggle: (taskIndex: number, checked: boolean) => void;
};

type TextSelection = {
	start: number;
	end: number;
};

export function ObsidianMarkdownField({
	app,
	sourcePath,
	markdown,
	className,
	placeholder,
	readOnly = false,
	insertTaskRequest,
	onDraft,
	onCommit
}: ObsidianMarkdownFieldProps) {
	const rootRef = useRef<HTMLDivElement | null>(null);
	const sourceRef = useRef<HTMLTextAreaElement | null>(null);
	const valueRef = useRef(normalizeMarkdown(markdown));
	const editingRef = useRef(false);
	const selectionRef = useRef<TextSelection>({
		start: valueRef.current.length,
		end: valueRef.current.length
	});
	const handledTaskRequestRef = useRef(insertTaskRequest);
	const [value, setValue] = useState(valueRef.current);
	const [isEditing, setIsEditing] = useState(false);

	useEffect(() => {
		if (editingRef.current) {
			return;
		}

		const next = normalizeMarkdown(markdown);

		if (next === valueRef.current) {
			return;
		}

		valueRef.current = next;
		selectionRef.current = {
			start: next.length,
			end: next.length
		};
		setValue(next);
	}, [markdown]);

	useEffect(() => {
		const textarea = sourceRef.current;

		if (!isEditing || !textarea) {
			return;
		}

		const selection = clampSelection(selectionRef.current, textarea.value.length);
		textarea.focus();
		textarea.setSelectionRange(selection.start, selection.end);
	}, [isEditing]);

	const updateValue = useCallback((next: string) => {
		valueRef.current = next;
		setValue(next);
		onDraft?.(next);
	}, [onDraft]);

	const startEditing = useCallback(() => {
		if (readOnly) {
			return;
		}

		editingRef.current = true;
		selectionRef.current = {
			start: valueRef.current.length,
			end: valueRef.current.length
		};
		setIsEditing(true);
	}, [readOnly]);

	const finishEditing = useCallback(() => {
		window.setTimeout(() => {
			if (rootRef.current?.contains(document.activeElement)) {
				return;
			}

			editingRef.current = false;
			setIsEditing(false);
			onCommit?.(valueRef.current);
		}, 0);
	}, [onCommit]);

	const toggleTask = useCallback((taskIndex: number, checked: boolean) => {
		const next = updateTaskAtIndex(valueRef.current, taskIndex, checked);
		updateValue(next);
		onCommit?.(next);
	}, [onCommit, updateValue]);

	useEffect(() => {
		if (insertTaskRequest === undefined || handledTaskRequestRef.current === insertTaskRequest) {
			return;
		}

		handledTaskRequestRef.current = insertTaskRequest;
		const wasEditing = editingRef.current;
		const selection = wasEditing
			? clampSelection(selectionRef.current, valueRef.current.length)
			: {
				start: valueRef.current.length,
				end: valueRef.current.length
			};
		const insertion = wasEditing
			? addTaskAtSelection(valueRef.current, selection)
			: appendTask(valueRef.current);

		editingRef.current = true;
		selectionRef.current = {
			start: insertion.caret,
			end: insertion.caret
		};
		updateValue(insertion.markdown);
		setIsEditing(true);
	}, [insertTaskRequest, updateValue]);

	const handleChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
		const textarea = event.currentTarget;
		selectionRef.current = {
			start: textarea.selectionStart,
			end: textarea.selectionEnd
		};
		updateValue(textarea.value);
	}, [updateValue]);

	const rememberSelection = useCallback((event: React.SyntheticEvent<HTMLTextAreaElement>) => {
		const textarea = event.currentTarget;
		selectionRef.current = {
			start: textarea.selectionStart,
			end: textarea.selectionEnd
		};
	}, []);

	const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Tab") {
			if (
				event.shiftKey
				|| event.currentTarget.selectionStart !== event.currentTarget.selectionEnd
			) {
				return;
			}

			event.preventDefault();
			const next = replaceSelection(
				event.currentTarget.value,
				event.currentTarget.selectionStart,
				event.currentTarget.selectionEnd,
				"\t"
			);
			selectionRef.current = {
				start: next.caret,
				end: next.caret
			};
			updateValue(next.markdown);
			window.requestAnimationFrame(() => {
				sourceRef.current?.setSelectionRange(next.caret, next.caret);
			});
			return;
		}

		if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
			return;
		}

		const textarea = event.currentTarget;
		const line = getLineAtOffset(textarea.value, textarea.selectionStart);

		if (isEmptyListItem(line.text)) {
			event.preventDefault();
			const next = replaceRange(textarea.value, line.start, line.end, "");
			selectionRef.current = {
				start: line.start,
				end: line.start
			};
			updateValue(next);
			window.requestAnimationFrame(() => {
				sourceRef.current?.setSelectionRange(line.start, line.start);
			});
			return;
		}

		const continuation = getListContinuation(line.text);

		if (!continuation) {
			return;
		}

		event.preventDefault();
		const next = replaceSelection(
			textarea.value,
			textarea.selectionStart,
			textarea.selectionEnd,
			`\n${continuation}`
		);
		selectionRef.current = {
			start: next.caret,
			end: next.caret
		};
		updateValue(next.markdown);
		window.requestAnimationFrame(() => {
			sourceRef.current?.setSelectionRange(next.caret, next.caret);
		});
	}, [updateValue]);

	return (
		<div
			ref={rootRef}
			className={`${className} tech-tree-markdown-field`}
			onPointerDown={(event) => event.stopPropagation()}
			onClick={(event) => {
				if (event.target === event.currentTarget && !hasTextSelection()) {
					startEditing();
				}
			}}
		>
			{isEditing && !readOnly ? (
				<textarea
					ref={sourceRef}
					className="tech-tree-markdown-field__source"
					value={value}
					placeholder={placeholder}
					spellCheck
					onBlur={finishEditing}
					onChange={handleChange}
					onKeyDown={handleKeyDown}
					onSelect={rememberSelection}
				/>
			) : (
				<MarkdownPreview
					app={app}
					sourcePath={sourcePath}
					markdown={value}
					placeholder={placeholder}
					readOnly={readOnly}
					onEdit={startEditing}
					onToggle={toggleTask}
				/>
			)}
		</div>
	);
}

const MarkdownPreview = memo(function MarkdownPreview({
	app,
	sourcePath,
	markdown,
	placeholder,
	readOnly,
	onEdit,
	onToggle
}: MarkdownPreviewProps) {
	const previewRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const container = previewRef.current;

		if (!container || !markdown) {
			return;
		}

		const component = new Component();
		let disposed = false;
		component.load();

		const toggleTask = (event: Event) => {
			const checkbox = event.target;

			if (readOnly || !(checkbox instanceof HTMLInputElement) || checkbox.type !== "checkbox") {
				return;
			}

			const taskCheckboxes = Array.from(
				container.querySelectorAll<HTMLInputElement>("input[type='checkbox']")
			);
			const taskIndex = taskCheckboxes.indexOf(checkbox);

			if (taskIndex < 0) {
				return;
			}

			event.stopImmediatePropagation();
			onToggle(taskIndex, checkbox.checked);
		};

		container.addEventListener("change", toggleTask, true);
		void MarkdownRenderer.render(app, markdown, container, sourcePath, component).then(() => {
			if (!disposed) {
				container.querySelectorAll<HTMLInputElement>("input[type='checkbox']")
					.forEach((checkbox) => checkbox.disabled = readOnly);
			}
		});

		return () => {
			disposed = true;
			container.removeEventListener("change", toggleTask, true);
			component.unload();
			container.replaceChildren();
		};
	}, [app, markdown, onToggle, readOnly, sourcePath]);

	return (
		<div
			ref={previewRef}
			className={[
				"tech-tree-markdown-field__preview",
				markdown ? "markdown-rendered" : "is-empty",
				!markdown && placeholder ? "is-placeholder" : ""
			].filter(Boolean).join(" ")}
			data-placeholder={placeholder}
			onClick={(event) => {
				const target = event.target;

				if (
					(!(target instanceof Element) || !target.closest("a, input, button"))
					&& !hasTextSelection()
				) {
					event.stopPropagation();
					onEdit();
				}
			}}
		/>
	);
});

function normalizeMarkdown(markdown: string): string {
	return markdown.replace(/\r\n?/g, "\n");
}

function clampSelection(selection: TextSelection, length: number): TextSelection {
	return {
		start: Math.min(length, Math.max(0, selection.start)),
		end: Math.min(length, Math.max(0, selection.end))
	};
}

function hasTextSelection(): boolean {
	const selection = window.getSelection();
	return Boolean(selection && !selection.isCollapsed);
}

function updateTaskAtIndex(markdown: string, taskIndex: number, checked: boolean): string {
	let currentTaskIndex = 0;

	return markdown.split("\n")
		.map((line) => {
			if (!/^(\s*(?:[-*+]|\d+\.)\s+\[)[ xX](\])/.test(line)) {
				return line;
			}

			if (currentTaskIndex++ !== taskIndex) {
				return line;
			}

			return line.replace(
				/^(\s*(?:[-*+]|\d+\.)\s+\[)[ xX](\])/,
				`$1${checked ? "x" : " "}$2`
			);
		})
		.join("\n");
}

function addTaskAtSelection(markdown: string, selection: TextSelection): { markdown: string; caret: number } {
	const line = getLineAtOffset(markdown, selection.start);
	const taskPrefix = line.text.match(/^(\s*(?:[-*+]|\d+\.)\s+\[[ xX]\]\s*)/)?.[1];

	if (taskPrefix) {
		return {
			markdown,
			caret: line.start + taskPrefix.length
		};
	}

	if (line.text.length > 0) {
		const next = replaceRange(markdown, line.start, line.start, "- [ ] ");
		return {
			markdown: next,
			caret: selection.start + 6
		};
	}

	if (markdown.length === 0 || selection.start < markdown.length) {
		const next = replaceRange(markdown, line.start, line.end, "- [ ] ");
		return {
			markdown: next,
			caret: line.start + 6
		};
	}

	const separator = markdown.endsWith("\n") ? "" : "\n";
	const next = `${markdown}${separator}- [ ] `;
	return {
		markdown: next,
		caret: next.length
	};
}

function appendTask(markdown: string): { markdown: string; caret: number } {
	const separator = markdown.length === 0 || markdown.endsWith("\n") ? "" : "\n";
	const next = `${markdown}${separator}- [ ] `;

	return {
		markdown: next,
		caret: next.length
	};
}

function replaceSelection(
	markdown: string,
	start: number,
	end: number,
	replacement: string
): { markdown: string; caret: number } {
	return {
		markdown: replaceRange(markdown, start, end, replacement),
		caret: start + replacement.length
	};
}

function replaceRange(markdown: string, start: number, end: number, replacement: string): string {
	return `${markdown.slice(0, start)}${replacement}${markdown.slice(end)}`;
}

function getLineAtOffset(markdown: string, offset: number): { text: string; start: number; end: number } {
	const safeOffset = Math.min(markdown.length, Math.max(0, offset));
	const start = markdown.lastIndexOf("\n", Math.max(0, safeOffset - 1)) + 1;
	const newline = markdown.indexOf("\n", safeOffset);
	const end = newline < 0 ? markdown.length : newline;

	return {
		text: markdown.slice(start, end),
		start,
		end
	};
}

function isEmptyListItem(line: string): boolean {
	return /^\s*(?:[-*+]|\d+\.)\s*(?:\[[ xX]\]\s*)?$/.test(line);
}

function getListContinuation(line: string): string {
	const task = line.match(/^(\s*(?:[-*+]|\d+\.)\s+)\[[ xX]\]\s+/);

	if (task) {
		return `${task[1]}[ ] `;
	}

	const bullet = line.match(/^(\s*)([-*+]|\d+\.)\s+/);

	if (!bullet) {
		return "";
	}

	const marker = bullet[2]!.endsWith(".")
		? `${Number.parseInt(bullet[2]!, 10) + 1}.`
		: bullet[2]!;
	return `${bullet[1]}${marker} `;
}
