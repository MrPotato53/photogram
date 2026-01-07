use crate::models::{AspectRatio, Project, ProjectSummary};
use chrono::Utc;
use std::fs;
use tauri::{command, AppHandle, Manager};
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

#[command]
pub fn save_project_thumbnail(
    app: AppHandle,
    project_id: String,
    image_data: String,
) -> Result<String, String> {
    use base64::Engine;
    use base64::engine::general_purpose::STANDARD;

    // Create thumbnails directory for project previews
    let thumbnails_dir = app.path()
        .app_data_dir()
        .expect("Failed to get app data dir")
        .join("project_thumbnails");
    fs::create_dir_all(&thumbnails_dir)
        .map_err(|e| format!("Failed to create project thumbnails dir: {}", e))?;

    // Decode base64 image data (strip data URL prefix if present)
    let base64_data = if image_data.starts_with("data:image") {
        image_data.split(',').nth(1).unwrap_or(&image_data)
    } else {
        &image_data
    };

    let image_bytes = STANDARD.decode(base64_data)
        .map_err(|e| format!("Failed to decode base64 image: {}", e))?;

    // Save as JPEG file
    let thumb_path = thumbnails_dir.join(format!("{}.jpg", project_id));

    // Load and resize the image for consistent thumbnail size
    let img = image::load_from_memory(&image_bytes)
        .map_err(|e| format!("Failed to load image: {}", e))?;

    // Resize to max 400x400 for project thumbnail (larger than media thumbnails)
    let resized = img.resize(400, 400, image::imageops::FilterType::Lanczos3);

    resized.save(&thumb_path)
        .map_err(|e| format!("Failed to save project thumbnail: {}", e))?;

    let thumb_path_str = thumb_path.to_string_lossy().to_string();

    // Update project with thumbnail path
    let projects_dir = get_projects_dir(&app);
    let project_path = projects_dir.join(format!("{}.json", project_id));

    if let Ok(contents) = fs::read_to_string(&project_path) {
        if let Ok(mut project) = serde_json::from_str::<Project>(&contents) {
            project.thumbnail = Some(thumb_path_str.clone());
            if let Ok(json) = serde_json::to_string_pretty(&project) {
                let _ = fs::write(&project_path, json);
            }
        }
    }

    Ok(thumb_path_str)
}

