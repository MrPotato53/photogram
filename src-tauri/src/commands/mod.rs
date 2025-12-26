use crate::models::{AspectRatio, MediaItem, Preferences, Project, ProjectSummary};
use chrono::Utc;
use std::fs;
use std::path::PathBuf;
use tauri::{command, AppHandle, Manager};
use uuid::Uuid;

fn get_projects_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("Failed to get app data dir")
        .join("projects")
}

fn get_media_dir(app: &AppHandle, project_id: &str) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("Failed to get app data dir")
        .join("media")
        .join(project_id)
}

fn get_preferences_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("Failed to get app data dir")
        .join("preferences.json")
}

#[command]
pub fn get_all_projects(app: AppHandle) -> Result<Vec<ProjectSummary>, String> {
    let projects_dir = get_projects_dir(&app);
    let mut projects: Vec<ProjectSummary> = vec![];

    if let Ok(entries) = fs::read_dir(&projects_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map_or(false, |ext| ext == "json") {
                if let Ok(contents) = fs::read_to_string(&path) {
                    if let Ok(project) = serde_json::from_str::<Project>(&contents) {
                        projects.push(ProjectSummary::from(&project));
                    }
                }
            }
        }
    }

    Ok(projects)
}

#[command]
pub fn get_project(app: AppHandle, id: String) -> Result<Project, String> {
    let projects_dir = get_projects_dir(&app);
    let project_path = projects_dir.join(format!("{}.json", id));

    let contents = fs::read_to_string(&project_path)
        .map_err(|e| format!("Failed to read project: {}", e))?;

    let mut project: Project =
        serde_json::from_str(&contents).map_err(|e| format!("Failed to parse project: {}", e))?;

    // Update accessed_at timestamp
    project.accessed_at = Utc::now();
    let json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    fs::write(&project_path, json).map_err(|e| format!("Failed to save project: {}", e))?;

    Ok(project)
}

#[command]
pub fn create_project(
    app: AppHandle,
    name: String,
    aspect_ratio: AspectRatio,
) -> Result<Project, String> {
    let project = Project::new(name, aspect_ratio);
    let projects_dir = get_projects_dir(&app);
    let project_path = projects_dir.join(format!("{}.json", project.id));

    // Create media directory for this project
    let media_dir = get_media_dir(&app, &project.id);
    fs::create_dir_all(&media_dir).map_err(|e| format!("Failed to create media dir: {}", e))?;

    let json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    fs::write(&project_path, json).map_err(|e| format!("Failed to save project: {}", e))?;

    Ok(project)
}

#[command]
pub fn update_project(app: AppHandle, project: Project) -> Result<Project, String> {
    let projects_dir = get_projects_dir(&app);
    let project_path = projects_dir.join(format!("{}.json", project.id));

    let mut updated_project = project;
    updated_project.updated_at = Utc::now();

    let json = serde_json::to_string_pretty(&updated_project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    fs::write(&project_path, json).map_err(|e| format!("Failed to save project: {}", e))?;

    Ok(updated_project)
}

#[command]
pub fn delete_project(app: AppHandle, id: String) -> Result<(), String> {
    let projects_dir = get_projects_dir(&app);
    let project_path = projects_dir.join(format!("{}.json", id));

    // Delete project file
    if project_path.exists() {
        fs::remove_file(&project_path).map_err(|e| format!("Failed to delete project: {}", e))?;
    }

    // Delete media directory
    let media_dir = get_media_dir(&app, &id);
    if media_dir.exists() {
        fs::remove_dir_all(&media_dir)
            .map_err(|e| format!("Failed to delete media directory: {}", e))?;
    }

    Ok(())
}

#[command]
pub fn rename_project(app: AppHandle, id: String, new_name: String) -> Result<Project, String> {
    let mut project = get_project(app.clone(), id)?;
    project.name = new_name;
    project.updated_at = Utc::now();
    update_project(app, project)
}

#[command]
pub fn import_media_files(
    app: AppHandle,
    project_id: String,
    file_paths: Vec<String>,
) -> Result<Vec<MediaItem>, String> {
    let media_dir = get_media_dir(&app, &project_id);
    fs::create_dir_all(&media_dir).map_err(|e| format!("Failed to create media dir: {}", e))?;

    let mut media_items: Vec<MediaItem> = vec![];

    for path_str in file_paths {
        let source_path = PathBuf::from(&path_str);
        if !source_path.exists() {
            continue;
        }

        let file_name = source_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown".to_string());

        let media_id = Uuid::new_v4().to_string();
        let extension = source_path
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_else(|| "jpg".to_string());

        let dest_filename = format!("{}.{}", media_id, extension);
        let dest_path = media_dir.join(&dest_filename);

        // Copy file to media directory
        fs::copy(&source_path, &dest_path)
            .map_err(|e| format!("Failed to copy file {}: {}", file_name, e))?;

        // Get image dimensions (basic implementation - could use image crate for accuracy)
        let (width, height) = (1080, 1080); // Default, will be updated when we add image processing

        media_items.push(MediaItem {
            id: media_id,
            file_name,
            file_path: dest_path.to_string_lossy().to_string(),
            thumbnail_path: None,
            width,
            height,
        });
    }

    Ok(media_items)
}

#[command]
pub fn get_preferences(app: AppHandle) -> Result<Preferences, String> {
    let prefs_path = get_preferences_path(&app);

    if !prefs_path.exists() {
        return Ok(Preferences::default_preferences());
    }

    let contents =
        fs::read_to_string(&prefs_path).map_err(|e| format!("Failed to read preferences: {}", e))?;

    serde_json::from_str(&contents).map_err(|e| format!("Failed to parse preferences: {}", e))
}

#[command]
pub fn save_preferences(app: AppHandle, preferences: Preferences) -> Result<(), String> {
    let prefs_path = get_preferences_path(&app);

    let json = serde_json::to_string_pretty(&preferences)
        .map_err(|e| format!("Failed to serialize preferences: {}", e))?;

    fs::write(&prefs_path, json).map_err(|e| format!("Failed to save preferences: {}", e))?;

    Ok(())
}
