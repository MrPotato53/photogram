mod commands;
mod models;

use tauri::{Emitter, Manager};
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use commands::{
    bulk_relink_media, check_media_exists, create_project, delete_element_asset, delete_media,
    delete_project, delete_template, embed_element_asset, export_slides, get_all_projects,
    get_preferences, get_project, get_templates, import_media_files, relink_media, rename_project,
    reorder_templates, save_preferences, save_project_thumbnail, save_template, show_in_folder,
    update_project,
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

            // Build native menu. On macOS the first submenu becomes the app
            // menu (named after the bundle). On other platforms the menu
            // shows up under the window. We reconstruct the conventional
            // app/edit/window items because setting a custom menu replaces
            // the platform default — otherwise we'd lose Cut/Copy/Paste etc.
            let handle = app.handle();
            let shortcuts_item = MenuItemBuilder::with_id("open_shortcuts", "Keyboard Shortcuts…")
                .accelerator("CmdOrCtrl+/")
                .build(handle)?;

            let app_submenu = SubmenuBuilder::new(handle, "Photogram")
                .item(&PredefinedMenuItem::about(handle, None, None)?)
                .separator()
                .item(&shortcuts_item)
                .separator()
                .item(&PredefinedMenuItem::hide(handle, None)?)
                .item(&PredefinedMenuItem::hide_others(handle, None)?)
                .item(&PredefinedMenuItem::show_all(handle, None)?)
                .separator()
                .item(&PredefinedMenuItem::quit(handle, None)?)
                .build()?;

            let edit_submenu = SubmenuBuilder::new(handle, "Edit")
                .item(&PredefinedMenuItem::undo(handle, None)?)
                .item(&PredefinedMenuItem::redo(handle, None)?)
                .separator()
                .item(&PredefinedMenuItem::cut(handle, None)?)
                .item(&PredefinedMenuItem::copy(handle, None)?)
                .item(&PredefinedMenuItem::paste(handle, None)?)
                .item(&PredefinedMenuItem::select_all(handle, None)?)
                .build()?;

            let window_submenu = SubmenuBuilder::new(handle, "Window")
                .item(&PredefinedMenuItem::minimize(handle, None)?)
                .item(&PredefinedMenuItem::fullscreen(handle, None)?)
                .build()?;

            let menu = MenuBuilder::new(handle)
                .items(&[&app_submenu, &edit_submenu, &window_submenu])
                .build()?;
            app.set_menu(menu)?;

            // Bridge menu clicks → frontend. The webview listens for this
            // event and opens the Keyboard Shortcuts modal.
            app.on_menu_event(move |app, event| {
                if event.id().as_ref() == "open_shortcuts" {
                    let _ = app.emit("menu:open-shortcuts", ());
                }
            });

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
            bulk_relink_media,
            embed_element_asset,
            delete_element_asset,
            get_templates,
            save_template,
            delete_template,
            reorder_templates,
            export_slides,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
