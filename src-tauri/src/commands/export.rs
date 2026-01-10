use base64::{engine::general_purpose, Engine as _};
use std::fs;
use std::path::PathBuf;
use tauri::command;

#[command]
pub fn export_slides(
    project_name: String,
    slide_indices: Vec<usize>,
    output_folder: String,
    format: String,
    slide_image_data: Vec<String>,
) -> Result<Vec<String>, String> {
    // Validate inputs
    if slide_indices.len() != slide_image_data.len() {
        return Err("Slide indices and image data length mismatch".to_string());
    }

    if format != "png" && format != "jpeg" {
        return Err(format!("Invalid format: {}. Must be 'png' or 'jpeg'", format));
    }

    // Ensure output folder exists
    let output_path = PathBuf::from(&output_folder);
    if !output_path.exists() {
        return Err(format!("Output folder does not exist: {}", output_folder));
    }

    let mut exported_files: Vec<String> = Vec::new();

    // Process each slide
    for (i, slide_index) in slide_indices.iter().enumerate() {
        let image_data = &slide_image_data[i];

        // Remove data URL prefix if present (data:image/png;base64, or data:image/jpeg;base64,)
        let base64_data = if let Some(comma_pos) = image_data.find(',') {
            &image_data[comma_pos + 1..]
        } else {
            image_data.as_str()
        };

        // Decode base64 to bytes
        let image_bytes = general_purpose::STANDARD
            .decode(base64_data)
            .map_err(|e| format!("Failed to decode base64 for slide {}: {}", slide_index + 1, e))?;

        // Generate filename: ProjectName_slide1.png
        let extension = if format == "jpeg" { "jpg" } else { "png" };
        let base_filename = format!("{}_{}",
            sanitize_filename(&project_name),
            slide_index + 1
        );

        // Handle filename conflicts by auto-versioning
        let file_path = find_available_filename(&output_path, &base_filename, extension)?;

        // Write image to file
        fs::write(&file_path, image_bytes)
            .map_err(|e| format!("Failed to write file {}: {}", file_path.display(), e))?;

        exported_files.push(file_path.to_string_lossy().to_string());
    }

    Ok(exported_files)
}

/// Sanitize filename by removing/replacing invalid characters
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            _ => c,
        })
        .collect()
}

/// Find an available filename by checking for conflicts and auto-versioning
/// Returns: ProjectName_slide1.png, or ProjectName_slide1 (1).png, ProjectName_slide1 (2).png, etc.
fn find_available_filename(
    dir: &PathBuf,
    base_name: &str,
    extension: &str,
) -> Result<PathBuf, String> {
    // Try the base filename first
    let mut path = dir.join(format!("{}.{}", base_name, extension));

    if !path.exists() {
        return Ok(path);
    }

    // File exists, find the smallest non-existing version number
    let mut version = 1;
    loop {
        path = dir.join(format!("{} ({}).{}", base_name, version, extension));

        if !path.exists() {
            return Ok(path);
        }

        version += 1;

        // Safety check to prevent infinite loop (reasonable limit)
        if version > 9999 {
            return Err(format!("Too many versions of file: {}", base_name));
        }
    }
}
