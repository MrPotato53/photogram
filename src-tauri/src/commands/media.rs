use crate::models::{MediaItem, Project};
use chrono::Utc;
use std::fs;
use std::path::PathBuf;
use tauri::{command, AppHandle, Emitter};
use uuid::Uuid;
use super::utils::paths::{get_projects_dir, get_thumbnails_dir, get_assets_dir};
use super::utils::image_processing::{
    collect_image_files, is_image_file, get_image_dimensions, generate_thumbnail,
};

// Data for background thumbnail generation
struct ThumbnailJob {
    media_id: String,
    source_path: PathBuf,
    thumb_path: PathBuf,
}

#[command]
pub fn import_media_files(
    app: AppHandle,
    project_id: String,
    file_paths: Vec<String>,
) -> Result<Vec<MediaItem>, String> {
    use rayon::prelude::*;

    // Create thumbnails directory (only thumbnails are stored in app data)
    let thumbnails_dir = get_thumbnails_dir(&app, &project_id);
    fs::create_dir_all(&thumbnails_dir).map_err(|e| format!("Failed to create thumbnails dir: {}", e))?;

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
    let mut thumbnail_jobs: Vec<ThumbnailJob> = vec![];

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

        // Get image dimensions without loading full image into memory
        let (width, height) = get_image_dimensions(&source_path).unwrap_or((1080, 1080));

        // Queue thumbnail generation for background processing
        let thumb_filename = format!("{}.jpg", media_id);
        let thumb_path = thumbnails_dir.join(&thumb_filename);
        thumbnail_jobs.push(ThumbnailJob {
            media_id: media_id.clone(),
            source_path: source_path.clone(),
            thumb_path,
        });

        // Store reference to original file path (no copying)
        media_items.push(MediaItem {
            id: media_id,
            file_name,
            file_path: source_path.to_string_lossy().to_string(),
            thumbnail_path: None,
            width,
            height,
        });
    }

    // Update the project's media pool immediately (without thumbnails)
    let project_path_clone = project_path.clone();
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

    // Spawn background thread to generate thumbnails in parallel
    if !thumbnail_jobs.is_empty() {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            // Generate thumbnails in parallel using rayon
            let results: Vec<(String, Option<String>)> = thumbnail_jobs
                .par_iter()
                .map(|job| {
                    let thumb_path_str = match generate_thumbnail(&job.source_path, &job.thumb_path) {
                        Ok(_) => Some(job.thumb_path.to_string_lossy().to_string()),
                        Err(e) => {
                            eprintln!("Failed to generate thumbnail for {}: {}", job.media_id, e);
                            None
                        }
                    };
                    (job.media_id.clone(), thumb_path_str)
                })
                .collect();

            // Update project with thumbnail paths
            if let Ok(contents) = fs::read_to_string(&project_path_clone) {
                if let Ok(mut project) = serde_json::from_str::<Project>(&contents) {
                    for (media_id, thumb_path) in results {
                        if let Some(media) = project.media_pool.iter_mut().find(|m| m.id == media_id) {
                            media.thumbnail_path = thumb_path;
                        }
                    }

                    if let Ok(json) = serde_json::to_string_pretty(&project) {
                        let _ = fs::write(&project_path_clone, json);
                    }

                    // Emit event to notify frontend that thumbnails are ready
                    let _ = app_handle.emit("thumbnails-ready", ());
                }
            }
        });
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

    // Find and remove the media item (only delete thumbnail, not original file)
    if let Some(media_item) = project.media_pool.iter().find(|m| m.id == media_id) {
        // Delete the thumbnail if it exists (original file is kept)
        if let Some(ref thumb_path) = media_item.thumbnail_path {
            let thumb_file = PathBuf::from(thumb_path);
            if thumb_file.exists() {
                let _ = fs::remove_file(&thumb_file);
            }
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
pub fn check_media_exists(file_path: String) -> bool {
    PathBuf::from(&file_path).exists()
}

#[command]
pub fn relink_media(
    app: AppHandle,
    project_id: String,
    media_id: String,
    new_file_path: String,
) -> Result<Project, String> {
    let new_path = PathBuf::from(&new_file_path);
    if !new_path.exists() {
        return Err("New file does not exist".to_string());
    }

    if !is_image_file(&new_path) {
        return Err("File is not a supported image format".to_string());
    }

    let projects_dir = get_projects_dir(&app);
    let project_path = projects_dir.join(format!("{}.json", project_id));
    let thumbnails_dir = get_thumbnails_dir(&app, &project_id);

    let contents = fs::read_to_string(&project_path)
        .map_err(|e| format!("Failed to read project: {}", e))?;

    let mut project: Project =
        serde_json::from_str(&contents).map_err(|e| format!("Failed to parse project: {}", e))?;

    // Find the media item to relink
    let media_item = project
        .media_pool
        .iter_mut()
        .find(|m| m.id == media_id)
        .ok_or("Media item not found")?;

    // Get new dimensions from the new file location
    let (width, height) = get_image_dimensions(&new_path).unwrap_or((1080, 1080));

    // Update media item to point to new location (no file copying)
    media_item.file_path = new_file_path;
    media_item.width = width;
    media_item.height = height;

    // Delete old thumbnail if exists
    if let Some(ref thumb_path) = media_item.thumbnail_path {
        let _ = fs::remove_file(thumb_path);
    }

    // Clear thumbnail path - will be regenerated in background
    media_item.thumbnail_path = None;

    project.updated_at = Utc::now();

    let json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    fs::write(&project_path, json).map_err(|e| format!("Failed to save project: {}", e))?;

    // Generate new thumbnail in background
    let thumb_filename = format!("{}.jpg", media_id);
    let thumb_path = thumbnails_dir.join(&thumb_filename);
    let project_path_clone = project_path.clone();
    let media_id_clone = media_id.clone();
    let app_handle = app.clone();

    std::thread::spawn(move || {
        fs::create_dir_all(&thumbnails_dir).ok();

        if let Ok(_) = generate_thumbnail(&new_path, &thumb_path) {
            // Update project with thumbnail path
            if let Ok(contents) = fs::read_to_string(&project_path_clone) {
                if let Ok(mut project) = serde_json::from_str::<Project>(&contents) {
                    if let Some(media) = project.media_pool.iter_mut().find(|m| m.id == media_id_clone) {
                        media.thumbnail_path = Some(thumb_path.to_string_lossy().to_string());
                    }

                    if let Ok(json) = serde_json::to_string_pretty(&project) {
                        let _ = fs::write(&project_path_clone, json);
                    }

                    // Notify frontend
                    let _ = app_handle.emit("thumbnails-ready", ());
                }
            }
        }
    });

    Ok(project)
}

/// Embed an image asset for a canvas element
/// Copies the source image to the project's assets folder and returns the asset path
#[command]
pub fn embed_element_asset(
    app: AppHandle,
    project_id: String,
    element_id: String,
    source_file_path: String,
) -> Result<String, String> {
    let source_path = PathBuf::from(&source_file_path);
    if !source_path.exists() {
        return Err("Source file does not exist".to_string());
    }

    if !is_image_file(&source_path) {
        return Err("File is not a supported image format".to_string());
    }

    // Create assets directory for this project
    let assets_dir = get_assets_dir(&app, &project_id);
    fs::create_dir_all(&assets_dir)
        .map_err(|e| format!("Failed to create assets directory: {}", e))?;

    // Determine the file extension
    let extension = source_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg");

    // Create the asset file path using element ID
    let asset_filename = format!("{}.{}", element_id, extension);
    let asset_path = assets_dir.join(&asset_filename);

    // Copy the source file to the assets directory
    fs::copy(&source_path, &asset_path)
        .map_err(|e| format!("Failed to copy image to assets: {}", e))?;

    Ok(asset_path.to_string_lossy().to_string())
}

/// Delete an element's embedded asset file
#[command]
pub fn delete_element_asset(
    app: AppHandle,
    project_id: String,
    asset_path: String,
) -> Result<(), String> {
    let path = PathBuf::from(&asset_path);

    // Verify the asset is within the project's assets directory (security check)
    let assets_dir = get_assets_dir(&app, &project_id);
    if !path.starts_with(&assets_dir) {
        return Err("Invalid asset path".to_string());
    }

    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete asset: {}", e))?;
    }

    Ok(())
}

#[command]
pub fn show_in_folder(path: String) -> Result<(), String> {
    let path = PathBuf::from(&path);
    if !path.exists() {
        return Err("File does not exist".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path.to_string_lossy()])
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path.to_string_lossy()])
            .spawn()
            .map_err(|e| format!("Failed to open Explorer: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        // Try different file managers
        let parent = path.parent().unwrap_or(&path);
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {}", e))?;
    }

    Ok(())
}

