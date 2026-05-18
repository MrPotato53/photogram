use crate::models::{AspectRatio, Project, ProjectSummary};
use chrono::Utc;
use std::fs;
use std::path::PathBuf;
use tauri::{command, AppHandle, Emitter, Manager};
use super::utils::paths::{get_projects_dir, get_thumbnails_dir, get_assets_dir};
use super::utils::image_processing::{generate_thumbnail, get_image_dimensions, THUMBNAIL_MAX_SIDE};

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

    // Backfill file_size for media imported before this field existed. One
    // stat() per entry — only fills entries with file_size == 0 to avoid
    // repeated work and to skip already-broken links (which stat as missing).
    let mut backfilled = false;
    for media in project.media_pool.iter_mut() {
        if media.file_size == 0 {
            if let Ok(meta) = fs::metadata(&media.file_path) {
                media.file_size = meta.len();
                backfilled = true;
            }
        }
    }

    // Detect thumbnails generated at the old smaller resolution. Reading
    // dimensions is cheap (the image crate does a header-only decode). Any
    // thumbnail whose largest side is meaningfully smaller than the current
    // THUMBNAIL_MAX_SIDE gets queued for background regeneration so the
    // upgraded media-pool zoom range (up to 500%) isn't blurry. The
    // tolerance avoids re-queueing thumbnails generated from narrow source
    // images (where the largest side can legitimately be < the target).
    let mut regen_jobs: Vec<(String, PathBuf, PathBuf)> = Vec::new();
    for media in project.media_pool.iter() {
        let Some(ref thumb_path_str) = media.thumbnail_path else { continue };
        let thumb_pb = PathBuf::from(thumb_path_str);
        if !thumb_pb.exists() { continue }
        let Some((tw, th)) = get_image_dimensions(&thumb_pb) else { continue };
        // Source might itself be small. Take the smaller of THUMBNAIL_MAX_SIDE
        // and source-largest-side as the required floor.
        let source_pb = PathBuf::from(&media.file_path);
        let source_largest = get_image_dimensions(&source_pb)
            .map(|(w, h)| w.max(h))
            .unwrap_or(THUMBNAIL_MAX_SIDE);
        let required = THUMBNAIL_MAX_SIDE.min(source_largest);
        if tw.max(th) + 64 < required {
            regen_jobs.push((media.id.clone(), source_pb, thumb_pb));
        }
    }

    // Update accessed_at timestamp
    project.accessed_at = Utc::now();
    let json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    fs::write(&project_path, json).map_err(|e| format!("Failed to save project: {}", e))?;

    // Silence unused warning when no backfill occurred — write happens
    // regardless because accessed_at changed.
    let _ = backfilled;

    // Run regeneration in the background. The frontend's existing
    // `thumbnails-ready` listener re-fetches the project once the batch
    // finishes, which (combined with the cache-bust versioning the media
    // pool applies on file path changes) swaps the higher-res bytes in.
    if !regen_jobs.is_empty() {
        let app_handle = app.clone();
        std::thread::spawn(move || {
            for (_media_id, source_path, thumb_path) in &regen_jobs {
                if source_path.exists() {
                    let _ = generate_thumbnail(source_path, thumb_path);
                }
            }
            let _ = app_handle.emit("thumbnails-ready", ());
        });
    }

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

