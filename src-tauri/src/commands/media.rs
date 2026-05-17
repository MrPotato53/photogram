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

        // Read exact byte size for relink matching. Cheap (single stat call).
        let file_size = fs::metadata(&source_path)
            .map(|m| m.len())
            .unwrap_or(0);

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
            file_size,
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
    let new_size = fs::metadata(&new_path).map(|m| m.len()).unwrap_or(0);

    // Update media item to point to new location (no file copying)
    media_item.file_path = new_file_path;
    media_item.width = width;
    media_item.height = height;
    media_item.file_size = new_size;

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

// =============== Bulk relink ===============

/// Per-item result returned to the frontend so the summary toast can report
/// what happened. Tier names mirror the matching strategy in `bulk_relink_media`.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "status")]
pub enum RelinkResult {
    /// Filename + size + dimensions all matched a unique candidate.
    Exact { media_id: String, new_path: String },
    /// Size + dimensions matched (filename differs — user renamed the file).
    Renamed { media_id: String, new_path: String, old_name: String, new_name: String },
    /// Filename + dimensions matched, size differed (file was re-saved/compressed).
    Resaved { media_id: String, new_path: String, size_delta: i64 },
    /// Multiple candidates matched at the same confidence tier; can't pick one.
    Ambiguous { media_id: String, candidate_paths: Vec<String> },
    /// Nothing in the scanned directories matched this media item.
    NotFound { media_id: String },
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkRelinkResponse {
    pub project: Project,
    pub results: Vec<RelinkResult>,
    /// Total candidate image files discovered across the scanned paths.
    pub scanned_count: usize,
}

/// Walk a directory up to `max_depth` levels deep, collecting image files.
/// Depth 0 = only the directory itself. Depth 1 = directory + immediate children.
fn walk_images_capped(root: &PathBuf, max_depth: usize, out: &mut Vec<PathBuf>) {
    if !root.exists() { return; }
    if root.is_file() {
        if is_image_file(root) { out.push(root.clone()); }
        return;
    }
    let mut stack: Vec<(PathBuf, usize)> = vec![(root.clone(), 0)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if is_image_file(&path) { out.push(path); }
            } else if path.is_dir() && depth < max_depth {
                stack.push((path, depth + 1));
            }
        }
    }
}

#[command]
pub fn bulk_relink_media(
    app: AppHandle,
    project_id: String,
    media_ids: Vec<String>,
    scan_paths: Vec<String>,
    max_depth: usize,
) -> Result<BulkRelinkResponse, String> {
    let projects_dir = get_projects_dir(&app);
    let project_path = projects_dir.join(format!("{}.json", project_id));
    let thumbnails_dir = get_thumbnails_dir(&app, &project_id);

    let contents = fs::read_to_string(&project_path)
        .map_err(|e| format!("Failed to read project: {}", e))?;
    let mut project: Project =
        serde_json::from_str(&contents).map_err(|e| format!("Failed to parse project: {}", e))?;

    // Phase 1: walk the scan paths to gather all candidate image files.
    let mut candidates: Vec<PathBuf> = Vec::new();
    for p in &scan_paths {
        let path = PathBuf::from(p);
        walk_images_capped(&path, max_depth, &mut candidates);
    }
    let scanned_count = candidates.len();

    // Pre-index candidates by filename and by file size (cheap metadata reads).
    // Dimensions are deferred until a target needs them, to keep the scan fast
    // even when scanning thousands of files.
    use std::collections::HashMap;
    let mut by_name: HashMap<String, Vec<usize>> = HashMap::new();
    let mut by_size: HashMap<u64, Vec<usize>> = HashMap::new();
    let mut sizes: Vec<u64> = Vec::with_capacity(candidates.len());
    for (i, p) in candidates.iter().enumerate() {
        let size = fs::metadata(p).map(|m| m.len()).unwrap_or(0);
        sizes.push(size);
        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        by_name.entry(name.to_lowercase()).or_default().push(i);
        by_size.entry(size).or_default().push(i);
    }
    // Lazy dimensions cache — populated only for candidates we actually inspect.
    let mut dims_cache: HashMap<usize, Option<(u32, u32)>> = HashMap::new();
    let mut get_dims = |idx: usize| -> Option<(u32, u32)> {
        if let Some(v) = dims_cache.get(&idx) { return *v; }
        let d = get_image_dimensions(&candidates[idx]);
        dims_cache.insert(idx, d);
        d
    };

    // Phase 2: match each requested media item against the candidate pool.
    let mut results: Vec<RelinkResult> = Vec::new();
    let mut to_apply: Vec<(String, String, u64, u32, u32)> = Vec::new(); // (media_id, new_path, new_size, w, h)

    for media_id in &media_ids {
        let Some(media) = project.media_pool.iter().find(|m| m.id == *media_id) else {
            results.push(RelinkResult::NotFound { media_id: media_id.clone() });
            continue;
        };
        // Skip if the file currently linked still exists — nothing to relink.
        if PathBuf::from(&media.file_path).exists() {
            continue;
        }
        let target_name = media.file_name.to_lowercase();
        let target_size = media.file_size;
        let target_w = media.width;
        let target_h = media.height;

        // Tier 1 (exact): same filename, same size. Dimensions confirmed.
        let mut tier1: Vec<usize> = Vec::new();
        if let Some(name_idxs) = by_name.get(&target_name) {
            for &idx in name_idxs {
                if sizes[idx] == target_size && target_size > 0 {
                    if let Some((w, h)) = get_dims(idx) {
                        if w == target_w && h == target_h {
                            tier1.push(idx);
                        }
                    }
                }
            }
        }
        if tier1.len() == 1 {
            let idx = tier1[0];
            let new_path = candidates[idx].to_string_lossy().to_string();
            to_apply.push((media_id.clone(), new_path.clone(), sizes[idx], target_w, target_h));
            results.push(RelinkResult::Exact { media_id: media_id.clone(), new_path });
            continue;
        }
        if tier1.len() > 1 {
            results.push(RelinkResult::Ambiguous {
                media_id: media_id.clone(),
                candidate_paths: tier1.iter().map(|&i| candidates[i].to_string_lossy().to_string()).collect(),
            });
            continue;
        }

        // Tier 2 (renamed): same size, same dimensions. Filename may differ.
        let mut tier2: Vec<usize> = Vec::new();
        if target_size > 0 {
            if let Some(size_idxs) = by_size.get(&target_size) {
                for &idx in size_idxs {
                    if let Some((w, h)) = get_dims(idx) {
                        if w == target_w && h == target_h {
                            tier2.push(idx);
                        }
                    }
                }
            }
        }
        if tier2.len() == 1 {
            let idx = tier2[0];
            let new_path = candidates[idx].to_string_lossy().to_string();
            let new_name = candidates[idx].file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            to_apply.push((media_id.clone(), new_path.clone(), sizes[idx], target_w, target_h));
            results.push(RelinkResult::Renamed {
                media_id: media_id.clone(),
                new_path,
                old_name: media.file_name.clone(),
                new_name,
            });
            continue;
        }
        if tier2.len() > 1 {
            results.push(RelinkResult::Ambiguous {
                media_id: media_id.clone(),
                candidate_paths: tier2.iter().map(|&i| candidates[i].to_string_lossy().to_string()).collect(),
            });
            continue;
        }

        // Tier 3 (resaved): same filename + dimensions, size differs (compression).
        let mut tier3: Vec<usize> = Vec::new();
        if let Some(name_idxs) = by_name.get(&target_name) {
            for &idx in name_idxs {
                if let Some((w, h)) = get_dims(idx) {
                    if w == target_w && h == target_h {
                        tier3.push(idx);
                    }
                }
            }
        }
        if tier3.len() == 1 {
            let idx = tier3[0];
            let new_path = candidates[idx].to_string_lossy().to_string();
            let size_delta = sizes[idx] as i64 - target_size as i64;
            to_apply.push((media_id.clone(), new_path.clone(), sizes[idx], target_w, target_h));
            results.push(RelinkResult::Resaved { media_id: media_id.clone(), new_path, size_delta });
            continue;
        }
        if tier3.len() > 1 {
            results.push(RelinkResult::Ambiguous {
                media_id: media_id.clone(),
                candidate_paths: tier3.iter().map(|&i| candidates[i].to_string_lossy().to_string()).collect(),
            });
            continue;
        }

        results.push(RelinkResult::NotFound { media_id: media_id.clone() });
    }

    // Phase 3: apply all confirmed relinks, then persist.
    let mut thumb_jobs: Vec<(String, PathBuf, PathBuf)> = Vec::new();
    for (media_id, new_path, new_size, w, h) in &to_apply {
        if let Some(m) = project.media_pool.iter_mut().find(|m| m.id == *media_id) {
            // Delete old thumb (will regenerate from new source)
            if let Some(ref t) = m.thumbnail_path {
                let _ = fs::remove_file(t);
            }
            m.file_path = new_path.clone();
            m.file_size = *new_size;
            m.width = *w;
            m.height = *h;
            m.thumbnail_path = None;
            let thumb_filename = format!("{}.jpg", media_id);
            let thumb_path = thumbnails_dir.join(&thumb_filename);
            thumb_jobs.push((media_id.clone(), PathBuf::from(new_path), thumb_path));
        }
    }
    project.updated_at = Utc::now();

    let json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    fs::write(&project_path, json).map_err(|e| format!("Failed to save project: {}", e))?;

    // Regenerate thumbnails in the background; emit one event when all done.
    if !thumb_jobs.is_empty() {
        let project_path_clone = project_path.clone();
        let thumbnails_dir_clone = thumbnails_dir.clone();
        let app_handle = app.clone();
        std::thread::spawn(move || {
            fs::create_dir_all(&thumbnails_dir_clone).ok();
            for (media_id, src, thumb) in &thumb_jobs {
                if generate_thumbnail(src, thumb).is_ok() {
                    if let Ok(contents) = fs::read_to_string(&project_path_clone) {
                        if let Ok(mut p) = serde_json::from_str::<Project>(&contents) {
                            if let Some(m) = p.media_pool.iter_mut().find(|m| m.id == *media_id) {
                                m.thumbnail_path = Some(thumb.to_string_lossy().to_string());
                            }
                            if let Ok(j) = serde_json::to_string_pretty(&p) {
                                let _ = fs::write(&project_path_clone, j);
                            }
                        }
                    }
                }
            }
            let _ = app_handle.emit("thumbnails-ready", ());
        });
    }

    Ok(BulkRelinkResponse { project, results, scanned_count })
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

