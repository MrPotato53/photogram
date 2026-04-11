import { useEffect, useState, useCallback, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useProjectStore } from '../../stores/projectStore';
import { useSlideStore } from '../../stores/slideStore';
import { useMediaStore } from '../../stores/mediaStore';
import { usePanelStore } from '../../stores/panelStore';
import { EditorToolbar } from './EditorToolbar';
import { EditBar } from './EditBar';
import { CanvasArea } from './CanvasArea';
import { FloatingPanel } from './FloatingPanel';
import { MediaPoolPanel } from './panels/MediaPoolPanel';
import { LayersPanel } from './panels/LayersPanel';
import { TemplatesPanel } from './panels/TemplatesPanel';
import { SlidesPanel } from './panels/SlidesPanel';
import { DragPreview } from './DragPreview';
import { ExportModal } from './ExportModal';
import { PreviewModal } from './PreviewModal';
import { exportSlides, showInFolder, type ExportOptions } from '../../services/tauri';

interface EditorLayoutProps {
  projectId: string;
}

export function EditorLayout({ projectId }: EditorLayoutProps) {
  const project = useProjectStore((s) => s.project);
  const isLoading = useProjectStore((s) => s.isLoading);
  const error = useProjectStore((s) => s.error);
  const loadProject = useProjectStore((s) => s.loadProject);
  const refreshProject = useProjectStore((s) => s.refreshProject);
  const currentSlideIndex = useSlideStore((s) => s.currentSlideIndex);
  const draggingMediaId = useMediaStore((s) => s.draggingMediaId);
  const panels = usePanelStore((s) => s.panels);

  // Export & Preview functionality
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const closePreview = useCallback(() => setIsPreviewModalOpen(false), []);
  const renderSlideForExportRef = useRef<((slideIndex: number, pixelRatio: number, format: 'png' | 'jpeg', quality: number) => string | null) | null>(null);
  const renderSlideThumbnailRef = useRef<((slideIndex: number) => string | null) | null>(null);
  const renderSlideForPreviewRef = useRef<((slideIndex: number, targetWidth: number) => string | null) | null>(null);

  useEffect(() => {
    loadProject(projectId);
  }, [projectId, loadProject]);

  // Listen for thumbnails-ready event from Rust backend
  useEffect(() => {
    const unlisten = listen('thumbnails-ready', () => {
      refreshProject();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [refreshProject]);

  // Change cursor during drag
  useEffect(() => {
    if (draggingMediaId) {
      document.body.style.cursor = 'grabbing';
    } else {
      document.body.style.cursor = '';
    }

    return () => {
      document.body.style.cursor = '';
    };
  }, [draggingMediaId]);

  // Export handler
  const handleExport = useCallback(async (slideIndices: number[], options: ExportOptions) => {
    if (!renderSlideForExportRef.current) {
      console.error('Render function not available');
      return;
    }

    try {
      // Render each slide
      const slideImageData: string[] = [];
      for (const slideIndex of slideIndices) {
        const imageData = renderSlideForExportRef.current(
          slideIndex,
          options.pixelRatio,
          options.format,
          options.quality
        );
        if (imageData) {
          slideImageData.push(imageData);
        } else {
          throw new Error(`Failed to render slide ${slideIndex + 1}`);
        }
      }

      // Call backend to save files
      const filePaths = await exportSlides(options, slideImageData);

      console.log(`Successfully exported ${filePaths.length} slides`);

      // Optionally open folder
      if (filePaths.length > 0) {
        await showInFolder(filePaths[0]);
      }
    } catch (error) {
      console.error('Export failed:', error);
      throw error;
    }
  }, []);

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-theme-bg">
        <div className="text-theme-text-muted">Loading project...</div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="h-full flex items-center justify-center bg-theme-bg">
        <div className="text-red-500">Failed to load project: {error}</div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-theme-bg-tertiary select-none">
      <EditorToolbar
        projectName={project.name}
        onPreviewClick={() => setIsPreviewModalOpen(true)}
        onExportClick={() => setIsExportModalOpen(true)}
      />
      <EditBar />

      <div className="flex-1 flex flex-col min-h-0">
        {/* Canvas area - takes remaining space */}
        <div className="flex-1 relative overflow-hidden min-h-0">
          <CanvasArea
            aspectRatio={project.aspectRatio}
            onRenderSlideForExport={(fn) => { renderSlideForExportRef.current = fn; }}
            onRenderSlideThumbnail={(fn) => { renderSlideThumbnailRef.current = fn; }}
            onRenderSlideForPreview={(fn) => { renderSlideForPreviewRef.current = fn; }}
          />

          {/* Floating Panels */}
          {panels.mediaPool.isOpen && (
            <FloatingPanel
              title="Media Pool"
              panelId="mediaPool"
              defaultPosition={{ x: 20, y: 20 }}
              minWidth={200}
              minHeight={150}
            >
              <MediaPoolPanel />
            </FloatingPanel>
          )}

          {panels.layers.isOpen && (
            <FloatingPanel
              title="Layers"
              panelId="layers"
              defaultPosition={{ x: window.innerWidth - 290, y: 20 }}
              minWidth={180}
              minHeight={200}
            >
              <LayersPanel />
            </FloatingPanel>
          )}

          {panels.templates.isOpen && (
            <FloatingPanel
              title="Templates"
              panelId="templates"
              defaultPosition={{ x: 20, y: 250 }}
              minWidth={200}
              minHeight={200}
            >
              <TemplatesPanel />
            </FloatingPanel>
          )}
        </div>

        {/* Slides panel - fixed at bottom (shows collapsed strip or full panel) */}
        <div className="flex-shrink-0" style={panels.slides.isOpen ? { height: 120 } : undefined}>
          <SlidesPanel />
        </div>

        {/* Bottom info bar - below slides panel */}
        <div className="flex-shrink-0 flex items-center justify-center gap-4 py-1.5 bg-gray-800/50 border-t border-theme-border">
          <span className="text-white text-xs">
            {project.aspectRatio.name}
          </span>
          <span className="text-gray-500">•</span>
          <span className="text-white text-xs">
            Slide {currentSlideIndex + 1} of {project.slides.length}
          </span>
        </div>
      </div>

      {/* Drag preview that follows cursor */}
      <DragPreview />

      {/* Preview modal */}
      <PreviewModal
        isOpen={isPreviewModalOpen}
        onClose={closePreview}
        aspectRatio={project.aspectRatio}
        numSlides={project.slides.length}
        renderSlideForPreview={(slideIndex, targetWidth) => renderSlideForPreviewRef.current?.(slideIndex, targetWidth) ?? null}
      />

      {/* Export modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        projectName={project.name}
        aspectRatio={project.aspectRatio}
        numSlides={project.slides.length}
        onExport={handleExport}
        renderSlideThumbnail={(slideIndex) => renderSlideThumbnailRef.current?.(slideIndex) ?? null}
      />
    </div>
  );
}
