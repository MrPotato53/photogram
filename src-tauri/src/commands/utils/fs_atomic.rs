use std::fs;
use std::path::Path;

/// Write a file atomically: write to a sibling temp file, then rename over
/// the target. `fs::rename` within the same directory is atomic on macOS /
/// Linux (and effectively so on Windows), so a crash or power loss mid-write
/// can never leave a truncated/corrupt file at the target path — the project
/// JSON is the entire user document, so plain `fs::write` is not acceptable
/// for it.
pub fn write_atomic(path: &Path, contents: &str) -> Result<(), String> {
    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, contents)
        .map_err(|e| format!("Failed to write temp file: {}", e))?;
    fs::rename(&tmp_path, path).map_err(|e| {
        // Best effort: don't leave the temp file behind on failure
        let _ = fs::remove_file(&tmp_path);
        format!("Failed to replace file: {}", e)
    })
}
