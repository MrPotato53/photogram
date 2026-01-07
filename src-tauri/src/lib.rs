mod commands;
mod models;

use tauri::Manager;
use commands::{
    check_media_exists, create_project, delete_element_asset, delete_media, delete_project,
    delete_template, embed_element_asset, get_all_projects, get_preferences, get_project,
    get_templates, import_media_files, relink_media, rename_project, reorder_templates,
    save_preferences, save_project_thumbnail, save_template, show_in_folder, update_project,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Ensure data directories exist
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");
            std::fs::create_dir_all(app_data_dir.join("projects"))?;
            std::fs::create_dir_all(app_data_dir.join("thumbnails"))?;
            std::fs::create_dir_all(app_data_dir.join("project_thumbnails"))?;
            std::fs::create_dir_all(app_data_dir.join("assets"))?;
            std::fs::create_dir_all(app_data_dir.join("templates"))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_all_projects,
            get_project,
            create_project,
            update_project,
            delete_project,
            rename_project,
            save_project_thumbnail,
            import_media_files,
            delete_media,
            get_preferences,
            save_preferences,
            show_in_folder,
            check_media_exists,
            relink_media,
            embed_element_asset,
            delete_element_asset,
            get_templates,
            save_template,
            delete_template,
            reorder_templates,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
