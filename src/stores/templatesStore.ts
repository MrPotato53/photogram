import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { AspectRatio, Element, Template } from '../types';
import {
  getTemplates,
  saveTemplate as saveTemplateApi,
  deleteTemplateApi,
  reorderTemplates as reorderTemplatesApi,
} from '../services/tauri';

interface TemplatesState {
  templates: Template[];
  isLoading: boolean;
  error: string | null;

  // Load templates from disk
  loadTemplates: () => Promise<void>;

  // Save a slide layout as a template
  saveSlideAsTemplate: (
    slideIndex: number,
    name: string,
    aspectRatio: AspectRatio,
    elements: Element[],
    designWidth: number
  ) => Promise<void>;

  // Delete a template
  deleteTemplate: (templateId: string) => Promise<void>;

  // Reorder templates
  reorderTemplates: (templateIds: string[]) => Promise<void>;

  // Rename a template
  renameTemplate: (templateId: string, newName: string) => Promise<void>;

  // Get templates matching a specific aspect ratio
  getTemplatesForAspectRatio: (aspectRatio: AspectRatio) => Template[];
}

export const useTemplatesStore = create<TemplatesState>((set, get) => ({
  templates: [],
  isLoading: false,
  error: null,

  loadTemplates: async () => {
    set({ isLoading: true, error: null });
    try {
      const templates = await getTemplates();
      set({ templates, isLoading: false });
    } catch (error) {
      console.error('Failed to load templates:', error);
      set({ error: String(error), isLoading: false });
    }
  },

  saveSlideAsTemplate: async (
    slideIndex: number,
    name: string,
    aspectRatio: AspectRatio,
    elements: Element[],
    designWidth: number
  ) => {
    // Get elements on this slide
    const slideStartX = slideIndex * designWidth;
    const slideEndX = slideStartX + designWidth;

    const slideElements = elements.filter((el) => {
      const elCenterX = el.x + el.width / 2;
      return elCenterX >= slideStartX && elCenterX < slideEndX;
    });

    // Convert elements to template elements (positions relative to slide, all become placeholders)
    const templateElements = slideElements.map((el) => ({
      id: uuidv4(),
      type: 'placeholder' as const,
      x: el.x - slideStartX, // Convert to slide-relative coordinates
      y: el.y,
      width: el.width,
      height: el.height,
      rotation: el.rotation,
      scale: el.scale,
      locked: false,
      zIndex: el.zIndex,
    }));

    const newTemplate: Template = {
      id: uuidv4(),
      name,
      aspectRatio: { ...aspectRatio },
      elements: templateElements,
      createdAt: new Date().toISOString(),
    };

    try {
      const updatedTemplates = await saveTemplateApi(newTemplate);
      set({ templates: updatedTemplates });
    } catch (error) {
      console.error('Failed to save template:', error);
    }
  },

  deleteTemplate: async (templateId: string) => {
    try {
      const updatedTemplates = await deleteTemplateApi(templateId);
      set({ templates: updatedTemplates });
    } catch (error) {
      console.error('Failed to delete template:', error);
    }
  },

  reorderTemplates: async (templateIds: string[]) => {
    try {
      const updatedTemplates = await reorderTemplatesApi(templateIds);
      set({ templates: updatedTemplates });
    } catch (error) {
      console.error('Failed to reorder templates:', error);
    }
  },

  renameTemplate: async (templateId: string, newName: string) => {
    const { templates } = get();
    const template = templates.find((t) => t.id === templateId);
    if (!template) return;

    const updatedTemplate = { ...template, name: newName };
    try {
      const updatedTemplates = await saveTemplateApi(updatedTemplate);
      set({ templates: updatedTemplates });
    } catch (error) {
      console.error('Failed to rename template:', error);
    }
  },

  getTemplatesForAspectRatio: (aspectRatio: AspectRatio) => {
    const { templates } = get();
    return templates.filter(
      (t) =>
        t.aspectRatio.width === aspectRatio.width &&
        t.aspectRatio.height === aspectRatio.height
    );
  },
}));
