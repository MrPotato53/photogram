use crate::models::{AspectRatio, MediaItem, Preferences, Project, ProjectSummary};
use chrono::Utc;
use exif::{In, Reader as ExifReader, Tag};
use std::fs::{self, File};
use std::io::BufReader;
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

// Check if EXIF orientation requires swapping width/height
// Orientations 5, 6, 7, 8 indicate 90° or 270° rotation
fn get_exif_orientation(path: &PathBuf) -> Option<u32> {
    let file = File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let exif = ExifReader::new().read_from_container(&mut reader).ok()?;

    if let Some(orientation) = exif.get_field(Tag::Orientation, In::PRIMARY) {
        orientation.value.get_uint(0)
    } else {
        None
    }
}

// Get image dimensions without loading the full image into memory
// Accounts for EXIF orientation to return display dimensions
fn get_image_dimensions(path: &PathBuf) -> Option<(u32, u32)> {
    // Use image crate's reader to get raw dimensions without decoding the full image
    let (width, height) = match image::ImageReader::open(path) {
        Ok(reader) => match reader.with_guessed_format() {
            Ok(format_reader) => match format_reader.into_dimensions() {
                Ok(dims) => dims,
                Err(_) => return None,
            },
            Err(_) => return None,
        },
        Err(_) => return None,
    };

    // Check EXIF orientation - orientations 5-8 require swapping width/height
    let orientation = get_exif_orientation(path).unwrap_or(1);
    if orientation >= 5 && orientation <= 8 {
        Some((height, width)) // Swap for rotated images
    } else {
        Some((width, height))
    }
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

fn is_image_file(path: &PathBuf) -> bool {
    let extensions = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| extensions.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn collect_image_files(paths: Vec<String>) -> Vec<PathBuf> {
    let mut image_files: Vec<PathBuf> = vec![];

    for path_str in paths {
        let path = PathBuf::from(&path_str);
        if !path.exists() {
            continue;
        }

        if path.is_dir() {
            // Recursively collect image files from directory
            if let Ok(entries) = fs::read_dir(&path) {
                for entry in entries.flatten() {
                    let entry_path = entry.path();
                    if entry_path.is_file() && is_image_file(&entry_path) {
                        image_files.push(entry_path);
                    }
                }
            }
        } else if path.is_file() && is_image_file(&path) {
            image_files.push(path);
        }
    }

    image_files
}

#[command]
pub fn import_media_files(
    app: AppHandle,
    project_id: String,
    file_paths: Vec<String>,
) -> Result<Vec<MediaItem>, String> {
    let media_dir = get_media_dir(&app, &project_id);
    fs::create_dir_all(&media_dir).map_err(|e| format!("Failed to create media dir: {}", e))?;

    // Load existing project to check for duplicates
    let projects_dir = get_projects_dir(&app);
    let project_path = projects_dir.join(format!("{}.json", project_id));
    let existing_filenames: Vec<String> = if let Ok(contents) = fs::read_to_string(&project_path) {
        if let Ok(project) = serde_json::from_str::<Project>(&contents) {
            project.media_pool.iter().map(|m| m.file_name.clone()).collect()
        } else {
            vec![]
        }
    } else {
        vec![]
    };

    // Collect all image files (handles both files and directories)
    let image_files = collect_image_files(file_paths);

    let mut media_items: Vec<MediaItem> = vec![];

    for source_path in image_files {
        let file_name = source_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown".to_string());

        // Skip if this filename already exists in the media pool
        if existing_filenames.contains(&file_name) {
            continue;
        }

        let media_id = Uuid::new_v4().to_string();
        let extension = source_path
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_else(|| "jpg".to_string());

        let dest_filename = format!("{}.{}", media_id, extension);
        let dest_path = media_dir.join(&dest_filename);

        // Copy file to media directory
        if let Err(e) = fs::copy(&source_path, &dest_path) {
            eprintln!("Failed to copy file {}: {}", file_name, e);
            continue;
        }

        // Get image dimensions without loading full image into memory
        let (width, height) = get_image_dimensions(&dest_path).unwrap_or((1080, 1080));

        media_items.push(MediaItem {
            id: media_id,
            file_name,
            file_path: dest_path.to_string_lossy().to_string(),
            thumbnail_path: None, // No thumbnails - use full image with lazy loading
            width,
            height,
        });
    }

    // Also update the project's media pool
    if !media_items.is_empty() {
        if let Ok(contents) = fs::read_to_string(&project_path) {
            if let Ok(mut project) = serde_json::from_str::<Project>(&contents) {
                project.media_pool.extend(media_items.clone());
                project.updated_at = Utc::now();

                if let Ok(json) = serde_json::to_string_pretty(&project) {
                    let _ = fs::write(&project_path, json);
                }
            }
        }
    }

    Ok(media_items)
}

#[command]
pub fn delete_media(
    app: AppHandle,
    project_id: String,
    media_id: String,
) -> Result<Project, String> {
    let projects_dir = get_projects_dir(&app);
    let project_path = projects_dir.join(format!("{}.json", project_id));

    let contents = fs::read_to_string(&project_path)
        .map_err(|e| format!("Failed to read project: {}", e))?;

    let mut project: Project =
        serde_json::from_str(&contents).map_err(|e| format!("Failed to parse project: {}", e))?;

    // Find and remove the media item
    if let Some(media_item) = project.media_pool.iter().find(|m| m.id == media_id) {
        // Delete the actual file
        let file_path = PathBuf::from(&media_item.file_path);
        if file_path.exists() {
            let _ = fs::remove_file(&file_path);
        }
    }

    project.media_pool.retain(|m| m.id != media_id);
    project.updated_at = Utc::now();

    let json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    fs::write(&project_path, json).map_err(|e| format!("Failed to save project: {}", e))?;

    Ok(project)
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
