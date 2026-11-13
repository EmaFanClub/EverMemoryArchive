/**
 * @prism-shadow/ema - Cross-Platform Dual-Whitelist Sandbox Engine
 *
 * Enforces the two core EMA Sandbox invariants across Linux (Bubblewrap),
 * Windows (WSL2 + Bubblewrap with interop=false), and macOS (Seatbelt SBPL):
 *
 * 1. Directory Read/Write Whitelist:
 *    - Only the session's `workspace`, `scratchpad`, and in-memory `/tmp` are readable & writable.
 *    - Everything else under the user's home directory (`~/.ssh`, `~/.gnupg`, `web.db`,
 *      `ema/worlds/*.sqlite`, `.vault.toml`, other repositories) is completely hidden/unreadable
 *      except minimal read-only runtime assets (`node`, `ema.js`, `config.toml`).
 *
 * 2. Executable (`bin`) Whitelist with Mandatory EMA Agent Owner Approval:
 *    - System executable directories (`/usr/bin`, `/bin`, `/usr/sbin`, `/usr/local/bin`)
 *      expose ONLY the binaries listed in global `[sandbox].allowed_bins` plus the agent's
 *      `[sandbox].owner_approved_bins` in `config.toml`.
 *    - Any unapproved binary (such as `ssh`, `scp`, `sftp`, `curl`, `git`, `python3`) is
 *      blocked at the kernel mount/exec layer and panics immediately.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertSandboxBinaryAllowed,
  loadEmaAgentConfig,
  loadEmaGlobalConfig,
  type EmaAgentSpecificConfig,
  type EmaGlobalConfig,
} from "../config.js";

export interface EmaSandboxProfileOptions {
  workspaceRoot: string;
  scratchpadDir?: string;
  globalCfg: EmaGlobalConfig;
  agentCfg?: EmaAgentSpecificConfig | null;
  homeDir?: string;
  writableTemp?: boolean;
  network?: "open" | "local" | "none";
  /** Optional explicit host binary lookup override for deterministic unit testing. */
  resolveHostBin?: (binName: string) => string | null;
}

export interface EmaWindowsWslSandboxOptions extends EmaSandboxProfileOptions {
  distro: string;
}

/**
 * Returns the deduplicated list of binaries allowed in the sandbox (`allowed_bins` + `owner_approved_bins`).
 * Panics immediately if `[sandbox].allowed_bins` is missing or empty.
 */
export function resolveEffectiveAllowedBins(
  globalCfg: EmaGlobalConfig,
  agentCfg?: EmaAgentSpecificConfig | null,
): string[] {
  if (!globalCfg.sandbox || globalCfg.sandbox.allowedBins.length === 0) {
    throw new Error(
      `[EMA Sandbox Panic] Missing or empty [sandbox].allowed_bins in ${globalCfg.configPath}`,
    );
  }
  const combined = [
    ...globalCfg.sandbox.allowedBins,
    ...(agentCfg?.sandbox?.ownerApprovedBins ?? []),
  ]
    .map((b) => b.trim())
    .filter(Boolean);
  return [...new Set(combined)];
}

/**
 * Default resolver mapping a whitelisted binary name to its real executable path on a POSIX host.
 */
export function defaultResolvePosixHostBin(
  binName: string,
  homeDir: string = os.homedir(),
): string | null {
  if (binName === "node") {
    const nodeBin = path.join(homeDir, ".local", "node", "bin", "node");
    if (fs.existsSync(nodeBin)) return nodeBin;
  }
  if (binName === "penguin") {
    const penguinBin = path.join(homeDir, ".penguin", "data", "bin", "penguin");
    if (fs.existsSync(penguinBin)) return penguinBin;
  }
  const searchDirs = [
    "/usr/bin",
    "/bin",
    "/usr/local/bin",
    "/usr/sbin",
    path.join(homeDir, ".local", "bin"),
    path.join(homeDir, ".local", "share", "pnpm", "bin"),
    path.join(homeDir, ".local", "go", "bin"),
  ];
  for (const dir of searchDirs) {
    const candidate = path.join(dir, binName);
    if (fs.existsSync(candidate)) {
      return fs.realpathSync(candidate);
    }
  }
  return null;
}

/**
 * Builds the Linux Bubblewrap (`bwrap`) argument vector enforcing:
 * - `--tmpfs /etc/ssh` and `--tmpfs /usr/bin` (strict `bin` whitelist + `--remount-ro /usr/bin`)
 * - `--tmpfs <homeDir>` (home directory whitelist + `--remount-ro <homeDir>`)
 * - Read-write binds strictly for `workspaceRoot`, `scratchpadDir`, and `/tmp`.
 */
export function buildLinuxBwrapWhitelistArgs(options: EmaSandboxProfileOptions): string[] {
  const workspaceRoot = options.workspaceRoot?.trim();
  if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) {
    throw new Error(
      `[EMA Sandbox Panic] Invalid or non-absolute workspaceRoot: '${options.workspaceRoot}'`,
    );
  }
  if (options.network === "local") {
    throw new Error(
      "[EMA Sandbox Panic] Linux Bubblewrap does not support 'local' network mode natively; use 'open' or 'none'.",
    );
  }

  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const allowedBins = resolveEffectiveAllowedBins(options.globalCfg, options.agentCfg);
  const resolveBin =
    options.resolveHostBin ?? ((bin: string) => defaultResolvePosixHostBin(bin, homeDir));

  const args: string[] = [
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--die-with-parent",
  ];

  if (options.writableTemp !== false) {
    args.push("--tmpfs", "/tmp");
  }

  // 1. Blank out /etc/ssh and all system executable directories
  const sysBinDirs = [
    "/etc/ssh",
    "/usr/bin",
    "/usr/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/usr/games",
    "/usr/local/games",
    "/usr/lib/git-core",
    "/usr/lib/openssh",
    "/usr/libexec",
  ];
  for (const dir of sysBinDirs) {
    args.push("--tmpfs", dir);
  }

  // 2. Mount only whitelisted binaries into /usr/bin (and home bin paths for node/penguin)
  const homeBinMounts: string[] = [];
  for (const bin of allowedBins) {
    const resolved = resolveBin(bin);
    if (!resolved) continue;
    args.push("--ro-bind", resolved, `/usr/bin/${bin}`);
    if (bin === "node" || bin === "penguin") {
      homeBinMounts.push("--ro-bind", resolved, resolved);
    }
  }

  // 3. Lock system executable directories read-only
  for (const dir of sysBinDirs) {
    args.push("--remount-ro", dir);
  }

  // 4. Blank out homeDir and mount only minimal read-only runtime + config.toml files
  args.push("--tmpfs", homeDir);
  args.push(...homeBinMounts);

  const penguinHome = path.join(homeDir, ".penguin", "data");
  const sandboxProfile = path.join(penguinHome, "shell-startup", "sandbox-profile");
  args.push(
    "--ro-bind-try",
    sandboxProfile,
    path.join(homeDir, ".profile"),
    "--ro-bind-try",
    path.join(penguinHome, "shell-startup"),
    path.join(penguinHome, "shell-startup"),
    "--ro-bind",
    options.globalCfg.configPath,
    options.globalCfg.configPath,
  );

  if (options.agentCfg) {
    args.push("--ro-bind", options.agentCfg.configPath, options.agentCfg.configPath);
  }

  for (const roPath of options.globalCfg.sandbox?.roPaths ?? []) {
    args.push("--ro-bind-try", roPath, roPath);
  }

  // 5. Mount writable roots: workspaceRoot and scratchpadDir ONLY
  const resolvedWorkspace = path.resolve(workspaceRoot);
  args.push("--bind", resolvedWorkspace, resolvedWorkspace);

  if (options.scratchpadDir) {
    const resolvedScratchpad = path.resolve(options.scratchpadDir);
    if (resolvedScratchpad !== resolvedWorkspace) {
      args.push("--bind", resolvedScratchpad, resolvedScratchpad);
    }
  }

  if (options.network === "none") {
    args.push("--unshare-net");
  }

  // 6. Lock homeDir skeleton read-only
  args.push("--remount-ro", homeDir);

  return args;
}

/**
 * Converts a Windows path (`C:\Users\rei\work\repo`) to its WSL2 `/mnt/<drive>/...` path.
 * Panics if the path cannot be mapped to a local WSL drive path.
 */
export function toWslLinuxPath(windowsPath: string): string {
  const trimmed = windowsPath.trim();
  if (trimmed.startsWith("/")) {
    return path.posix.normalize(trimmed);
  }
  const match = /^([A-Za-z]):(?:[\\/](.*))?$/.exec(trimmed);
  if (!match) {
    throw new Error(
      `[EMA Sandbox Panic] Windows path '${windowsPath}' cannot be mapped to a WSL /mnt/<drive> path.`,
    );
  }
  const drive = match[1]!.toLowerCase();
  const rest = (match[2] ?? "").split(/[\\/]+/).filter(Boolean);
  return ["/mnt", drive, ...rest].join("/");
}

/**
 * Builds the Windows WSL2 (`@penguinharness/sandbox-wsl`) Bubblewrap argument vector enforcing:
 * - `--tmpfs /run` and `--tmpfs /mnt` (hiding all Windows drives including `C:\Users\<user>\.ssh`)
 * - `--tmpfs /etc/ssh` and `--tmpfs /usr/bin` (strict `bin` whitelist + `--remount-ro /usr/bin`)
 * - Read-write binds strictly for `workspace` and `scratchpad` under `/mnt/<drive>/...`, followed by `--remount-ro /mnt`.
 */
export function buildWindowsWslBwrapWhitelistArgs(
  options: EmaWindowsWslSandboxOptions,
): string[] {
  if (!options.distro || !options.distro.trim()) {
    throw new Error("[EMA Sandbox Panic] Missing required WSL sandbox distro name.");
  }
  if (options.network === "local") {
    throw new Error(
      "[EMA Sandbox Panic] Windows WSL Bubblewrap does not support 'local' network mode natively; use 'open' or 'none'.",
    );
  }

  const wslWorkspace = toWslLinuxPath(options.workspaceRoot);
  const wslScratchpad = options.scratchpadDir ? toWslLinuxPath(options.scratchpadDir) : undefined;
  const allowedBins = resolveEffectiveAllowedBins(options.globalCfg, options.agentCfg);
  const resolveBin = options.resolveHostBin ?? ((bin: string) => `/usr/bin/${bin}`);

  // Bubblewrap does not support --share-net. Unshare namespaces individually.
  const args: string[] = [
    "--die-with-parent",
    "--unshare-user",
    "--unshare-ipc",
    "--unshare-pid",
    "--unshare-uts",
    "--unshare-cgroup-try",
  ];
  if (options.network === "none") {
    args.push("--unshare-net");
  }
  args.push(
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/run",
    "--ro-bind-try",
    "/run/resolvconf/resolv.conf",
    "/run/resolvconf/resolv.conf",
  );

  if (options.writableTemp !== false) {
    args.push("--tmpfs", "/tmp");
  }

  // 1. Strict /usr/bin and /etc/ssh whitelist inside the WSL distro
  const sysBinDirs = [
    "/etc/ssh",
    "/usr/bin",
    "/usr/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/usr/lib/git-core",
    "/usr/lib/openssh",
    "/usr/libexec",
  ];
  for (const dir of sysBinDirs) {
    args.push("--tmpfs", dir);
  }
  for (const bin of allowedBins) {
    const resolved = resolveBin(bin);
    if (!resolved) continue;
    args.push("--ro-bind", resolved, `/usr/bin/${bin}`);
  }
  for (const dir of sysBinDirs) {
    args.push("--remount-ro", dir);
  }

  // 2. Blank out WSL Linux user home to protect ~/.ssh, ~/.penguin, etc.
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  args.push("--tmpfs", homeDir);

  // 3. Blank out /mnt (all Windows drives, C:\Users\<user>\.ssh, etc.) and mount ONLY workspace & scratchpad
  args.push("--tmpfs", "/mnt");
  args.push("--bind", wslWorkspace, wslWorkspace);
  if (wslScratchpad && wslScratchpad !== wslWorkspace) {
    args.push("--bind", wslScratchpad, wslScratchpad);
  }
  args.push(
    "--ro-bind-try",
    "/mnt/wsl/resolv.conf",
    "/mnt/wsl/resolv.conf",
    "--remount-ro",
    "/mnt",
  );

  // 4. Lock homeDir skeleton read-only
  args.push("--remount-ro", homeDir);

  return args;
}

function sbplString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * Builds the macOS Seatbelt (`sandbox-exec -p`) SBPL profile enforcing:
 * - `(deny file-write*)` and `(deny file-read* file-write* (subpath "<homeDir>") (subpath "/private/etc/ssh"))`
 * - Read-only access under `<homeDir>` strictly for minimal runtime + `config.toml`
 * - Read-write access strictly for `workspaceRoot`, `scratchpadDir`, and `/private/tmp`
 * - `(deny process-exec*)` + `(allow process-exec* ...)` strictly for whitelisted binaries (`allowed_bins` + `owner_approved_bins`).
 */
export function buildMacosSeatbeltWhitelistProfile(options: EmaSandboxProfileOptions): string {
  const workspaceRoot = options.workspaceRoot?.trim();
  if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) {
    throw new Error(
      `[EMA Sandbox Panic] Invalid or non-absolute workspaceRoot: '${options.workspaceRoot}'`,
    );
  }

  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const allowedBins = resolveEffectiveAllowedBins(options.globalCfg, options.agentCfg);
  const resolveBin =
    options.resolveHostBin ??
    ((bin: string) => defaultResolvePosixHostBin(bin, homeDir) ?? `/usr/bin/${bin}`);

  const resolvedBins = [
    ...new Set(
      allowedBins
        .map((bin) => resolveBin(bin))
        .filter((p): p is string => typeof p === "string" && p.length > 0),
    ),
  ];

  const writeSinks = ["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/dtracehelper"];
  const rules: string[] = [
    "(version 1)",
    "(allow default)",
    "(deny file-write*)",
    `(allow file-write* ${writeSinks.map((s) => `(literal ${sbplString(s)})`).join(" ")})`,
    // 1. Deny all reads and writes to the user's home directory and /private/etc/ssh
    `(deny file-read* file-write* (subpath ${sbplString(homeDir)}) (subpath "/private/etc/ssh"))`,
    // 2. Allow read-only access strictly to minimal runtime and config.toml files
    `(allow file-read* (literal ${sbplString(homeDir)}) (subpath ${sbplString(path.join(homeDir, ".local", "node"))}) (literal ${sbplString(options.globalCfg.configPath)})${
      options.agentCfg ? ` (literal ${sbplString(options.agentCfg.configPath)})` : ""
    })`,
  ];

  // 3. Allow read-write access strictly to workspace, scratchpad, and /private/tmp
  const rwSubpaths = [path.resolve(workspaceRoot)];
  if (options.scratchpadDir) {
    rwSubpaths.push(path.resolve(options.scratchpadDir));
  }
  if (options.writableTemp !== false) {
    rwSubpaths.push("/private/tmp", "/tmp", "/private/var/folders", "/var/folders");
  }
  rules.push(
    `(allow file-read* file-write* ${[...new Set(rwSubpaths)]
      .map((p) => `(subpath ${sbplString(p)})`)
      .join(" ")})`,
  );

  // 4. Enforce strict process-exec* binary whitelist
  rules.push("(deny process-exec*)");
  if (resolvedBins.length > 0) {
    rules.push(
      `(allow process-exec* ${resolvedBins.map((p) => `(literal ${sbplString(p)})`).join(" ")})`,
    );
  }

  // 5. Enforce network policy
  if (options.network === "none") {
    rules.push("(deny network*)");
  } else if (options.network === "local") {
    rules.push(
      "(deny network*)",
      '(allow network-outbound (remote ip "localhost:*"))',
      '(allow network-bind (local ip "localhost:*"))',
      '(allow network-inbound (local ip "localhost:*"))',
    );
  }

  return rules.join(" ");
}

/**
 * Returns a structured diagnostic summary of the active EMA Dual-Whitelist Sandbox configuration.
 */
export function getEmaSandboxStatus(options: {
  configPath?: string;
  agentId?: string;
  platform?: NodeJS.Platform;
} = {}) {
  const globalCfg = loadEmaGlobalConfig(options.configPath);
  const agentCfg = options.agentId
    ? loadEmaAgentConfig(options.agentId, { globalConfigPath: options.configPath })
    : null;
  const effectiveBins = resolveEffectiveAllowedBins(globalCfg, agentCfg);
  const platform = options.platform ?? process.platform;
  const homeDir = os.homedir();

  return {
    platform,
    backend:
      platform === "linux"
        ? "penguin-bwrap (bwrap-whitelist)"
        : platform === "darwin"
          ? "penguin-seatbelt (seatbelt-whitelist)"
          : platform === "win32"
            ? "penguin-wsl (wsl2 + bwrap-whitelist, interop=false)"
            : `unsupported (${platform})`,
    owner: agentCfg?.agent.owner ?? globalCfg.sandbox!.owner,
    writableRoots: ["<session.workspace>", "<session.scratchpad>", "/tmp"],
    hiddenPaths: [
      path.join(homeDir, ".ssh"),
      path.join(homeDir, ".gnupg"),
      path.join(homeDir, ".config"),
      path.join(homeDir, ".penguin", "data", "web.db"),
      globalCfg.world.dataDir,
      "<all agent_state/.vault.toml>",
      "/etc/ssh",
    ],
    allowedBinsCount: globalCfg.sandbox!.allowedBins.length,
    allowedBins: globalCfg.sandbox!.allowedBins,
    ownerApprovedBins: agentCfg?.sandbox?.ownerApprovedBins ?? [],
    effectiveBinsCount: effectiveBins.length,
    sshBlocked: !effectiveBins.includes("ssh"),
  };
}

export { assertSandboxBinaryAllowed };
