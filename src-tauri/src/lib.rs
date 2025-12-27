mod commands;
mod models;

use tauri::Manager;
use commands::{
    create_project, delete_media, delete_project, get_all_projects, get_preferences, get_project,
    import_media_files, rename_project, save_preferences, update_project,
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
            std::fs::create_dir_all(app_data_dir.join("media"))?;
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
            import_media_files,
            delete_media,
            get_preferences,
            save_preferences,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
