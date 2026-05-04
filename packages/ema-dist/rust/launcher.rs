use crate::config::RuntimeConfig;
use crate::util::{
    app_root_from_current_exe, find_on_path, normalize_open_mode, os_string_to_string, prompt_value,
};
use crate::EmaResult;
use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const HELP: &str = "\
Usage:
  ema-launcher
  ema-launcher configure
  ema-launcher start
  ema-launcher open-webui <url> [webview|browser|none] [node]
";

pub fn run() -> EmaResult<i32> {
    let mut args = env::args_os().skip(1);
    let command = args
        .next()
        .and_then(|value| value.into_string().ok())
        .unwrap_or_else(|| "start".to_string());
    let app_root = app_root_from_current_exe()?;

    match command.as_str() {
        "configure" => configure(&app_root),
        "start" => start(&app_root),
        "open-webui" => {
            let url = args
                .next()
                .map(|value| os_string_to_string(&value))
                .unwrap_or_default();
            let mode = args
                .next()
                .map(|value| os_string_to_string(&value))
                .unwrap_or_else(|| "webview".to_string());
            let node = args.next().map(PathBuf::from);
            open_webui(&app_root, &url, &mode, node.as_deref())
        }
        "help" | "--help" | "-h" => {
            print!("{HELP}");
            Ok(0)
        }
        other => Err(format!("Unknown ema-launcher command '{other}'.\n\n{HELP}").into()),
    }
}

fn configure(app_root: &Path) -> EmaResult<i32> {
    let existing = RuntimeConfig::load_for_app(app_root)?;
    let node_path = prompt_value(
        "Node executable path",
        existing.value_or("EMA_NODE_PATH", ""),
    )?;
    let mongo_path = prompt_value(
        "mongod executable path",
        existing.value_or("EMA_MONGO_PATH", ""),
    )?;
    let mongo_uri = prompt_value(
        "MongoDB URI [start local mongod]",
        existing.value_or("EMA_MONGO_URI", ""),
    )?;
    let host = prompt_value("WebUI host", existing.value_or("EMA_HOST", "127.0.0.1"))?;
    let port = prompt_value("WebUI port", existing.value_or("EMA_PORT", "3000"))?;
    let open_mode = normalize_open_mode(&prompt_value(
        "Open mode [webview/browser/none]",
        existing.value_or("EMA_OPEN_MODE", "webview"),
    )?);

    let install_dir = app_root.to_path_buf();
    let install_parent = existing
        .get("EMA_INSTALL_PARENT")
        .map(PathBuf::from)
        .or_else(|| install_dir.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| PathBuf::from("."));

    let mut config = RuntimeConfig::default();
    config.set("EMA_INSTALL_PARENT", install_parent.to_string_lossy());
    config.set("EMA_INSTALL_DIR", install_dir.to_string_lossy());
    config.set("EMA_NODE_PATH", node_path);
    config.set("EMA_MONGO_PATH", mongo_path);
    config.set("EMA_MONGO_URI", mongo_uri);
    config.set("EMA_HOST", host);
    config.set("EMA_PORT", port);
    config.set("EMA_OPEN_MODE", open_mode);
    let config_file = config.write_user_file()?;
    println!("Wrote {}", config_file.display());
    Ok(0)
}

fn start(app_root: &Path) -> EmaResult<i32> {
    let config = RuntimeConfig::load_for_app(app_root)?;
    let server_js = app_root.join(read_server_relative_path(app_root)?);
    let data_root = env::var_os("EMA_DATA_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| app_root.join(".ema"));
    let host = config.value_or("EMA_HOST", "127.0.0.1").to_string();
    let port = config.value_or("EMA_PORT", "3000").to_string();
    let mongo_port = env::var("EMA_MONGO_PORT").unwrap_or_else(|_| "27017".to_string());
    let open_mode = normalize_open_mode(config.value_or("EMA_OPEN_MODE", "webview"));
    let node_bin = resolve_node(app_root, config.get("EMA_NODE_PATH"))?;

    fs::create_dir_all(data_root.join("mongodb"))?;
    fs::create_dir_all(data_root.join("logs"))?;
    fs::create_dir_all(data_root.join("workspace"))?;

    let mut mongo_child = None;
    let mongo_uri = if let Some(uri) = config.get("EMA_MONGO_URI") {
        uri.to_string()
    } else {
        let mongo_bin = resolve_mongo(app_root, config.get("EMA_MONGO_PATH"))?;
        let uri = format!("mongodb://127.0.0.1:{mongo_port}/");
        let child = Command::new(&mongo_bin)
            .arg("--dbpath")
            .arg(data_root.join("mongodb"))
            .arg("--port")
            .arg(&mongo_port)
            .arg("--bind_ip")
            .arg("127.0.0.1")
            .arg("--logpath")
            .arg(data_root.join("logs").join("mongodb.log"))
            .stdin(Stdio::null())
            .spawn()
            .map_err(|error| {
                format!(
                    "Failed to start MongoDB at {}: {error}",
                    mongo_bin.display()
                )
            })?;
        mongo_child = Some(child);
        uri
    };

    let webui_url = format!("http://{host}:{port}/");
    if open_mode != "none" {
        spawn_open_webui(&webui_url, &open_mode, &node_bin)?;
    }

    println!("EverMemoryArchive is starting at {webui_url}");
    let status = Command::new(&node_bin)
        .arg(&server_js)
        .env("HOSTNAME", &host)
        .env("PORT", &port)
        .env("EMA_SERVER_MODE", "prod")
        .env("EMA_SERVER_MONGO_KIND", "remote")
        .env("EMA_SERVER_MONGO_URI", &mongo_uri)
        .env(
            "EMA_SERVER_MONGO_DB",
            env::var("EMA_MONGO_DB").unwrap_or_else(|_| "ema".to_string()),
        )
        .env("EMA_SERVER_DATA_ROOT", &data_root)
        .status()
        .map_err(|error| {
            format!(
                "Failed to start server with {} {}: {error}",
                node_bin.display(),
                server_js.display()
            )
        })?;

    if let Some(mut child) = mongo_child {
        let _ = child.kill();
        let _ = child.wait();
    }

    Ok(status.code().unwrap_or(1))
}

fn open_webui(
    app_root: &Path,
    url: &str,
    mode: &str,
    configured_node: Option<&Path>,
) -> EmaResult<i32> {
    let mode = normalize_open_mode(mode);
    if url.is_empty() || mode == "none" {
        return Ok(0);
    }

    let node_bin = match configured_node {
        Some(path) if !path.as_os_str().is_empty() => path.to_path_buf(),
        _ => {
            let config = RuntimeConfig::load_for_app(app_root)?;
            resolve_node(app_root, config.get("EMA_NODE_PATH"))?
        }
    };
    let opener = app_root.join("launcher").join("open-webui.mjs");
    let status = Command::new(&node_bin)
        .arg(&opener)
        .arg(url)
        .arg(mode)
        .status()
        .map_err(|error| {
            format!(
                "Failed to run WebUI opener with {} {}: {error}",
                node_bin.display(),
                opener.display()
            )
        })?;
    Ok(status.code().unwrap_or(1))
}

fn spawn_open_webui(url: &str, mode: &str, node_bin: &Path) -> EmaResult<()> {
    let exe = env::current_exe()?;
    Command::new(exe)
        .arg("open-webui")
        .arg(url)
        .arg(mode)
        .arg(node_bin)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    Ok(())
}

fn resolve_node(app_root: &Path, configured: Option<&str>) -> EmaResult<PathBuf> {
    if let Some(path) = configured {
        return Ok(PathBuf::from(path));
    }

    for candidate in portable_node_candidates(app_root) {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    find_on_path(if cfg!(windows) { "node.exe" } else { "node" })
        .ok_or_else(|| "Node.js was not found. Run configure or put node on PATH.".into())
}

fn resolve_mongo(app_root: &Path, configured: Option<&str>) -> EmaResult<PathBuf> {
    if let Some(path) = configured {
        return Ok(PathBuf::from(path));
    }

    for candidate in portable_mongo_candidates(app_root) {
        if candidate.is_file() {
            return Ok(candidate);
        }
    }

    find_on_path(if cfg!(windows) {
        "mongod.exe"
    } else {
        "mongod"
    })
    .ok_or_else(|| {
        "MongoDB was not found. Run configure, set EMA_MONGO_URI, or put mongod on PATH.".into()
    })
}

fn portable_node_candidates(app_root: &Path) -> Vec<PathBuf> {
    if cfg!(windows) {
        vec![app_root.join("portables").join("node").join("node.exe")]
    } else {
        vec![app_root
            .join("portables")
            .join("node")
            .join("bin")
            .join("node")]
    }
}

fn portable_mongo_candidates(app_root: &Path) -> Vec<PathBuf> {
    let binary = if cfg!(windows) {
        "mongod.exe"
    } else {
        "mongod"
    };
    vec![app_root
        .join("portables")
        .join("mongodb")
        .join("bin")
        .join(binary)]
}

fn read_server_relative_path(app_root: &Path) -> EmaResult<PathBuf> {
    let value = fs::read_to_string(app_root.join("server-relpath.txt"))?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("server-relpath.txt is empty.".into());
    }
    Ok(PathBuf::from(trimmed))
}

#[allow(dead_code)]
fn _args_debug(args: &[OsString]) -> String {
    args.iter()
        .map(|arg| arg.to_string_lossy())
        .collect::<Vec<_>>()
        .join(" ")
}
