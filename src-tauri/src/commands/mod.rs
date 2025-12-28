use crate::models::{AspectRatio, MediaItem, Preferences, Project, ProjectSummary};
use chrono::Utc;
use exif::{In, Reader as ExifReader, Tag};
use std::fs::{self, File};
use std::io::BufReader;
use std::path::PathBuf;
use tauri::{command, AppHandle, Emitter, Manager};
use uuid::Uuid;

fn get_projects_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("Failed to get app data dir")
        .join("projects")
}

fn get_thumbnails_dir(app: &AppHandle, project_id: &str) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("Failed to get app data dir")
        .join("thumbnails")
        .join(project_id)
}

fn get_assets_dir(app: &AppHandle, project_id: &str) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("Failed to get app data dir")
        .join("assets")
        .join(project_id)
}

// Generate a small thumbnail for the media pool (128x128, JPEG quality 80)
fn generate_thumbnail(source_path: &PathBuf, thumb_path: &PathBuf) -> Result<(), String> {
    use image::imageops::FilterType;

    // Load image
    let img = image::open(source_path)
        .map_err(|e| format!("Failed to open image: {}", e))?;

    // Get EXIF orientation and apply it
    let orientation = get_exif_orientation(source_path).unwrap_or(1);
    let img = apply_exif_orientation(img, orientation);

    // Resize to thumbnail (128x128 max, maintaining aspect ratio)
    let thumb = img.resize(128, 128, FilterType::Triangle);

    // Save as JPEG with quality 80
    thumb.save(thumb_path)
        .map_err(|e| format!("Failed to save thumbnail: {}", e))?;

    Ok(())
}

// Apply EXIF orientation to image
fn apply_exif_orientation(img: image::DynamicImage, orientation: u32) -> image::DynamicImage {
    match orientation {
        2 => img.fliph(),
        3 => img.rotate180(),
        4 => img.flipv(),
        5 => img.rotate90().fliph(),
        6 => img.rotate90(),
        7 => img.rotate270().fliph(),
        8 => img.rotate270(),
        _ => img, // 1 or unknown = no transformation
    }
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
