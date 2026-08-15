use exif::{In, Reader as ExifReader, Tag};
use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;

/// Maximum thumbnail side length. Sized to support the media pool's 500%
/// zoom on 2x-DPR displays (80 base × 5 zoom × 2 DPR = 800 raster pixels,
/// rounded up with headroom). Bumping this requires regenerating older
/// thumbnails — see backfill in `get_project`.
pub const THUMBNAIL_MAX_SIDE: u32 = 1024;

/// Max side of the fast first-pass thumbnail. Deliberately small ("ultra
/// low res"): it exists so imported media becomes visible in the pool
/// within a fraction of the full pipeline time. The quality pass
/// (`generate_thumbnail`) overwrites it at THUMBNAIL_MAX_SIDE afterwards.
pub const FAST_THUMBNAIL_MAX_SIDE: u32 = 256;

/// Fast low-res thumbnail. Same decode as the quality pass, but:
/// - sizes with `DynamicImage::thumbnail()` (progressive 2× box sampling)
///   instead of Lanczos3, which dominates generate_thumbnail's runtime on
///   large photos;
/// - applies EXIF orientation AFTER the resize, so rotation/flip touches
///   ~0.07MP instead of the full-size raster.
pub fn generate_thumbnail_fast(source_path: &PathBuf, thumb_path: &PathBuf) -> Result<(), String> {
    let img = image::open(source_path)
        .map_err(|e| format!("Failed to open image: {}", e))?;

    let thumb = img.thumbnail(FAST_THUMBNAIL_MAX_SIDE, FAST_THUMBNAIL_MAX_SIDE);

    let orientation = get_exif_orientation(source_path).unwrap_or(1);
    let thumb = apply_exif_orientation(thumb, orientation);

    thumb.save(thumb_path)
        .map_err(|e| format!("Failed to save thumbnail: {}", e))?;

    Ok(())
}

/// Generate a thumbnail for the media pool. Resizes the largest side to
/// THUMBNAIL_MAX_SIDE preserving aspect ratio. JPEG quality 85.
pub fn generate_thumbnail(source_path: &PathBuf, thumb_path: &PathBuf) -> Result<(), String> {
    use image::imageops::FilterType;

    // Load image
    let img = image::open(source_path)
        .map_err(|e| format!("Failed to open image: {}", e))?;

    // Get EXIF orientation and apply it
    let orientation = get_exif_orientation(source_path).unwrap_or(1);
    let img = apply_exif_orientation(img, orientation);

    // Resize so the larger side equals THUMBNAIL_MAX_SIDE, preserving aspect.
    let thumb = img.resize(THUMBNAIL_MAX_SIDE, THUMBNAIL_MAX_SIDE, FilterType::Lanczos3);

    // Save as JPEG with quality 85
    thumb.save(thumb_path)
        .map_err(|e| format!("Failed to save thumbnail: {}", e))?;

    Ok(())
}

/// Apply EXIF orientation to image
pub fn apply_exif_orientation(img: image::DynamicImage, orientation: u32) -> image::DynamicImage {
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

/// Get EXIF orientation from image file
/// Orientations 5, 6, 7, 8 indicate 90° or 270° rotation
pub fn get_exif_orientation(path: &PathBuf) -> Option<u32> {
    let file = File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let exif = ExifReader::new().read_from_container(&mut reader).ok()?;

    if let Some(orientation) = exif.get_field(Tag::Orientation, In::PRIMARY) {
        orientation.value.get_uint(0)
    } else {
        None
    }
}

/// Get image dimensions without loading the full image into memory
/// Accounts for EXIF orientation to return display dimensions
pub fn get_image_dimensions(path: &PathBuf) -> Option<(u32, u32)> {
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

/// Check if a file path is an image file based on extension.
///
/// Must stay in step with the frontend's canvas-drop filter — a format
/// accepted there but rejected here imports nothing, with no error shown.
pub fn is_image_file(path: &PathBuf) -> bool {
    let extensions = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "tiff", "tif"];
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| extensions.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Collect all image files from a list of paths (handles both files and directories)
pub fn collect_image_files(paths: Vec<String>) -> Vec<PathBuf> {
    use std::fs;
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

