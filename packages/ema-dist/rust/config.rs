use crate::EmaResult;
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const RUNTIME_ENV_FILE: &str = "ema-runtime.env";

const RUNTIME_ENV_KEYS: &[&str] = &[
    "EMA_INSTALL_PARENT",
    "EMA_INSTALL_DIR",
    "EMA_NODE_PATH",
    "EMA_MONGO_PATH",
    "EMA_MONGO_URI",
    "EMA_HOST",
    "EMA_PORT",
    "EMA_OPEN_MODE",
];

#[derive(Clone, Debug, Default)]
pub struct RuntimeConfig {
    values: BTreeMap<String, String>,
}

impl RuntimeConfig {
    pub fn load_for_app(app_root: &Path) -> EmaResult<Self> {
        let mut config = Self::from_process_env();
        let user_file = config_file_path();
        if user_file.is_file() {
            config.load_file(&user_file)?;
        } else {
            let app_file = app_root.join(RUNTIME_ENV_FILE);
            if app_file.is_file() {
                config.load_file(&app_file)?;
            }
        }
        Ok(config)
    }

    pub fn load_user_or_env() -> EmaResult<Self> {
        let mut config = Self::from_process_env();
        let user_file = config_file_path();
        if user_file.is_file() {
            config.load_file(&user_file)?;
        }
        Ok(config)
    }

    pub fn get(&self, key: &str) -> Option<&str> {
        self.values
            .get(key)
            .map(String::as_str)
            .filter(|value| !value.is_empty())
    }

    pub fn value_or<'a>(&'a self, key: &str, default: &'a str) -> &'a str {
        self.get(key).unwrap_or(default)
    }

    pub fn set(&mut self, key: &str, value: impl Into<String>) {
        self.values.insert(key.to_string(), value.into());
    }

    pub fn write_user_file(&self) -> EmaResult<PathBuf> {
        let config_dir = config_dir_path();
        fs::create_dir_all(&config_dir)?;
        let config_file = config_dir.join(RUNTIME_ENV_FILE);
        let mut file = fs::File::create(&config_file)?;
        for key in RUNTIME_ENV_KEYS {
            let value = self.values.get(*key).map(String::as_str).unwrap_or("");
            if value.contains('\n') || value.contains('\r') {
                return Err(format!("Refusing to write newline in {key}.").into());
            }
            writeln!(file, "{key}={value}")?;
        }
        Ok(config_file)
    }

    fn from_process_env() -> Self {
        let mut values = BTreeMap::new();
        for key in RUNTIME_ENV_KEYS {
            if let Ok(value) = env::var(key) {
                values.insert((*key).to_string(), value);
            }
        }
        Self { values }
    }

    fn load_file(&mut self, file_path: &Path) -> EmaResult<()> {
        let source = fs::read_to_string(file_path)?;
        for line in source.lines() {
            let line = line.trim_end_matches('\r');
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            if RUNTIME_ENV_KEYS.contains(&key) {
                self.values.insert(key.to_string(), value.to_string());
            }
        }
        Ok(())
    }
}

pub fn config_file_path() -> PathBuf {
    config_dir_path().join(RUNTIME_ENV_FILE)
}

pub fn config_dir_path() -> PathBuf {
    if let Some(path) = env::var_os("EMA_CONFIG_HOME") {
        return PathBuf::from(path);
    }

    if cfg!(windows) {
        if let Some(path) = env::var_os("APPDATA") {
            return PathBuf::from(path).join("ema");
        }
        return home_dir().join(".config").join("ema");
    }

    if cfg!(target_os = "macos") {
        return home_dir()
            .join("Library")
            .join("Application Support")
            .join("ema");
    }

    if let Some(path) = env::var_os("XDG_CONFIG_HOME") {
        return PathBuf::from(path).join("ema");
    }
    home_dir().join(".config").join("ema")
}

pub fn home_dir() -> PathBuf {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_key_value_lines_without_executing_shell_syntax() {
        let dir = env::temp_dir().join(format!("ema-config-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("env");
        fs::write(
            &file,
            "# ignored\nEMA_HOST=0.0.0.0\nexport EMA_PORT=bad\nEMA_PORT=3030\nEMPTY\n",
        )
        .unwrap();

        let mut config = RuntimeConfig::default();
        config.load_file(&file).unwrap();

        assert_eq!(config.get("EMA_HOST"), Some("0.0.0.0"));
        assert_eq!(config.get("EMA_PORT"), Some("3030"));
        assert_eq!(config.get("export EMA_PORT"), None);

        fs::remove_dir_all(dir).unwrap();
    }
}
