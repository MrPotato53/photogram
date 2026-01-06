use crate::models::{AspectRatio, Project, ProjectSummary};
use chrono::Utc;
use std::fs;
use tauri::{command, AppHandle};
use super::utils::paths::{get_projects_dir, get_thumbnails_dir, get_assets_dir};

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

    // Delete thumbnails directory (original media files are not touched)
    let thumbnails_dir = get_thumbnails_dir(&app, &id);
    if thumbnails_dir.exists() {
        fs::remove_dir_all(&thumbnails_dir)
            .map_err(|e| format!("Failed to delete thumbnails directory: {}", e))?;
    }

    // Delete assets directory (embedded element images)
    let assets_dir = get_assets_dir(&app, &id);
    if assets_dir.exists() {
        fs::remove_dir_all(&assets_dir)
            .map_err(|e| format!("Failed to delete assets directory: {}", e))?;
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

