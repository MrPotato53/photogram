# Photogram - Development Context

> Quick reference for maintaining context across development sessions.

## Project Overview

**Purpose:** Desktop app for creating Instagram photo layouts (multi-slide posts with photos on white backgrounds) with planned Instagram API integration for scheduled posting.

**Tech Stack:**
- **Framework:** Tauri 2.x (Rust backend + React frontend)
- **Frontend:** React 18 + TypeScript + Vite
- **Canvas:** Konva.js (planned for editor)
- **Styling:** Tailwind CSS (dark mode default)
- **State:** Zustand
- **Data:** JSON files in Tauri app data directory

---

## Current Implementation Status

### Completed (Phase 1 - Homepage)
- [x] Project scaffolding (Tauri + React + Vite + Tailwind)
- [x] Homepage with project grid
- [x] New project modal (name, aspect ratio, photo import)
- [x] Project cards with thumbnails and metadata
- [x] Context menu (right-click) for rename/delete
- [x] Delete confirmation dialog
- [x] Preferences modal with light/dark mode
- [x] Sort dropdown (recency, date, name) - persisted
- [x] Tab system for multi-project editing
- [x] Rust backend: project CRUD, preferences, media import
- [x] Duplicate project name validation

### Completed (Phase 2 - Editor Layout)
- [x] EditorLayout with toolbar and floating panels
- [x] EditorToolbar with panel toggle buttons
- [x] CanvasArea with aspect-ratio-aware sizing
- [x] FloatingPanel - draggable, resizable panel wrapper
- [x] MediaPoolPanel placeholder (shows media grid)
- [x] LayersPanel placeholder (shows elements)
- [x] TemplatesPanel placeholder
- [x] editorStore for editor state management

### In Progress (Phase 2 - Editor Functionality)
- [ ] Photo manipulation (drag, resize, rotate)
- [ ] Media import in editor
- [ ] Konva.js canvas integration

### Not Started
- [ ] Intelligent snapping/alignment
- [ ] Cross-frame elements
- [ ] Layer reordering
- [ ] Command palette (Cmd+K)
- [ ] Templates system
- [ ] SlideStrip (multi-slide navigation)
- [ ] Export functionality
- [ ] Instagram API integration

---

## Directory Structure

```
photogram/
├── src/                              # React frontend
│   ├── components/
│   │   ├── Home/
│   │   │   ├── HomePage.tsx          # Main grid view
│   │   │   ├── ProjectCard.tsx       # Card with context menu
│   │   │   ├── NewProjectCard.tsx    # "+ New" button card
│   │   │   ├── NewProjectModal.tsx   # Create project form
│   │   │   ├── RenameModal.tsx
│   │   │   └── PreferencesModal.tsx  # Light/dark toggle
│   │   ├── Editor/
│   │   │   ├── EditorLayout.tsx      # Main editor container
│   │   │   ├── EditorToolbar.tsx     # Top bar with panel toggles
│   │   │   ├── CanvasArea.tsx        # White canvas, aspect-ratio aware
│   │   │   ├── FloatingPanel.tsx     # Draggable/resizable panel wrapper
│   │   │   └── panels/
│   │   │       ├── MediaPoolPanel.tsx
│   │   │       ├── LayersPanel.tsx
│   │   │       └── TemplatesPanel.tsx
│   │   ├── common/                   # Reusable UI components
│   │   │   ├── Modal.tsx
│   │   │   ├── Button.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Select.tsx
│   │   │   ├── ContextMenu.tsx
│   │   │   └── ConfirmDialog.tsx
│   │   └── TabBar.tsx                # Project tabs navigation
│   ├── stores/
│   │   ├── projectsStore.ts          # Project list state
│   │   ├── preferencesStore.ts       # Theme, sort preference
│   │   └── tabsStore.ts              # Open tabs state
│   ├── services/
│   │   └── tauri.ts                  # Tauri command wrappers
│   ├── types/
│   │   └── index.ts                  # TypeScript interfaces
│   ├── constants/
│   │   └── aspectRatios.ts           # 4:5, 1:1, 16:9, etc.
│   ├── App.tsx                       # Root with tab routing
│   ├── main.tsx                      # Entry point
│   └── index.css                     # Tailwind + global styles
│
├── src-tauri/                        # Rust backend
│   ├── src/
│   │   ├── main.rs                   # Entry point
│   │   ├── lib.rs                    # Plugin init + command handlers
│   │   ├── commands/
│   │   │   └── mod.rs                # All Tauri commands
│   │   └── models/
│   │       └── mod.rs                # Project, Slide, Element, etc.
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── CONTEXT.md                        # This file
├── REQUIREMENTS.md                   # Detailed feature specs
├── PROJECT_STRUCTURE.md              # Full architecture details
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── tsconfig.json
```

---

## Key Data Models

```typescript
// Project (stored as JSON in app data dir)
interface Project {
  id: string;
  name: string;
  aspectRatio: { width: number; height: number; name: string };
  slides: Slide[];
  mediaPool: MediaItem[];
  createdAt: string;
  updatedAt: string;
  accessedAt: string;
  thumbnail: string | null;
}

// Slide
interface Slide {
  id: string;
  elements: Element[];
  order: number;
}

// Element (photo or placeholder on canvas)
interface Element {
  id: string;
  type: 'photo' | 'placeholder';
  mediaId?: string;
  x: number; y: number;
  width: number; height: number;
  rotation: number;
  scale: number;
  locked: boolean;
  zIndex: number;
  spanFrames?: string[];  // For cross-frame elements
}

// Preferences (persisted)
interface Preferences {
  theme: 'light' | 'dark';
  sortBy: 'accessedAt' | 'createdAt' | 'name';
}
```

---

## Tauri Commands (Rust → Frontend)

| Command | Description |
|---------|-------------|
| `get_all_projects` | Returns ProjectSummary[] for homepage |
| `get_project(id)` | Returns full Project, updates accessedAt |
| `create_project(name, aspectRatio)` | Creates new project with 1 empty slide |
| `update_project(project)` | Saves project changes |
| `delete_project(id)` | Removes project + media files |
| `rename_project(id, newName)` | Updates project name |
| `import_media_files(projectId, paths)` | Copies files to app data, returns MediaItem[] |
| `get_preferences` | Returns Preferences |
| `save_preferences(prefs)` | Persists Preferences |

---

## Aspect Ratios

| Name | Ratio | Resolution |
|------|-------|------------|
| Portrait | 4:5 | 1080 x 1350 |
| Square | 1:1 | 1080 x 1080 |
| Photo | 5:4 | 1080 x 864 |
| Video | 16:9 | 1080 x 608 |
| Landscape | 1.91:1 | 1080 x 566 |
| Custom | user-defined | calculated |

---

## App Data Location

- **macOS:** `~/Library/Application Support/com.photogram.app/`
- **Windows:** `%APPDATA%/com.photogram.app/`
- **Linux:** `~/.config/com.photogram.app/`

Structure:
```
app-data/
├── projects/{id}.json
├── media/{projectId}/{mediaId}.jpg
├── templates/{aspectRatio}/{id}.json
└── preferences.json
```

---

## Design Decisions

1. **Tab-based navigation:** Homepage is always a tab (house icon). Projects open as closable tabs.
2. **Double-click to open:** Single click selects, double-click opens in new tab.
3. **Context menu:** Right-click OR 3-dots button on hover for rename/delete.
4. **Dark mode default:** Light mode available via preferences.
5. **Sort persistence:** Sort preference saved to preferences.json.
6. **Media copied to app data:** Original files untouched, copies stored per-project.
7. **Aspect ratio locked:** Cannot change after project creation.
8. **Max 20 slides:** Per Instagram carousel limit.

---

## Next Steps (Editor Implementation)

1. **EditorLayout.tsx** - Main container with panels
2. **CanvasArea.tsx** - Konva stage for current slide
3. **MediaPool.tsx** - Bottom bar with imported photos
4. **SlideStrip.tsx** - Horizontal slide thumbnails
5. **Photo drag/resize** - Konva Transformer
6. **Snapping system** - Center, edges, equal margins
7. **Layers panel** - Z-order management
8. **Command palette** - Cmd+K fuzzy search

---

## Running the App

```bash
# Install dependencies
npm install

# Development (requires Rust/Cargo)
npm run tauri dev

# Build
npm run tauri build

# Frontend only (no Tauri)
npm run dev
```

---

## Key Files to Read First

When resuming development:
1. `CONTEXT.md` - This file (quick overview)
2. `REQUIREMENTS.md` - Detailed feature specs
3. `src/types/index.ts` - All TypeScript interfaces
4. `src-tauri/src/commands/mod.rs` - Backend API
5. `src/stores/` - State management
