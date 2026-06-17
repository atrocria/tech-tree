# Tech Tree

Tech Tree is an Obsidian plugin for planning goals as connected canvas boards. It turns regular Obsidian `.canvas` files into progress maps where each text node can be a goal, necessary step, medium-impact item, or quest, and where completion state reveals the next useful work.

<img width="1536" height="864" alt="Tech Tree board screenshot" src="https://github.com/user-attachments/assets/76bb2baf-2cc1-4854-b61c-4364e7c92105" />

Unlike a conventional tech tree or tree graph that usually starts with raw steps and branches forward, Tech Tree works backward from the desired outcome. It treats a goal like something you can reverse engineer: start with the final product, break it into necessary ingredients, then keep decomposing those ingredients into smaller quests. The idea is inspired by first principles thinking, game crafting recipes, and skill trees.
<img width="1616" height="1030" alt="image" src="https://github.com/user-attachments/assets/056901b3-eed8-41c8-8e22-c4f684900c27" />

That means a board is not just a hierarchy. One node can support several future nodes, overlap with other branches, or become reusable material for another part of the tree. It is closer to merging recipes together until the final product becomes achievable: part crafting tree, part skill tree, part goal map.

The plugin keeps its data in the canvas file itself. Node metadata such as `priority`, `connections`, and `status` is stored in text nodes, so boards remain local vault files and can still be opened in Obsidian's native Canvas view.

## What it does

- Creates tech tree boards from the ribbon, command palette, or folder menu.
- Opens existing `.canvas` files as tech trees when they contain a text node with `priority: goal`.
- Lets you add, move, resize, edit, complete, connect, reverse, and remove nodes in a dedicated tech tree view.
- Supports priorities for `goal`, `necessary`, `medium impact`, and `quest` nodes.
- Adds a 0-10 priority order on non-goal nodes, where `1` is highest priority and `0` means no special ordering.
- Tracks progress with `open`, `locked`, and `done` states.
- Locks downstream work until its prerequisites are complete.
- Provides a quest view that flips the tree so actionable steps toward the goal are right in front of you.
- Provides a focus mode that highlights and isolates the current priority path.
- Saves changes back into the underlying Obsidian canvas file.

## How to use

Select the bonsai branch ribbon icon or run **Create board** from the command palette to create a new board.

To open an existing canvas as a tech tree, add a text node containing:

```text
priority: goal

Your goal
```

Then run **Open board**, use the file menu action **Open as tech tree**, or open the canvas directly. Tech Tree will recognize the board and open it in the tech tree view.

Inside a board:

- Use the view action, board menu, or connection flow to create nodes.
- Edit node text directly in the node body.
- Use the priority selector to mark nodes as goals, necessary steps, medium-impact items, or quests.
- Use the priority order badge on a node to guide focus-path ordering.
- Select the checkbox to mark a node done.
- Drag handles between nodes to create dependencies.
- Select an edge to reverse or remove it.
- Use the view actions to add a node, open the native canvas view, or switch boards.

## Node metadata

Tech Tree uses a small metadata block at the top of canvas text nodes:

```text
priority: quest
priority order: 0
status: open

Write the actual note text here.
```

Supported priorities:

- `goal`: the outcome the tree is working toward. A board should have one goal.
- `necessary`: required ingredients that must be true for the goal.
- `medium impact`: useful work that can support progress without being required to unlock necessary work.
- `quest`: actionable steps, experiments, or reusable work that can unlock progress.

Tech Tree also writes `connections` metadata so dependency lines can survive round trips through the canvas file.

## Installation

### Manual install

1. Download `manifest.json`, `main.js`, and `styles.css` from a release.
2. Copy them into your vault at `.obsidian/plugins/tech-tree/`.
3. Reload Obsidian.
4. Enable **Tech Tree** under **Settings → Community plugins**.

### Development install

```bash
npm install
npm run dev
```

For local testing, place this repository inside your vault at:

```text
.obsidian/plugins/tech-tree/
```

Then reload Obsidian and enable the plugin.

## Building

```bash
npm run build
```

The production build writes `main.js` at the repository root. Release assets are:

- `manifest.json`
- `main.js`
- `styles.css`

## Development notes

- Source code lives in `src/`.
- `main.js`, `node_modules/`, `.npm-cache/`, local plugin data, and hot-reload markers are ignored.
- The plugin is desktop-only while it depends on the current canvas-oriented UI.
- The plugin does not make network requests or send vault data anywhere.

## Release checklist

1. Update `version` in `manifest.json`.
2. Update `versions.json` with the matching minimum Obsidian version.
3. Run `npm run build`.
4. Create a GitHub release with a tag that exactly matches the manifest version, without a leading `v`.
5. Attach `manifest.json`, `main.js`, and `styles.css` as release assets.

You can use `npm version patch`, `npm version minor`, or `npm version major` after manually confirming `minAppVersion`; the version script updates `manifest.json` and `versions.json`.

## Privacy

Tech Tree stores all board data in your vault's `.canvas` files. It does not collect analytics, call third-party services, or transmit vault contents.
