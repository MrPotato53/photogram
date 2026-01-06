import { useEffect } from 'react';
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

interface EditorLayoutProps {
  projectId: string;
}

export function EditorLayout({ projectId }: EditorLayoutProps) {
  const { project, isLoading, error, loadProject, refreshProject } = useProjectStore();
  const { currentSlideIndex } = useSlideStore();
  const { draggingMediaId } = useMediaStore();
  const { panels } = usePanelStore();

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
      <EditorToolbar projectName={project.name} />
      <EditBar />

      <div className="flex-1 flex flex-col min-h-0">
        {/* Canvas area - takes remaining space */}
        <div className="flex-1 relative overflow-hidden min-h-0">
          <CanvasArea aspectRatio={project.aspectRatio} />

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
    </div>
  );
}
