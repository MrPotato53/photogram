import { invoke } from '@tauri-apps/api/core';
import type { AspectRatio, MediaItem, Preferences, Project, ProjectSummary } from '../types';

export async function getAllProjects(): Promise<ProjectSummary[]> {
  return invoke('get_all_projects');
}

export async function getProject(id: string): Promise<Project> {
  return invoke('get_project', { id });
}

export async function createProject(
  name: string,
  aspectRatio: AspectRatio
): Promise<Project> {
  return invoke('create_project', { name, aspectRatio });
}

export async function updateProject(project: Project): Promise<Project> {
  return invoke('update_project', { project });
}

export async function deleteProject(id: string): Promise<void> {
  return invoke('delete_project', { id });
}

export async function renameProject(id: string, newName: string): Promise<Project> {
  return invoke('rename_project', { id, newName });
}

export async function importMediaFiles(
  projectId: string,
  filePaths: string[]
): Promise<MediaItem[]> {
  return invoke('import_media_files', { projectId, filePaths });
}

export async function deleteMedia(
  projectId: string,
  mediaId: string
): Promise<Project> {
  return invoke('delete_media', { projectId, mediaId });
}

export async function getPreferences(): Promise<Preferences> {
  return invoke('get_preferences');
}

export async function savePreferences(preferences: Preferences): Promise<void> {
  return invoke('save_preferences', { preferences });
}

export async function showInFolder(path: string): Promise<void> {
  return invoke('show_in_folder', { path });
}

export async function checkMediaExists(filePath: string): Promise<boolean> {
  return invoke('check_media_exists', { filePath });
}

export async function relinkMedia(
  projectId: string,
  mediaId: string,
  newFilePath: string
): Promise<Project> {
  return invoke('relink_media', { projectId, mediaId, newFilePath });
}

export async function embedElementAsset(
  projectId: string,
  elementId: string,
  sourceFilePath: string
): Promise<string> {
  return invoke('embed_element_asset', { projectId, elementId, sourceFilePath });
}

export async function deleteElementAsset(
  projectId: string,
  assetPath: string
): Promise<void> {
  return invoke('delete_element_asset', { projectId, assetPath });
}
