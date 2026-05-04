use crate::EmaResult;
use std::env;
use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub fn app_root_from_current_exe() -> EmaResult<PathBuf> {
    if let Some(path) = env::var_os("EMA_APP_ROOT") {
        return Ok(PathBuf::from(path));
    }
    let exe = env::current_exe()?;
    Ok(exe
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from("."))))
}

pub fn prompt_value(label: &str, default_value: &str) -> EmaResult<String> {
    if default_value.is_empty() {
        eprint!("{label}: ");
    } else {
        eprint!("{label} [{default_value}]: ");
    }
    io::stderr().flush()?;

    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    let value = input.trim_end_matches(['\r', '\n']);
    if value.is_empty() {
        Ok(default_value.to_string())
    } else {
        Ok(value.to_string())
    }
}

pub fn normalize_open_mode(value: &str) -> String {
    match value {
        "y" | "Y" | "yes" | "YES" => "browser".to_string(),
        "n" | "N" | "no" | "NO" => "webview".to_string(),
        "" => "webview".to_string(),
        other if other.eq_ignore_ascii_case("browser") => "browser".to_string(),
        other if other.eq_ignore_ascii_case("webview") => "webview".to_string(),
        other if other.eq_ignore_ascii_case("none") => "none".to_string(),
        other => {
            eprintln!("Unknown EMA_OPEN_MODE \"{other}\"; falling back to webview.");
            "webview".to_string()
        }
    }
}

pub fn find_on_path(command: &str) -> Option<PathBuf> {
    if command.is_empty() {
        return None;
    }

    let candidate = Path::new(command);
    if candidate.is_absolute() || command.contains(std::path::MAIN_SEPARATOR) {
        return is_executable(candidate).then(|| candidate.to_path_buf());
    }

    let path = env::var_os("PATH")?;
    for dir in env::split_paths(&path) {
        for name in command_names(command) {
            let candidate = dir.join(name);
            if is_executable(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

pub fn make_executable(path: &Path) -> EmaResult<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(path)?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions)?;
    }
    Ok(())
}

pub fn os_string_to_string(value: &OsStr) -> String {
    value.to_string_lossy().into_owned()
}

fn command_names(command: &str) -> Vec<OsString> {
    if !cfg!(windows) || Path::new(command).extension().is_some() {
        return vec![OsString::from(command)];
    }

    let pathext = env::var_os("PATHEXT")
        .and_then(|value| value.into_string().ok())
        .unwrap_or_else(|| ".COM;.EXE;.BAT;.CMD".to_string());
    let mut names = vec![OsString::from(command)];
    for ext in pathext.split(';').filter(|ext| !ext.is_empty()) {
        names.push(OsString::from(format!("{command}{ext}")));
    }
    names
}

fn is_executable(path: &Path) -> bool {
    path.is_file()
}
