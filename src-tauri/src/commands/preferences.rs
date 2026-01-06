use crate::models::Preferences;
use std::fs;
use tauri::{command, AppHandle};
use super::utils::paths::get_preferences_path;

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

