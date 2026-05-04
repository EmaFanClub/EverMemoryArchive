pub mod config;
pub mod launcher;
pub mod setup;
pub mod util;

pub type EmaResult<T> = Result<T, Box<dyn std::error::Error>>;
