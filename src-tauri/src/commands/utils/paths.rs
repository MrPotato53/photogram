use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Get the projects directory path
pub fn get_projects_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("Failed to get app data dir")
        .join("projects")
}

/// Get the thumbnails directory path for a specific project
pub fn get_thumbnails_dir(app: &AppHandle, project_id: &str) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("Failed to get app data dir")
        .join("thumbnails")
        .join(project_id)
}

/// Get the assets directory path for a specific project
pub fn get_assets_dir(app: &AppHandle, project_id: &str) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("Failed to get app data dir")
        .join("assets")
        .join(project_id)
}

/// Get the preferences file path
pub fn get_preferences_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("Failed to get app data dir")
        .join("preferences.json")
}

/// Get the templates file path
pub fn get_templates_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("Failed to get app data dir")
        .join("templates.json")
}

