use crate::models::Template;
use std::fs;
use tauri::{command, AppHandle};
use super::utils::paths::get_templates_path;

#[command]
pub fn get_templates(app: AppHandle) -> Result<Vec<Template>, String> {
    let templates_path = get_templates_path(&app);

    if !templates_path.exists() {
        return Ok(vec![]);
    }

    let contents = fs::read_to_string(&templates_path)
        .map_err(|e| format!("Failed to read templates: {}", e))?;

    serde_json::from_str(&contents).map_err(|e| format!("Failed to parse templates: {}", e))
}

#[command]
pub fn save_template(app: AppHandle, template: Template) -> Result<Vec<Template>, String> {
    let templates_path = get_templates_path(&app);

    let mut templates: Vec<Template> = if templates_path.exists() {
        let contents = fs::read_to_string(&templates_path)
            .map_err(|e| format!("Failed to read templates: {}", e))?;
        serde_json::from_str(&contents).unwrap_or_else(|_| vec![])
    } else {
        vec![]
    };

    // Check if template with same ID exists (update) or add new
    if let Some(existing) = templates.iter_mut().find(|t| t.id == template.id) {
        *existing = template;
    } else {
        templates.push(template);
    }

    let json = serde_json::to_string_pretty(&templates)
        .map_err(|e| format!("Failed to serialize templates: {}", e))?;

    fs::write(&templates_path, json)
        .map_err(|e| format!("Failed to save templates: {}", e))?;

    Ok(templates)
}

#[command]
pub fn delete_template(app: AppHandle, template_id: String) -> Result<Vec<Template>, String> {
    let templates_path = get_templates_path(&app);

    if !templates_path.exists() {
        return Ok(vec![]);
    }

    let contents = fs::read_to_string(&templates_path)
        .map_err(|e| format!("Failed to read templates: {}", e))?;

    let mut templates: Vec<Template> = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse templates: {}", e))?;

    templates.retain(|t| t.id != template_id);

    let json = serde_json::to_string_pretty(&templates)
        .map_err(|e| format!("Failed to serialize templates: {}", e))?;

    fs::write(&templates_path, json)
        .map_err(|e| format!("Failed to save templates: {}", e))?;

    Ok(templates)
}

#[command]
pub fn reorder_templates(app: AppHandle, template_ids: Vec<String>) -> Result<Vec<Template>, String> {
    let templates_path = get_templates_path(&app);

    if !templates_path.exists() {
        return Ok(vec![]);
    }

    let contents = fs::read_to_string(&templates_path)
        .map_err(|e| format!("Failed to read templates: {}", e))?;

    let templates: Vec<Template> = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse templates: {}", e))?;

    // Reorder templates according to the provided order
    let mut reordered: Vec<Template> = vec![];
    for id in &template_ids {
        if let Some(template) = templates.iter().find(|t| &t.id == id) {
            reordered.push(template.clone());
        }
    }

    // Add any templates that weren't in the reorder list (shouldn't happen, but just in case)
    for template in &templates {
        if !template_ids.contains(&template.id) {
            reordered.push(template.clone());
        }
    }

    let json = serde_json::to_string_pretty(&reordered)
        .map_err(|e| format!("Failed to serialize templates: {}", e))?;

    fs::write(&templates_path, json)
        .map_err(|e| format!("Failed to save templates: {}", e))?;

    Ok(reordered)
}

