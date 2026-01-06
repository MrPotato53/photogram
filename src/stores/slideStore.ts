import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Slide, Template } from '../types';
import { updateProject } from '../services/tauri';
import { getSlideWidth } from '../utils/designConstants';
import { getSlideIndex } from '../utils/slideUtils';
import { useProjectStore } from './projectStore';
import type { AspectRatio } from '../types';

interface SlideState {
  currentSlideIndex: number;

  setCurrentSlide: (index: number) => void;
  addSlide: () => Promise<void>;
  addSlideWithTemplate: (template: Template) => Promise<void>;
  removeSlide: (slideIndex: number) => Promise<void>;
  reorderSlides: (fromIndex: number, toIndex: number) => Promise<void>;
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

    const newSlide: Slide = {
      id: uuidv4(),
      order: project.slides.length,
    };

    const updatedProject = {
      ...project,
      slides: [...project.slides, newSlide],
    };

    try {
      const savedProject = await updateProject(updatedProject);
      useProjectStore.getState().setProject(savedProject);
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
      useProjectStore.getState().setProject(savedProject);
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
    const updatedElements = project.elements.filter((element) => {
      const homeSlideIndex = getSlideIndex(element.x, slideWidth);
      return homeSlideIndex !== slideIndex;
    });

    // Adjust x coordinates for elements on slides after the deleted one
    const adjustedElements = updatedElements.map((element) => {
      const homeSlideIndex = getSlideIndex(element.x, slideWidth);
      if (homeSlideIndex > slideIndex) {
        return { ...element, x: element.x - slideWidth };
      }
      return element;
    });

    const updatedSlides = project.slides.filter((_, index) => index !== slideIndex);
    // Update order values
    updatedSlides.forEach((slide, index) => {
      slide.order = index;
    });

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
      useProjectStore.getState().setProject(savedProject);
      set({ currentSlideIndex: newCurrentIndex });
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

    // Reorder slides array
    const newSlides = [...project.slides];
    const [movedSlide] = newSlides.splice(fromIndex, 1);
    newSlides.splice(toIndex, 0, movedSlide);

    // Update order values
    newSlides.forEach((slide, index) => {
      slide.order = index;
    });

    // Adjust element positions based on slide movement
    // Elements stay with their "home" slide (leftmost slide they occupy)
    const adjustedElements = project.elements.map((element) => {
      const homeSlideIndex = getSlideIndex(element.x, slideWidth);

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
      useProjectStore.getState().setProject(savedProject);
      set({ currentSlideIndex: newCurrentIndex });
    } catch (error) {
      console.error('Failed to reorder slides:', error);
    }
  },
}));

