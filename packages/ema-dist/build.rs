use std::env;
use std::error::Error;
use std::ffi::OsString;
use std::fs::{self, File};
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() -> Result<(), Box<dyn Error>> {
    println!("cargo:rerun-if-env-changed=EMA_DIST_SETUP_PAYLOAD_DIR");
    println!("cargo:rerun-if-env-changed=EMA_DIST_SETUP_PLATFORM");
    println!("cargo:rerun-if-env-changed=EMA_DIST_SETUP_KIND");

    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR")?);
    let out_dir = PathBuf::from(env::var("OUT_DIR")?);
    let payload_out = out_dir.join("setup-payload.tar.zst");

    let icon_path = manifest_dir.join("assets").join("ema-logo.ico");
    println!("cargo:rerun-if-changed={}", icon_path.display());

    if matches!(env::var("CARGO_CFG_TARGET_OS").as_deref(), Ok("windows")) {
        let resource_path = write_windows_icon_resource(&out_dir, &icon_path)?;
        link_windows_resource(&resource_path);
    }

    if let Some(payload_dir) = env::var_os("EMA_DIST_SETUP_PAYLOAD_DIR") {
        let payload_dir = PathBuf::from(payload_dir);
        emit_rerun_for_tree(&payload_dir)?;
        write_payload_archive(&payload_dir, &payload_out)?;
    } else {
        fs::write(&payload_out, [])?;
    }

    let platform = env::var("EMA_DIST_SETUP_PLATFORM").unwrap_or_else(|_| "unknown".to_string());
    let kind = env::var("EMA_DIST_SETUP_KIND").unwrap_or_else(|_| "portable".to_string());
    println!("cargo:rustc-env=EMA_DIST_SETUP_PLATFORM={platform}");
    println!("cargo:rustc-env=EMA_DIST_SETUP_KIND={kind}");

    Ok(())
}

fn write_windows_icon_resource(
    out_dir: &Path,
    icon_path: &Path,
) -> Result<PathBuf, Box<dyn Error>> {
    let rc_path = out_dir.join("ema-dist-icon.rc");
    let res_path = out_dir.join("ema-dist-icon.res");
    fs::write(
        &rc_path,
        format!("1 ICON \"{}\"\n", escape_resource_path(icon_path)),
    )?;
    compile_windows_resource(&rc_path, &res_path)?;
    Ok(res_path)
}

fn compile_windows_resource(rc_path: &Path, res_path: &Path) -> Result<(), Box<dyn Error>> {
    let compilers = windows_resource_compilers();
    let explicit_compiler = compilers.len() == 1;
    let mut errors = Vec::new();

    for compiler in compilers {
        let output_arg = format!("/fo{}", res_path.display());
        let result = Command::new(&compiler)
            .arg("/nologo")
            .arg(output_arg)
            .arg(rc_path)
            .status();

        match result {
            Ok(status) if status.success() => return Ok(()),
            Ok(status) if explicit_compiler => {
                return Err(format!(
                    "Windows resource compiler '{}' exited with {status}.",
                    compiler.to_string_lossy()
                )
                .into());
            }
            Ok(status) => errors.push(format!(
                "'{}' exited with {status}",
                compiler.to_string_lossy()
            )),
            Err(error) if explicit_compiler => {
                return Err(format!(
                    "Failed to run Windows resource compiler '{}': {error}",
                    compiler.to_string_lossy()
                )
                .into());
            }
            Err(error) => errors.push(format!(
                "'{}' failed to start: {error}",
                compiler.to_string_lossy()
            )),
        }
    }

    Err(format!(
        "Failed to compile Windows icon resource with rc.exe or llvm-rc: {}",
        errors.join("; ")
    )
    .into())
}

fn windows_resource_compilers() -> Vec<OsString> {
    println!("cargo:rerun-if-env-changed=EMA_DIST_WINDOWS_RC");
    println!("cargo:rerun-if-env-changed=RC");

    let target_rc_key = env::var("TARGET").ok().map(|target| {
        format!(
            "CARGO_TARGET_{}_RC",
            target.replace('-', "_").to_uppercase()
        )
    });
    if let Some(key) = &target_rc_key {
        println!("cargo:rerun-if-env-changed={key}");
    }

    env::var_os("EMA_DIST_WINDOWS_RC")
        .or_else(|| target_rc_key.and_then(env::var_os))
        .or_else(|| env::var_os("RC"))
        .map(|compiler| vec![compiler])
        .unwrap_or_else(|| vec![OsString::from("rc.exe"), OsString::from("llvm-rc")])
}

fn link_windows_resource(resource_path: &Path) {
    println!(
        "cargo:rustc-link-arg-bin=ema-launcher={}",
        resource_path.display()
    );
    println!("cargo:rustc-link-arg-bin=setup={}", resource_path.display());
}

fn escape_resource_path(path: &Path) -> String {
    path.display()
        .to_string()
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
}

fn write_payload_archive(source_root: &Path, output: &Path) -> Result<(), Box<dyn Error>> {
    let file = File::create(output)?;
    let encoder = zstd::stream::write::Encoder::new(file, 5)?;
    let mut archive = tar::Builder::new(encoder.auto_finish());
    archive.mode(tar::HeaderMode::Deterministic);
    archive.append_dir_all("EverMemoryArchive", source_root)?;
    archive.finish()?;
    Ok(())
}

fn emit_rerun_for_tree(root: &Path) -> Result<(), Box<dyn Error>> {
    println!("cargo:rerun-if-changed={}", root.display());
    if !root.exists() {
        return Ok(());
    }
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            println!("cargo:rerun-if-changed={}", path.display());
            if entry.file_type()?.is_dir() {
                stack.push(path);
            }
        }
    }
    Ok(())
}
