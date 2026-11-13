import { describe, expect, it } from "vitest";
import {
  assertSandboxBinaryAllowed,
  buildLinuxBwrapWhitelistArgs,
  buildMacosSeatbeltWhitelistProfile,
  buildWindowsWslBwrapWhitelistArgs,
  getEmaSandboxStatus,
  loadEmaAgentConfig,
  loadEmaGlobalConfig,
  resolveEffectiveAllowedBins,
  toWslLinuxPath,
} from "../src/index.js";

describe("EMA Cross-Platform Dual-Whitelist Sandbox Engine", () => {
  it("resolves effective allowed bins from global config.toml and agent owner_approved_bins", () => {
    const globalCfg = loadEmaGlobalConfig();
    const sakanaCfg = loadEmaAgentConfig("sakana_kawaii", globalCfg.appDataDir);

    const bins = resolveEffectiveAllowedBins(globalCfg, sakanaCfg);
    expect(bins).toContain("sh");
    expect(bins).toContain("bash");
    expect(bins).toContain("ls");
    expect(bins).toContain("grep");
    expect(bins).toContain("rg");
    expect(bins).toContain("[");
    expect(bins).toContain("node");
    expect(bins).not.toContain("ssh");
    expect(bins).not.toContain("scp");

    expect(() => assertSandboxBinaryAllowed("ssh", globalCfg, sakanaCfg)).toThrow(
      /\[EMA Sandbox Panic\] Binary 'ssh' is blocked \(not in sandbox bin whitelist\)\. Execution requires explicit approval from the EMA Agent Owner/,
    );

    // Simulate EMA Agent Owner explicitly approving `git` for this agent
    const ownerApprovedCfg = {
      ...sakanaCfg,
      sandbox: { ownerApprovedBins: ["git"] },
    };
    expect(() => assertSandboxBinaryAllowed("git", globalCfg, ownerApprovedCfg)).not.toThrow();
    expect(() => assertSandboxBinaryAllowed("ssh", globalCfg, ownerApprovedCfg)).toThrow(
      /Binary 'ssh' is blocked/,
    );
  });

  it("builds Linux Bubblewrap dual-whitelist args (--tmpfs /home/rei + --tmpfs /usr/bin + RW workspace/scratchpad/tmp only)", () => {
    const globalCfg = loadEmaGlobalConfig();
    const sakanaCfg = loadEmaAgentConfig("sakana_kawaii", globalCfg.appDataDir);

    const args = buildLinuxBwrapWhitelistArgs({
      workspaceRoot: "/home/rei/work/org/ema/assistant",
      scratchpadDir:
        "/home/rei/.penguin/data/default_project/agents/sakana_kawaii/scratchpad/sess-1",
      globalCfg,
      agentCfg: sakanaCfg,
      homeDir: "/home/rei",
      resolveHostBin: (bin) => `/usr/bin/${bin}`,
    });

    // Must blank out /etc/ssh, /usr/bin, and /home/rei
    expect(args).toContain("/etc/ssh");
    expect(args).toContain("/usr/bin");
    expect(args).toContain("/home/rei");

    // Must mount whitelisted binaries read-only into /usr/bin and NOT mount /usr/bin/ssh
    expect(args.join(" ")).toContain("--ro-bind /usr/bin/node /usr/bin/node");
    expect(args.join(" ")).toContain("--ro-bind /usr/bin/grep /usr/bin/grep");
    expect(args.join(" ")).not.toContain("/usr/bin/ssh");

    // Must bind workspace and scratchpad read-write, then lock /home/rei read-only
    const bindWsIdx = args.indexOf("/home/rei/work/org/ema/assistant");
    const remountHomeIdx = args.lastIndexOf("/home/rei");
    expect(bindWsIdx).toBeGreaterThan(0);
    expect(args[bindWsIdx - 1]).toBe("--bind");
    expect(args[remountHomeIdx - 1]).toBe("--remount-ro");
    expect(remountHomeIdx).toBeGreaterThan(bindWsIdx);
  });

  it("builds Windows WSL2 Bubblewrap dual-whitelist args (--tmpfs /mnt + --tmpfs /usr/bin + RW workspace/scratchpad only)", () => {
    const globalCfg = loadEmaGlobalConfig();
    const sakanaCfg = loadEmaAgentConfig("sakana_kawaii", globalCfg.appDataDir);

    expect(toWslLinuxPath("C:\\Users\\rei\\work\\ema")).toBe("/mnt/c/Users/rei/work/ema");

    const args = buildWindowsWslBwrapWhitelistArgs({
      workspaceRoot: "C:\\Users\\rei\\work\\ema",
      scratchpadDir: "C:\\Users\\rei\\.penguin\\scratchpad\\sess-1",
      distro: "penguin-sandbox",
      globalCfg,
      agentCfg: sakanaCfg,
      resolveHostBin: (bin) => `/usr/bin/${bin}`,
    });

    const joined = args.join(" ");
    expect(joined).toContain("--tmpfs /mnt");
    expect(joined).toContain("--tmpfs /usr/bin");
    expect(joined).toContain("--tmpfs /etc/ssh");
    expect(joined).toContain("--bind /mnt/c/Users/rei/work/ema /mnt/c/Users/rei/work/ema");
    expect(joined).toContain(
      "--bind /mnt/c/Users/rei/.penguin/scratchpad/sess-1 /mnt/c/Users/rei/.penguin/scratchpad/sess-1",
    );
    expect(joined).toContain("--remount-ro /mnt");
    expect(joined).not.toContain("/usr/bin/ssh");
  });

  it("builds macOS Seatbelt SBPL dual-whitelist profile (deny homeDir/ssh reads + allow RW workspace/scratchpad/tmp + process-exec* whitelist)", () => {
    const globalCfg = loadEmaGlobalConfig();
    const sakanaCfg = loadEmaAgentConfig("sakana_kawaii", globalCfg.appDataDir);

    const profile = buildMacosSeatbeltWhitelistProfile({
      workspaceRoot: "/Users/rei/work/ema",
      scratchpadDir: "/Users/rei/.penguin/scratchpad/sess-1",
      globalCfg,
      agentCfg: sakanaCfg,
      homeDir: "/Users/rei",
      network: "local",
      resolveHostBin: (bin) => `/usr/bin/${bin}`,
    });

    expect(profile).toContain(
      '(deny file-read* file-write* (subpath "/Users/rei") (subpath "/private/etc/ssh"))',
    );
    expect(profile).toContain(
      '(allow file-read* file-write* (subpath "/Users/rei/work/ema") (subpath "/Users/rei/.penguin/scratchpad/sess-1") (subpath "/private/tmp"))',
    );
    expect(profile).toContain("(deny process-exec*)");
    expect(profile).toContain('(allow process-exec* (literal "/usr/bin/sh")');
    expect(profile).not.toContain('"/usr/bin/ssh"');
    expect(profile).toContain('(allow network-outbound (remote ip "localhost:*"))');
  });

  it("reports structured sandbox status with sshBlocked = true", () => {
    const status = getEmaSandboxStatus({ agentId: "sakana_kawaii", platform: "linux" });
    expect(status.backend).toBe("penguin-bwrap (bwrap-whitelist)");
    expect(status.sshBlocked).toBe(true);
    expect(status.writableRoots).toEqual(["<session.workspace>", "<session.scratchpad>", "/tmp"]);
  });
});
