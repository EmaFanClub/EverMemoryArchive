use crate::config::{home_dir, RuntimeConfig};
use crate::util::{make_executable, normalize_open_mode, prompt_value};
use crate::EmaResult;
use std::env;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};

const SETUP_PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/setup-payload.tar.zst"));
const SETUP_PLATFORM: &str = env!("EMA_DIST_SETUP_PLATFORM");
const SETUP_KIND: &str = env!("EMA_DIST_SETUP_KIND");

const HELP: &str = "\
Usage:
  setup [--install-parent <dir>] [--no-shortcut]

The setup executable contains an inline zstd-compressed EverMemoryArchive payload.
";

pub fn run() -> EmaResult<i32> {
    let options = SetupOptions::parse(env::args_os().skip(1))?;
    if options.help {
        print!("{HELP}");
        return Ok(0);
    }

    if SETUP_PAYLOAD.is_empty() {
        return Err("This setup executable was built without an embedded payload.".into());
    }

    let existing = RuntimeConfig::load_user_or_env()?;
    let default_parent = existing
        .get("EMA_INSTALL_PARENT")
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| home_dir().to_string_lossy().into_owned());
    let install_parent = match options.install_parent {
        Some(path) => path,
        None => PathBuf::from(prompt_value("Install parent directory", &default_parent)?),
    };
    fs::create_dir_all(&install_parent)?;
    extract_payload(&install_parent)?;

    let app_dir = install_parent.join("EverMemoryArchive");
    chmod_launchers(&app_dir);

    let mut node_path = String::new();
    let mut mongo_path = String::new();
    let mut mongo_uri = String::new();
    if SETUP_KIND == "minimal" {
        node_path = prompt_value(
            "Node executable path",
            existing.value_or("EMA_NODE_PATH", ""),
        )?;
        mongo_path = prompt_value(
            "mongod executable path",
            existing.value_or("EMA_MONGO_PATH", ""),
        )?;
        mongo_uri = prompt_value(
            "MongoDB URI [start local mongod]",
            existing.value_or("EMA_MONGO_URI", ""),
        )?;
    }

    let open_mode = normalize_open_mode(&prompt_value(
        "Open mode [webview/browser/none]",
        existing.value_or("EMA_OPEN_MODE", "webview"),
    )?);

    let mut config = RuntimeConfig::default();
    config.set("EMA_INSTALL_PARENT", install_parent.to_string_lossy());
    config.set("EMA_INSTALL_DIR", app_dir.to_string_lossy());
    config.set("EMA_NODE_PATH", node_path);
    config.set("EMA_MONGO_PATH", mongo_path);
    config.set("EMA_MONGO_URI", mongo_uri);
    config.set("EMA_HOST", existing.value_or("EMA_HOST", "127.0.0.1"));
    config.set("EMA_PORT", existing.value_or("EMA_PORT", "3000"));
    config.set("EMA_OPEN_MODE", open_mode);
    let config_file = config.write_user_file()?;
    println!("Wrote {}", config_file.display());

    if !options.no_shortcut && prompt_yes_default("Create desktop shortcut?", true)? {
        create_shortcut(&app_dir)?;
    }

    println!(
        "Installed EverMemoryArchive {SETUP_KIND} package for {SETUP_PLATFORM} to {}",
        app_dir.display()
    );
    println!("Run {} to start.", launcher_path(&app_dir).display());
    Ok(0)
}

fn extract_payload(install_parent: &Path) -> EmaResult<()> {
    let decoder = ruzstd::decoding::StreamingDecoder::new(Cursor::new(SETUP_PAYLOAD))?;
    let mut archive = tar::Archive::new(decoder);
    archive.unpack(install_parent)?;
    Ok(())
}

fn chmod_launchers(app_dir: &Path) {
    let _ = make_executable(&launcher_path(app_dir));
}

fn prompt_yes_default(label: &str, default_value: bool) -> EmaResult<bool> {
    let suffix = if default_value { "Y/n" } else { "y/N" };
    let input = prompt_value(label, suffix)?;
    if input == suffix {
        return Ok(default_value);
    }
    Ok(matches!(input.as_str(), "y" | "Y" | "yes" | "YES" | "Yes"))
}

fn create_shortcut(app_dir: &Path) -> EmaResult<()> {
    if cfg!(windows) {
        let desktop = home_dir().join("Desktop");
        if !desktop.is_dir() {
            return Ok(());
        }
        let shortcut = desktop.join("EverMemoryArchive.cmd");
        fs::write(
            &shortcut,
            format!(
                "@echo off\r\ncd /d \"{}\"\r\ncall \"{}\"\r\n",
                app_dir.display(),
                launcher_path(app_dir).display()
            ),
        )?;
        println!("Created {}", shortcut.display());
        return Ok(());
    }

    if cfg!(target_os = "macos") {
        let shortcut = home_dir().join("Desktop").join("EverMemoryArchive.command");
        fs::write(
            &shortcut,
            format!(
                "#!/usr/bin/env bash\ncd \"{}\"\nexec ./ema-launcher\n",
                app_dir.display()
            ),
        )?;
        make_executable(&shortcut)?;
        println!("Created {}", shortcut.display());
        return Ok(());
    }

    let applications = home_dir().join(".local").join("share").join("applications");
    fs::create_dir_all(&applications)?;
    let desktop_file = applications.join("evermemoryarchive.desktop");
    fs::write(
        &desktop_file,
        format!(
            "[Desktop Entry]\nType=Application\nName=EverMemoryArchive\nExec={}\nPath={}\nIcon={}\nTerminal=true\nCategories=Utility;\n",
            desktop_entry_exec_path(&launcher_path(app_dir)),
            desktop_entry_path_value(app_dir),
            desktop_entry_path_value(&app_icon_path(app_dir))
        ),
    )?;
    if home_dir().join("Desktop").is_dir() {
        let desktop_copy = home_dir().join("Desktop").join("EverMemoryArchive.desktop");
        fs::copy(&desktop_file, &desktop_copy)?;
        make_executable(&desktop_copy)?;
    }
    println!("Created {}", desktop_file.display());
    Ok(())
}

fn launcher_path(app_dir: &Path) -> PathBuf {
    if cfg!(windows) {
        app_dir.join("ema-launcher.exe")
    } else {
        app_dir.join("ema-launcher")
    }
}

fn app_icon_path(app_dir: &Path) -> PathBuf {
    app_dir.join("resources").join("ema-logo-min.jpg")
}

fn desktop_entry_exec_path(path: &Path) -> String {
    let mut escaped = String::from("\"");
    for ch in path.to_string_lossy().chars() {
        match ch {
            '"' | '`' => {
                escaped.push('\\');
                escaped.push(ch);
            }
            '\\' => escaped.push_str("\\\\\\\\"),
            '$' => escaped.push_str("\\\\$"),
            '%' => escaped.push_str("%%"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            other => escaped.push(other),
        }
    }
    escaped.push('"');
    escaped
}

fn desktop_entry_path_value(path: &Path) -> String {
    let mut escaped = String::new();
    for ch in path.to_string_lossy().chars() {
        match ch {
            '\\' => escaped.push_str("\\\\"),
            ' ' => escaped.push_str("\\s"),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            other => escaped.push(other),
        }
    }
    escaped
}

#[derive(Debug, Default)]
struct SetupOptions {
    help: bool,
    install_parent: Option<PathBuf>,
    no_shortcut: bool,
}

impl SetupOptions {
    fn parse(args: impl IntoIterator<Item = std::ffi::OsString>) -> EmaResult<Self> {
        let mut options = Self::default();
        let mut args = args.into_iter();
        while let Some(arg) = args.next() {
            match arg.to_string_lossy().as_ref() {
                "--help" | "-h" => options.help = true,
                "--no-shortcut" => options.no_shortcut = true,
                "--install-parent" => {
                    let Some(value) = args.next() else {
                        return Err("--install-parent requires a directory.".into());
                    };
                    options.install_parent = Some(PathBuf::from(value));
                }
                other => return Err(format!("Unknown setup option '{other}'.\n\n{HELP}").into()),
            }
        }
        Ok(options)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_entry_exec_path_quotes_and_escapes_command_path() {
        let path =
            Path::new("/tmp/Ever Memory/quoted\"/$dollar/`tick`/slash\\dir/percent%/ema-launcher");

        assert_eq!(
            desktop_entry_exec_path(path),
            "\"/tmp/Ever Memory/quoted\\\"/\\\\$dollar/\\`tick\\`/slash\\\\\\\\dir/percent%%/ema-launcher\""
        );
    }

    #[test]
    fn desktop_entry_path_value_escapes_plain_path_value() {
        let path = Path::new("/tmp/Ever Memory/quoted\"/slash\\tab\tline\nicon.jpg");

        assert_eq!(
            desktop_entry_path_value(path),
            "/tmp/Ever\\sMemory/quoted\"/slash\\\\tab\\tline\\nicon.jpg"
        );
    }
}
