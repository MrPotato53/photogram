pub mod utils;
pub mod projects;
pub mod media;
pub mod preferences;
pub mod templates;

// Re-export all commands for easy access
pub use projects::*;
pub use media::*;
pub use preferences::*;
pub use templates::*;
