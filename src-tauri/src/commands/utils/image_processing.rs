use exif::{In, Reader as ExifReader, Tag};
use std::fs::File;
use std::io::BufReader;
use std::path::PathBuf;

/// Generate a thumbnail for the media pool (256x256, JPEG quality 85)
pub fn generate_thumbnail(source_path: &PathBuf, thumb_path: &PathBuf) -> Result<(), String> {
    use image::imageops::FilterType;

    // Load image
    let img = image::open(source_path)
        .map_err(|e| format!("Failed to open image: {}", e))?;

    // Get EXIF orientation and apply it
    let orientation = get_exif_orientation(source_path).unwrap_or(1);
    let img = apply_exif_orientation(img, orientation);

    // Resize to thumbnail (256x256 max, maintaining aspect ratio)
    // Use Lanczos3 for better quality at larger thumbnail sizes
    let thumb = img.resize(256, 256, FilterType::Lanczos3);

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

/// Check if a file path is an image file based on extension
pub fn is_image_file(path: &PathBuf) -> bool {
    let extensions = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];
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

