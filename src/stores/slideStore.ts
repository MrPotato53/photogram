import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Slide, Template, Element } from '../types';
import { updateProject, embedElementAsset } from '../services/tauri';
import { getSlideWidth } from '../utils/designConstants';
import { getSlideIndexFromCenter } from '../utils/slideUtils';
import { getRotatedBounds } from '../utils/coordinates';
import { useProjectStore } from './projectStore';
import { useHistoryStore } from './historyStore';
import { useElementStore } from './elementStore';
import type { AspectRatio } from '../types';

// Home slide = the slide under the element's CENTER — the same rule the
// rest of the app uses (selection, slide indicators, template capture via
// getElementsOnSlide). Slide ops previously homed by left edge, which
// disagreed for multi-slide spreads: a 2-panel image spanning slides
// [N, N+1] reads as belonging to N+1 everywhere in the UI (center floors
// to the right slide on the exact boundary), but reorder/remove treated
// it as N's content — so moving the spread's slide shifted the image into
// the wrong slot (off-canvas when it was the last slide).
// Clamped to [0, numSlides-1]: elements can hang off either canvas edge
// (drag clamp allows up to -width+50 / totalWidth-50), which would give
// out-of-range indices and silently exempt them from remove/reorder/shift
// logic.
function getHomeSlideIndex(element: Element, slideWidth: number, numSlides: number): number {
  // Measure the element's VISIBLE centre: elements rotate about their
  // top-left anchor, so for a rotated element x + width/2 is not where it
  // appears (at 90° the footprint is entirely left of x) and it would be
  // filed under a slide it isn't on — which then misdirects reorder and
  // remove, exactly the class of bug the comment above describes.
  const b = getRotatedBounds(element.x, element.y, element.width, element.height, element.rotation);
  const idx = getSlideIndexFromCenter(b.x, b.width, slideWidth);
  return Math.max(0, Math.min(numSlides - 1, idx));
}

interface SlideState {
  currentSlideIndex: number;

  setCurrentSlide: (index: number) => void;
  addSlide: () => Promise<void>;
  addSlideWithTemplate: (template: Template) => Promise<void>;
  removeSlide: (slideIndex: number) => Promise<void>;
  reorderSlides: (fromIndex: number, toIndex: number) => Promise<void>;
  duplicateSlide: (slideIndex: number) => Promise<void>;
}

export const useSlideStore = create<SlideState>((set, get) => ({
  currentSlideIndex: 0,

  setCurrentSlide: (index: number) => {
    const project = useProjectStore.getState().project;
    if (project && index >= 0 && index < project.slides.length) {
      set({ currentSlideIndex: index });
    }
  },

  addSlide: async () => {
    const project = useProjectStore.getState().project;
    if (!project) return;

    // Maximum 20 slides
    if (project.slides.length >= 20) return;

    const newSlideIndex = project.slides.length;
    const newSlide: Slide = {
      id: uuidv4(),
      order: newSlideIndex,
    };

    const updatedProject = {
      ...project,
      slides: [...project.slides, newSlide],
    };

    try {
      const savedProject = await updateProject(updatedProject);
      useProjectStore.getState().setProject(savedProject, {
        source: 'slide',
        actionType: 'add',
      });
      set({ currentSlideIndex: newSlideIndex });
    } catch (error) {
      console.error('Failed to add slide:', error);
    }
  },

  addSlideWithTemplate: async (template: Template) => {
    const project = useProjectStore.getState().project;
    if (!project) return;

    // Maximum 20 slides
    if (project.slides.length >= 20) return;

    const designWidth = getSlideWidth(project.aspectRatio);
    const newSlideIndex = project.slides.length;
    const slideOffsetX = newSlideIndex * designWidth;

    // Create new slide
    const newSlide: Slide = {
      id: uuidv4(),
      order: newSlideIndex,
    };

    // Convert template elements to project elements with proper positioning
    // Template elements have positions relative to a single slide (0 to designWidth)
    // We need to offset them to the new slide's position
    const maxZIndex = project.elements.length > 0
      ? Math.max(...project.elements.map((el) => el.zIndex))
      : -1;

    const newElements = template.elements.map((templateEl, index) => ({
      id: uuidv4(),
      type: templateEl.type as 'photo' | 'placeholder',
      x: templateEl.x + slideOffsetX, // Offset to new slide position
      y: templateEl.y,
      width: templateEl.width,
      height: templateEl.height,
      rotation: templateEl.rotation,
      scale: templateEl.scale,
      locked: templateEl.locked,
      zIndex: maxZIndex + 1 + index,
    }));

    const updatedProject = {
      ...project,
      slides: [...project.slides, newSlide],
      elements: [...project.elements, ...newElements],
    };

    try {
      const savedProject = await updateProject(updatedProject);
      useProjectStore.getState().setProject(savedProject, {
        source: 'template',
        actionType: 'apply',
      });
      set({ currentSlideIndex: newSlideIndex });
    } catch (error) {
      console.error('Failed to add slide with template:', error);
    }
  },

  removeSlide: async (slideIndex: number) => {
    const project = useProjectStore.getState().project;
    const { currentSlideIndex } = get();
    if (!project) return;

    // Must have at least 1 slide
    if (project.slides.length <= 1) return;

    // Calculate slide width for element repositioning
    const aspectRatio: AspectRatio = project.aspectRatio;
    const slideWidth = getSlideWidth(aspectRatio);

    // Find elements "homed" on this slide (slide under the element center)
    // and remove them
    const removedElements = project.elements.filter(
      (element) => getHomeSlideIndex(element, slideWidth, project.slides.length) === slideIndex
    );
    const updatedElements = project.elements.filter(
      (element) => getHomeSlideIndex(element, slideWidth, project.slides.length) !== slideIndex
    );

    // Adjust x coordinates for elements on slides after the deleted one
    const adjustedElements = updatedElements.map((element) => {
      const homeSlideIndex = getHomeSlideIndex(element, slideWidth, project.slides.length);
      if (homeSlideIndex > slideIndex) {
        return { ...element, x: element.x - slideWidth };
      }
      return element;
    });

    // New objects for order updates — never mutate current store state
    const updatedSlides = project.slides
      .filter((_, index) => index !== slideIndex)
      .map((slide, index) => ({ ...slide, order: index }));

    const updatedProject = { ...project, slides: updatedSlides, elements: adjustedElements };

    // Adjust current slide index if needed
    let newCurrentIndex = currentSlideIndex;
    if (currentSlideIndex >= updatedSlides.length) {
      newCurrentIndex = updatedSlides.length - 1;
    } else if (currentSlideIndex > slideIndex) {
      newCurrentIndex = currentSlideIndex - 1;
    }

    try {
      const savedProject = await updateProject(updatedProject);
      useProjectStore.getState().setProject(savedProject, {
        source: 'slide',
        actionType: 'delete',
        slideIndex,
      });
      set({ currentSlideIndex: newCurrentIndex });

      // If the selected element was deleted with the slide, clear the
      // selection so the transformer border doesn't linger on a node
      // that no longer exists.
      const elementStore = useElementStore.getState();
      if (
        elementStore.selectedElementId &&
        removedElements.some((el) => el.id === elementStore.selectedElementId)
      ) {
        elementStore.selectElement(null);
      }

      // Track embedded assets of removed elements so their files are
      // cleaned up when the deletion falls off the history stack (same
      // pattern as elementStore.removeElement — without this, slide
      // deletion orphans asset files on disk forever).
      const historyStore = useHistoryStore.getState();
      const currentEntry = historyStore.entries[historyStore.currentIndex];
      for (const element of removedElements) {
        if (element.assetPath) {
          historyStore.trackDeletedAsset({
            assetPath: element.assetPath,
            mediaId: element.mediaId || '',
            deletedAt: Date.now(),
            historyEntryId: currentEntry?.id || '',
          });
        }
      }
    } catch (error) {
      console.error('Failed to remove slide:', error);
    }
  },

  reorderSlides: async (fromIndex: number, toIndex: number) => {
    const project = useProjectStore.getState().project;
    const { currentSlideIndex } = get();
    if (!project) return;
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= project.slides.length) return;
    if (toIndex < 0 || toIndex >= project.slides.length) return;

    const aspectRatio: AspectRatio = project.aspectRatio;
    const slideWidth = getSlideWidth(aspectRatio);

    // Reorder slides array — new objects for order updates, never mutate
    // current store state
    const reordered = [...project.slides];
    const [movedSlide] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, movedSlide);
    const newSlides = reordered.map((slide, index) => ({ ...slide, order: index }));

    // Adjust element positions based on slide movement
    // Elements stay with their "home" slide (slide under the element center)
    const adjustedElements = project.elements.map((element) => {
      const homeSlideIndex = getHomeSlideIndex(element, slideWidth, project.slides.length);

      if (homeSlideIndex === fromIndex) {
        // Element is homed on the moved slide - move it to new position
        const offsetWithinSlide = element.x - fromIndex * slideWidth;
        return { ...element, x: toIndex * slideWidth + offsetWithinSlide };
      } else if (fromIndex < toIndex) {
        // Slide moved right: elements on slides between fromIndex+1 and toIndex shift left
        if (homeSlideIndex > fromIndex && homeSlideIndex <= toIndex) {
          return { ...element, x: element.x - slideWidth };
        }
      } else {
        // Slide moved left: elements on slides between toIndex and fromIndex-1 shift right
        if (homeSlideIndex >= toIndex && homeSlideIndex < fromIndex) {
          return { ...element, x: element.x + slideWidth };
        }
      }
      return element;
    });

    const updatedProject = { ...project, slides: newSlides, elements: adjustedElements };

    // Update current slide index to follow the moved slide if it was selected
    let newCurrentIndex = currentSlideIndex;
    if (currentSlideIndex === fromIndex) {
      newCurrentIndex = toIndex;
    } else if (fromIndex < toIndex) {
      if (currentSlideIndex > fromIndex && currentSlideIndex <= toIndex) {
        newCurrentIndex = currentSlideIndex - 1;
      }
    } else {
      if (currentSlideIndex >= toIndex && currentSlideIndex < fromIndex) {
        newCurrentIndex = currentSlideIndex + 1;
      }
    }

    try {
      const savedProject = await updateProject(updatedProject);
      useProjectStore.getState().setProject(savedProject, {
        source: 'slide',
        actionType: 'reorder',
      });
      set({ currentSlideIndex: newCurrentIndex });
    } catch (error) {
      console.error('Failed to reorder slides:', error);
    }
  },

  duplicateSlide: async (slideIndex: number) => {
    const project = useProjectStore.getState().project;
    if (!project) return;

    // Maximum 20 slides
    if (project.slides.length >= 20) return;

    const slideWidth = getSlideWidth(project.aspectRatio);
    const slideLeft = slideIndex * slideWidth;
    const slideRight = (slideIndex + 1) * slideWidth;

    // Find all elements that are on this slide
    const slideElements = project.elements.filter((element) => {
      const elementLeft = element.x;
      const elementRight = element.x + element.width;
      return elementRight > slideLeft && elementLeft < slideRight;
    });

    // Create new slide immediately after the source slide
    const newSlideIndex = slideIndex + 1;
    const newSlide: Slide = {
      id: uuidv4(),
      order: newSlideIndex,
    };

    // Duplicate elements with new IDs and positions
    const maxZIndex = project.elements.length > 0
      ? Math.max(...project.elements.map((el) => el.zIndex))
      : -1;

    const duplicatedElements: Element[] = [];
    for (let index = 0; index < slideElements.length; index++) {
      const element = slideElements[index];
      const newElement: Element = {
        ...element,
        id: uuidv4(),
        x: element.x + slideWidth, // Shift to next slide position
        zIndex: maxZIndex + 1 + index,
      };

      // Photo elements need their own embedded asset copy so the duplicate
      // doesn't share a file with the original — asset cleanup on history
      // prune would delete the shared file out from under the survivor.
      // Same pattern as elementStore.duplicateSelectedElement.
      if (newElement.type === 'photo' && newElement.mediaId) {
        const media = project.mediaPool.find((m) => m.id === newElement.mediaId);
        // Prefer the media pool original; fall back to the source element's
        // embedded asset if the media was removed from the pool.
        const sourcePath = media?.filePath || element.assetPath;
        try {
          if (!sourcePath) throw new Error('No source file for asset embed');
          newElement.assetPath = await embedElementAsset(project.id, newElement.id, sourcePath);
        } catch (error) {
          console.error('Failed to embed asset for slide duplicate:', error);
          // Drop the aliased path rather than share a file with the
          // original; the element falls back to the media pool reference.
          newElement.assetPath = undefined;
        }
      }

      duplicatedElements.push(newElement);
    }

    // Shift existing slides after the insertion point
    const updatedSlides = [
      ...project.slides.slice(0, newSlideIndex),
      newSlide,
      ...project.slides.slice(newSlideIndex).map((slide) => ({
        ...slide,
        order: slide.order + 1,
      })),
    ];

    // Shift elements on slides after the new slide
    const updatedElements = project.elements.map((element) => {
      const homeSlideIndex = getHomeSlideIndex(element, slideWidth, project.slides.length);
      if (homeSlideIndex >= newSlideIndex) {
        return { ...element, x: element.x + slideWidth };
      }
      return element;
    });

    const updatedProject = {
      ...project,
      slides: updatedSlides,
      elements: [...updatedElements, ...duplicatedElements],
    };

    try {
      const savedProject = await updateProject(updatedProject);
      useProjectStore.getState().setProject(savedProject, {
        source: 'slide',
        actionType: 'duplicate',
        slideIndex,
      });
      set({ currentSlideIndex: newSlideIndex });
    } catch (error) {
      console.error('Failed to duplicate slide:', error);
    }
  },
}));

