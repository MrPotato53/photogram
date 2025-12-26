import { useEffect, useState, useMemo } from 'react';
import { useProjectsStore } from '../../stores/projectsStore';
import { usePreferencesStore } from '../../stores/preferencesStore';
import { useTabsStore } from '../../stores/tabsStore';
import { ProjectCard } from './ProjectCard';
import { NewProjectCard } from './NewProjectCard';
import { NewProjectModal } from './NewProjectModal';
import { RenameModal } from './RenameModal';
import { PreferencesModal } from './PreferencesModal';
import { ConfirmDialog, Select } from '../common';
import type { AspectRatio } from '../../types';

const SORT_OPTIONS = [
  { value: 'accessedAt', label: 'Recently Accessed' },
  { value: 'createdAt', label: 'Date Created' },
  { value: 'name', label: 'Name' },
];

export function HomePage() {
  const { projects, isLoading, loadProjects, createProject, deleteProject, renameProject } =
    useProjectsStore();
  const { preferences, setSortBy } = usePreferencesStore();
  const { openProject } = useTabsStore();

  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [renameState, setRenameState] = useState<{
    isOpen: boolean;
    id: string;
    name: string;
  }>({ isOpen: false, id: '', name: '' });
  const [deleteState, setDeleteState] = useState<{
    isOpen: boolean;
    id: string;
    name: string;
  }>({ isOpen: false, id: '', name: '' });

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const sortedProjects = useMemo(() => {
    const sorted = [...projects];
    switch (preferences.sortBy) {
      case 'accessedAt':
        return sorted.sort(
          (a, b) => new Date(b.accessedAt).getTime() - new Date(a.accessedAt).getTime()
        );
      case 'createdAt':
        return sorted.sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      case 'name':
        return sorted.sort((a, b) => a.name.localeCompare(b.name));
      default:
        return sorted;
    }
  }, [projects, preferences.sortBy]);

  const existingNames = useMemo(() => projects.map((p) => p.name), [projects]);

  const handleCreateProject = async (
    name: string,
    aspectRatio: AspectRatio,
    mediaPaths: string[]
  ) => {
    const projectId = await createProject(name, aspectRatio, mediaPaths);
    if (projectId) {
      openProject(projectId, name);
    }
    setIsNewModalOpen(false);
  };

  const handleOpenProject = (id: string) => {
    const project = projects.find((p) => p.id === id);
    if (project) {
      openProject(project.id, project.name);
    }
  };

  const handleRename = (id: string, currentName: string) => {
    setRenameState({ isOpen: true, id, name: currentName });
  };

  const handleConfirmRename = async (newName: string) => {
    await renameProject(renameState.id, newName);
    setRenameState({ isOpen: false, id: '', name: '' });
  };

  const handleDelete = (id: string, name: string) => {
    setDeleteState({ isOpen: true, id, name });
  };

  const handleConfirmDelete = async () => {
    await deleteProject(deleteState.id);
    setDeleteState({ isOpen: false, id: '', name: '' });
  };

  return (
    <div className="h-full flex flex-col bg-theme-bg">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-theme-border">
        <h1 className="text-lg font-semibold text-theme-text">Photogram</h1>
        <div className="flex items-center gap-3">
          <Select
            options={SORT_OPTIONS}
            value={preferences.sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof preferences.sortBy)}
            className="w-40"
          />
          <button
            onClick={() => setIsPreferencesOpen(true)}
            className="p-1.5 text-theme-text-muted hover:text-theme-text hover:bg-theme-bg-tertiary rounded transition-colors"
            title="Preferences"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-5">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-theme-text-muted">Loading projects...</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            <NewProjectCard onClick={() => setIsNewModalOpen(true)} />
            {sortedProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={handleOpenProject}
                onRename={handleRename}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}

        {!isLoading && projects.length === 0 && (
          <div className="text-center text-theme-text-muted mt-8">
            <p>No projects yet. Create your first one!</p>
          </div>
        )}
      </main>

      {/* Modals */}
      <NewProjectModal
        isOpen={isNewModalOpen}
        onClose={() => setIsNewModalOpen(false)}
        onCreate={handleCreateProject}
        existingNames={existingNames}
      />

      <RenameModal
        isOpen={renameState.isOpen}
        onClose={() => setRenameState({ ...renameState, isOpen: false })}
        onRename={handleConfirmRename}
        currentName={renameState.name}
        existingNames={existingNames}
      />

      <PreferencesModal
        isOpen={isPreferencesOpen}
        onClose={() => setIsPreferencesOpen(false)}
      />

      <ConfirmDialog
        isOpen={deleteState.isOpen}
        onClose={() => setDeleteState({ ...deleteState, isOpen: false })}
        onConfirm={handleConfirmDelete}
        title="Delete Project"
        message={`Are you sure you want to delete "${deleteState.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        danger
      />
    </div>
  );
}
