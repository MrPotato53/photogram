use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AspectRatio {
    pub width: u32,
    pub height: u32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    pub id: String,
    pub file_name: String,
    pub file_path: String,
    pub thumbnail_path: Option<String>,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Element {
    pub id: String,
    #[serde(rename = "type")]
    pub element_type: String,
    pub media_id: Option<String>,
    // Embedded asset path (copy of image stored in project for portability)
    pub asset_path: Option<String>,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub rotation: f64,
    pub scale: f64,
    pub locked: bool,
    pub z_index: i32,
    pub span_frames: Option<Vec<String>>,
    // Crop (normalized 0-1, relative to original image)
    pub crop_x: Option<f64>,
    pub crop_y: Option<f64>,
    pub crop_width: Option<f64>,
    pub crop_height: Option<f64>,
    // Flip/mirror
    pub flip_x: Option<bool>,
    pub flip_y: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Slide {
    pub id: String,
    pub order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub aspect_ratio: AspectRatio,
    pub slides: Vec<Slide>,
    // Global elements - x coordinates span across all slides
    pub elements: Vec<Element>,
    pub media_pool: Vec<MediaItem>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub accessed_at: DateTime<Utc>,
    pub thumbnail: Option<String>,
}

impl Project {
    pub fn new(name: String, aspect_ratio: AspectRatio) -> Self {
        let now = Utc::now();
        let slide_id = Uuid::new_v4().to_string();

        Project {
            id: Uuid::new_v4().to_string(),
            name,
            aspect_ratio,
            slides: vec![Slide {
                id: slide_id,
                order: 0,
            }],
            elements: vec![],
            media_pool: vec![],
            created_at: now,
            updated_at: now,
            accessed_at: now,
            thumbnail: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub aspect_ratio: AspectRatio,
    pub slide_count: usize,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub accessed_at: DateTime<Utc>,
    pub thumbnail: Option<String>,
}

impl From<&Project> for ProjectSummary {
    fn from(project: &Project) -> Self {
        ProjectSummary {
            id: project.id.clone(),
            name: project.name.clone(),
            aspect_ratio: project.aspect_ratio.clone(),
            slide_count: project.slides.len(),
            created_at: project.created_at,
            updated_at: project.updated_at,
            accessed_at: project.accessed_at,
            thumbnail: project.thumbnail.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Preferences {
    pub theme: String,
    pub sort_by: String,
}

impl Preferences {
    pub fn default_preferences() -> Self {
        Preferences {
            theme: "dark".to_string(),
            sort_by: "accessedAt".to_string(),
        }
    }
}
