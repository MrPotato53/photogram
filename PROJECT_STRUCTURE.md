# Photogram - Project Structure

## Overview
A Tauri-based desktop application for creating multi-slide Instagram photo layouts with intelligent positioning, command palette, and template system.

## Tech Stack
- **Framework**: Tauri 2.x (Rust backend + Web frontend)
- **Frontend**: React + TypeScript + Vite
- **Canvas Library**: Konva.js (drag-and-drop, transforms, layers)
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Command Palette**: cmdk (or custom implementation)
- **Backend**: Rust (file I/O, image processing, data persistence)
- **Image Processing**: `image` crate (Rust)
- **Data Storage**: JSON files (projects, templates) via Tauri fs

---

## Directory Structure

```
photogram/
├── src/                              # Frontend (React)
│   ├── components/
│   │   ├── Home/                     # Homepage / Posts list
│   │   │   ├── HomePage.tsx          # Main home view
│   │   │   ├── PostCard.tsx          # Post thumbnail card
│   │   │   ├── NewPostModal.tsx      # Aspect ratio selection
│   │   │   └── AspectRatioSelector.tsx
│   │   │
│   │   ├── Editor/                   # Project editor
│   │   │   ├── EditorLayout.tsx      # Main editor container
│   │   │   ├── Canvas/
│   │   │   │   ├── CanvasArea.tsx    # Konva stage wrapper
│   │   │   │   ├── PhotoElement.tsx  # Draggable/resizable photo
│   │   │   │   ├── Placeholder.tsx   # Template placeholder element
│   │   │   │   ├── AlignmentGuides.tsx
│   │   │   │   ├── SelectionBox.tsx
│   │   │   │   └── TransformHandles.tsx
│   │   │   ├── MediaPool/
│   │   │   │   ├── MediaPool.tsx     # Bottom bar with imported media
│   │   │   │   ├── MediaThumbnail.tsx
│   │   │   │   └── DropZone.tsx      # Drag-drop from file explorer
│   │   │   ├── SlideStrip/
│   │   │   │   ├── SlideStrip.tsx    # Horizontal slide navigation
│   │   │   │   ├── SlideThumb.tsx    # Individual slide preview
│   │   │   │   └── SlideDragHandle.tsx
│   │   │   ├── Layers/
│   │   │   │   ├── LayersPanel.tsx   # Right sidebar layers
│   │   │   │   ├── LayerItem.tsx     # Single layer row
│   │   │   │   └── LayerDragHandle.tsx
│   │   │   ├── Toolbar/
│   │   │   │   ├── Toolbar.tsx       # Top toolbar
│   │   │   │   ├── ScaleSlider.tsx   # Image scale control
│   │   │   │   └── ToolbarButton.tsx
│   │   │   └── Properties/
│   │   │       └── PropertiesPanel.tsx # Selected element properties
│   │   │
│   │   ├── CommandPalette/
│   │   │   ├── CommandPalette.tsx    # Spotlight-style search
│   │   │   ├── CommandItem.tsx
│   │   │   ├── CommandGroup.tsx
│   │   │   └── commands/
│   │   │       ├── index.ts          # Command registry
│   │   │       ├── elementCommands.ts
│   │   │       ├── slideCommands.ts
│   │   │       ├── alignmentCommands.ts
│   │   │       ├── templateCommands.ts
│   │   │       └── navigationCommands.ts
│   │   │
│   │   ├── Templates/
│   │   │   ├── TemplatePicker.tsx    # Template selection modal
│   │   │   ├── TemplateCard.tsx
│   │   │   └── SaveTemplateModal.tsx
│   │   │
│   │   └── common/
│   │       ├── Modal.tsx
│   │       ├── Button.tsx
│   │       ├── Input.tsx
│   │       └── Tooltip.tsx
│   │
│   ├── hooks/
│   │   ├── useCanvas.ts              # Canvas operations
│   │   ├── useKeyboardShortcuts.ts   # Global keyboard handler
│   │   ├── useCommandPalette.ts      # Command palette state
│   │   ├── useClipboard.ts           # Clipboard paste handling
│   │   ├── useDragDrop.ts            # File drag-drop handling
│   │   ├── useAlignment.ts           # Smart alignment/snapping
│   │   ├── useHistory.ts             # Undo/redo
│   │   └── useAutoSave.ts            # Auto-save logic
│   │
│   ├── stores/
│   │   ├── projectStore.ts           # Current project state
│   │   │   # - slides[]
│   │   │   # - currentSlideIndex
│   │   │   # - aspectRatio
│   │   │   # - mediaPool[]
│   │   ├── editorStore.ts            # Editor UI state
│   │   │   # - selectedElementId
│   │   │   # - activeTool
│   │   │   # - panelVisibility
│   │   ├── postsStore.ts             # All saved posts (homepage)
│   │   ├── templatesStore.ts         # Templates by aspect ratio
│   │   ├── historyStore.ts           # Undo/redo stack
│   │   └── commandStore.ts           # Command palette state
│   │
│   ├── services/
│   │   ├── tauri/
│   │   │   ├── projects.ts           # Save/load projects
│   │   │   ├── media.ts              # Import/manage media files
│   │   │   ├── templates.ts          # Template persistence
│   │   │   └── export.ts             # Image export
│   │   └── alignment.ts              # Alignment calculation logic
│   │
│   ├── types/
│   │   ├── project.ts                # Project, Slide, Element types
│   │   ├── template.ts               # Template types
│   │   ├── commands.ts               # Command types
│   │   └── common.ts                 # Shared types
│   │
│   ├── utils/
│   │   ├── geometry.ts               # Position/size calculations
│   │   ├── snapping.ts               # Snap point calculations
│   │   ├── aspectRatios.ts           # Aspect ratio definitions
│   │   └── keyboard.ts               # Shortcut parsing
│   │
│   ├── constants/
│   │   ├── aspectRatios.ts           # Supported ratios + resolutions
│   │   ├── shortcuts.ts              # Keyboard shortcut definitions
│   │   └── defaults.ts               # Default values
│   │
│   ├── App.tsx                       # Router setup
│   ├── main.tsx
│   └── index.css
│
├── src-tauri/                        # Tauri backend (Rust)
│   ├── src/
│   │   ├── main.rs                   # Entry point
│   │   ├── lib.rs                    # Command exports
│   │   ├── commands/
│   │   │   ├── mod.rs
│   │   │   ├── projects.rs           # CRUD for projects
│   │   │   ├── media.rs              # Copy/manage media files
│   │   │   ├── templates.rs          # Template storage
│   │   │   └── export.rs             # Render slides to images
│   │   ├── models/
│   │   │   ├── mod.rs
│   │   │   ├── project.rs            # Project struct
│   │   │   ├── slide.rs              # Slide struct
│   │   │   ├── element.rs            # Element struct
│   │   │   └── template.rs           # Template struct
│   │   └── utils/
│   │       ├── mod.rs
│   │       ├── paths.rs              # App data paths
│   │       └── image.rs              # Image processing
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── public/
│   └── icons/                        # App icons
│
├── data/                             # App data (created at runtime)
│   ├── projects/                     # Saved projects (JSON)
│   ├── templates/                    # User templates (JSON)
│   └── media/                        # Copied media files
│
├── PROJECT_STRUCTURE.md
├── REQUIREMENTS.md
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
└── README.md
```

---

## Core Data Models

### Project
```typescript
interface Project {
  id: string;
  name: string;
  aspectRatio: AspectRatio;
  slides: Slide[];
  mediaPool: MediaItem[];
  createdAt: Date;
  updatedAt: Date;
}
```

### Slide
```typescript
interface Slide {
  id: string;
  elements: Element[];
  order: number;
}
```

### Element
```typescript
interface Element {
  id: string;
  type: 'photo' | 'placeholder';
  mediaId?: string;           // Reference to media pool item
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation: number;
  scale: number;              // Scale relative to bounded frame size
  locked: boolean;
  zIndex: number;
  spanFrames?: number[];      // IDs of frames this element spans
}
```

### Template
```typescript
interface Template {
  id: string;
  name: string;
  aspectRatio: AspectRatio;
  placeholders: PlaceholderDef[];
  createdAt: Date;
}

interface PlaceholderDef {
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation: number;
  zIndex: number;
}
```

---

## Aspect Ratios

| Name | Ratio | Resolution | Use Case |
|------|-------|------------|----------|
| Portrait | 4:5 | 1080 x 1350 | Tallest allowed |
| Square | 1:1 | 1080 x 1080 | Standard |
| Photo | 5:4 | 1080 x 864 | Classic photo |
| Video | 16:9 | 1080 x 608 | Widescreen |
| Landscape | 1.91:1 | 1080 x 566 | Widest allowed |

---

## Command Palette Architecture

```
CommandPalette
├── CommandRegistry (all available commands)
├── ContextFilter (filters based on current state)
├── FuzzySearch (matches user input)
└── CommandExecutor (runs selected command)
```

Commands are registered with:
- `id`: Unique identifier
- `label`: Display text
- `keywords`: Search terms
- `shortcut`: Optional keyboard shortcut
- `context`: When command is available (e.g., 'element-selected')
- `action`: Function to execute

---

## Alignment System

### Snap Points
- Frame edges (left, right, top, bottom)
- Frame center (horizontal, vertical)
- Other element edges
- Other element centers

### Visual Guides
- Red/blue lines appear when aligned
- Distance indicators for equal margins
- Magnetic snapping (configurable threshold)

---

## State Management Flow

```
User Action
    ↓
Zustand Store (projectStore/editorStore)
    ↓
React Components Re-render
    ↓
Konva Canvas Updates
    ↓
Auto-save Trigger (debounced)
    ↓
Tauri Command → File System
```

---

## Development Phases

### Phase 1: Foundation
- [ ] Tauri + React + Vite setup
- [ ] Basic routing (Home ↔ Editor)
- [ ] Aspect ratio selection
- [ ] Project creation and persistence

### Phase 2: Canvas Core
- [ ] Konva canvas with single slide
- [ ] Photo element (drag, resize, rotate)
- [ ] Media pool with drag-drop import
- [ ] Basic snapping (center, edges)

### Phase 3: Multi-Slide
- [ ] Slide strip navigation
- [ ] Add/delete/reorder slides
- [ ] Cross-frame elements

### Phase 4: Layers & Locking
- [ ] Layers panel
- [ ] Layer reordering
- [ ] Element locking

### Phase 5: Command Palette
- [ ] Command palette UI
- [ ] Command registry
- [ ] Keyboard shortcut system
- [ ] Context-aware filtering

### Phase 6: Templates
- [ ] Placeholder element type
- [ ] Save as template
- [ ] Template picker
- [ ] Apply template to slide

### Phase 7: Polish
- [ ] Advanced alignment guides
- [ ] Scale slider
- [ ] Undo/redo
- [ ] Auto-save
- [ ] Export functionality

### Phase 8: Instagram Integration (Future)
- [ ] OAuth flow
- [ ] Direct posting
- [ ] Scheduled posting

---

## File Storage Locations

Using Tauri's app data directory:
- **macOS**: `~/Library/Application Support/com.photogram.app/`
- **Windows**: `%APPDATA%/com.photogram.app/`
- **Linux**: `~/.config/com.photogram.app/`

Structure:
```
app-data/
├── projects/
│   ├── {project-id}.json
│   └── ...
├── templates/
│   ├── 4-5/                  # Grouped by aspect ratio
│   │   ├── {template-id}.json
│   │   └── ...
│   └── 1-1/
│       └── ...
└── media/
    ├── {project-id}/         # Media copied per project
    │   ├── {media-id}.jpg
    │   └── ...
    └── ...
```

---

Review [REQUIREMENTS.md](REQUIREMENTS.md) for detailed feature specifications.
