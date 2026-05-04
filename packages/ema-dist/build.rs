use std::env;
use std::error::Error;
use std::fs::{self, File};
use std::path::{Path, PathBuf};

fn main() -> Result<(), Box<dyn Error>> {
    println!("cargo:rerun-if-env-changed=EMA_DIST_SETUP_PAYLOAD_DIR");
    println!("cargo:rerun-if-env-changed=EMA_DIST_SETUP_PLATFORM");
    println!("cargo:rerun-if-env-changed=EMA_DIST_SETUP_KIND");

    let out_dir = PathBuf::from(env::var("OUT_DIR")?);
    let payload_out = out_dir.join("setup-payload.tar.zst");

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

fn write_payload_archive(source_root: &Path, output: &Path) -> Result<(), Box<dyn Error>> {
    let file = File::create(output)?;
    let encoder = zstd::stream::write::Encoder::new(file, 19)?;
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
