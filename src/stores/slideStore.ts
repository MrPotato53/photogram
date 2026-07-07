import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Slide, Template, Element } from '../types';
import { updateProject, embedElementAsset } from '../services/tauri';
import { getSlideWidth } from '../utils/designConstants';
import { getSlideIndex } from '../utils/slideUtils';
import { useProjectStore } from './projectStore';
import { useHistoryStore } from './historyStore';
import type { AspectRatio } from '../types';

// Home slide = leftmost slide an element occupies. Elements can sit at
// slightly negative x (drag clamp allows up to -width+50), which would
// give index -1 and silently exempt them from slide remove/reorder/shift
// logic — clamp to slide 0 instead.
function getHomeSlideIndex(elementX: number, slideWidth: number): number {
  return Math.max(0, getSlideIndex(elementX, slideWidth));
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

    // Find elements "homed" on this slide and remove them
    // An element's home slide is the leftmost slide it occupies
    const removedElements = project.elements.filter(
      (element) => getHomeSlideIndex(element.x, slideWidth) === slideIndex
    );
    const updatedElements = project.elements.filter(
      (element) => getHomeSlideIndex(element.x, slideWidth) !== slideIndex
    );

    // Adjust x coordinates for elements on slides after the deleted one
    const adjustedElements = updatedElements.map((element) => {
      const homeSlideIndex = getHomeSlideIndex(element.x, slideWidth);
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
    // Elements stay with their "home" slide (leftmost slide they occupy)
    const adjustedElements = project.elements.map((element) => {
      const homeSlideIndex = getHomeSlideIndex(element.x, slideWidth);

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
      const homeSlideIndex = getHomeSlideIndex(element.x, slideWidth);
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

