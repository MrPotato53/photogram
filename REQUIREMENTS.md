# Photogram - Requirements Document

## Application Overview
A desktop application for creating multi-slide Instagram photo layouts with intelligent positioning, templates, and keyboard-driven workflow.

---

## 1. Homepage / Posts Management

### 1.1 Posts List View
- Display all existing posts as thumbnails/cards
- Show post metadata: date created, slide count, aspect ratio
- Click to open and edit existing post
- Delete posts

### 1.2 New Post Creation
- "Add New Post" button
- **Aspect ratio selection** (required, locked after creation):
  - 4:5 (Portrait - 1080x1350)
  - 1:1 (Square - 1080x1080)
  - 1.91:1 (Landscape - 1080x566)
  - Other common ratios in between (e.g., 5:4, 16:9)
- Option to import initial photos or start empty
- Creates post with 1 slide by default

---

## 1.3 Tab Navigation
- **Multi-project editing:** Open multiple projects simultaneously in tabs
- **Tab bar:** Appears when at least one project is open
  - Home tab: Small house icon, always present, navigates to homepage
  - Project tabs: Display project name, closable with X button
- **Opening projects:** Double-click a project card to open in new tab
- **Switching:** Click any tab to switch context
- **Closing:** Close project tabs with X button or middle-click
- **Persistence:** Open tabs persist across app restarts (future)

---

## 2. Project Editor Layout

### 2.1 Canvas Area (Center)
- Main editing canvas displaying current slide
- White background (customizable later)
- Shows alignment guides when dragging elements

### 2.2 Media Pool (Bottom Bar or Sidebar)
- Displays all imported media for the project
- **Import methods:**
  - Drag and drop from file explorer
  - Paste from clipboard (Ctrl/Cmd+V)
  - Import button/dialog
- **Management:**
  - Delete with Backspace/Delete key
  - Thumbnail preview
  - Drag from pool onto canvas to add to slide

### 2.3 Slide Strip (Bottom or Side)
- Horizontal strip showing all slides (1-20 max)
- Current slide highlighted
- Click to switch slides
- **Reordering:** Drag handle on hover to reorder slides
- Add slide button (opens template picker)
- Delete slide option

### 2.4 Layers Panel (Right Sidebar or Toggle)
- Shows all elements on current slide in layer order
- Visual layer stack representation
- Drag to reorder layers (affects z-index)
- Click to select element
- Toggle visibility per layer
- Lock/unlock icons per layer

---

## 3. Canvas Editing Features

### 3.1 Photo Manipulation
- **Drag:** Move photo freely on canvas
- **Resize:** Corner/edge handles with aspect ratio preserved
- **Rotate:** Rotation handle or modifier key + drag
- **Scale Slider:** Adjust image scale relative to frame size (bounded side)

### 3.2 Intelligent Positioning
- **Center snapping:** Snap to horizontal/vertical center
- **Equal margin guides:** Visual lines when margins on opposite sides are equal
- **Edge snapping:** Snap to frame edges
- **Element-to-element snapping:** Align with other photos
- **Grid overlay:** Optional toggle

### 3.3 Cross-Frame Elements
- Photos can span across consecutive frames
- Visual indicator showing element extends to next/previous frame
- Synchronized positioning across frames

### 3.4 Element Locking
- Lock individual elements (non-editable until unlocked)
- Visual indicator for locked state (lock icon, reduced opacity, etc.)
- Locked elements cannot be moved, resized, or deleted
- Unlock via layers panel or command palette

---

## 4. Command Palette (Spotlight Search)

### 4.1 Activation
- Keyboard shortcut: Cmd/Ctrl+K (or similar)
- Always accessible from any view

### 4.2 Functionality
- Fuzzy search through all available operations
- Context-aware results (different options based on selection)
- Categories: Actions, Templates, Navigation, Settings

### 4.3 Example Operations
| Command | Action |
|---------|--------|
| "Add picture" | Focus media pool, tab through items, Enter to place |
| "Left align" | Align selected element to left edge |
| "Center horizontal" | Center element horizontally |
| "Lock element" | Lock selected element |
| "Save as template" | Save current slide as template |
| "Apply template" | Open template picker |
| "Go to slide 3" | Navigate to specific slide |
| "Add new slide" | Add slide after current |
| "Delete slide" | Remove current slide |
| "Undo" / "Redo" | History navigation |

### 4.4 Keyboard Navigation Flow
```
Cmd+K → Type "add pic" → Select "Add Picture" →
Media pool focused → Tab through photos →
Enter to place on canvas →
Cmd+K → "center" → Select "Center on canvas"
```

---

## 5. Templates System

### 5.1 Template Structure
- Templates are aspect-ratio specific
- Contain placeholder elements (not actual images)
- Store position, size, rotation of placeholders
- Store layer order

### 5.2 Placeholder Images
- Visual representation of where an image will go
- Drag image from media pool onto placeholder to fill
- Can have multiple placeholders per template
- Numbered/labeled placeholders

### 5.3 Saving Templates
- Select "Save as template" on any slide with content
- All images converted to placeholders
- User names the template
- Saved per aspect ratio

### 5.4 Applying Templates
- Accessible via:
  - Command palette
  - "Add slide" action (shows template picker first)
  - Templates panel/section
- Preview before applying
- Replaces current slide content or creates new slide

---

## 6. Keyboard Shortcuts

### 6.1 Global
| Shortcut | Action |
|----------|--------|
| Cmd/Ctrl+K | Open command palette |
| Cmd/Ctrl+S | Save project |
| Cmd/Ctrl+Z | Undo |
| Cmd/Ctrl+Shift+Z | Redo |
| Cmd/Ctrl+V | Paste (image from clipboard) |
| Escape | Deselect / Close panel |

### 6.2 Canvas
| Shortcut | Action |
|----------|--------|
| Delete/Backspace | Delete selected element |
| Cmd/Ctrl+D | Duplicate element |
| Cmd/Ctrl+L | Lock/Unlock element |
| Arrow keys | Nudge element |
| Shift+Arrow | Nudge by larger increment |
| [ | Send backward |
| ] | Bring forward |
| Cmd/Ctrl+[ | Send to back |
| Cmd/Ctrl+] | Bring to front |

### 6.3 Navigation
| Shortcut | Action |
|----------|--------|
| Left/Right Arrow | Previous/Next slide (when no element selected) |
| Cmd/Ctrl+N | New slide |

### 6.4 Media Pool
| Shortcut | Action |
|----------|--------|
| Tab | Cycle through media items |
| Enter | Place selected media on canvas |
| Delete/Backspace | Remove from pool |

---

## 7. Data Persistence

### 7.1 Project File
- Each post saved as a project file
- Contains:
  - Aspect ratio
  - Slides array with element data
  - References to imported media (file paths or embedded)
  - Template references

### 7.2 Templates Storage
- Stored separately from projects
- Organized by aspect ratio
- Shareable between projects

### 7.3 Auto-save
- Auto-save on changes
- Recovery on crash

---

## 8. Export

### 8.1 Export Options
- Export all slides as images
- Export single slide
- Format: PNG (recommended) or JPG
- Resolution: Instagram maximum for selected aspect ratio

### 8.2 Export Destinations
- Local filesystem (choose folder)
- Quick export to default location

---

## 9. Future Considerations (Phase 2+)

- Instagram API integration for direct posting
- Scheduled posting
- Custom background colors/gradients
- Text elements
- Shape elements
- Filters/adjustments on photos
- Cloud sync for projects and templates

---

## UI/UX Principles

1. **Keyboard-first:** Every action accessible via keyboard
2. **Non-destructive:** Original photos never modified
3. **Responsive feedback:** Visual guides and snapping indicators
4. **Minimal clicks:** Command palette reduces navigation depth
5. **Consistent patterns:** Similar actions work the same way everywhere
