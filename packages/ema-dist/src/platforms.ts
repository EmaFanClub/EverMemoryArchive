export type PlatformId =
  | "win32-x64"
  | "win32-arm64"
  | "linux-x64"
  | "linux-arm64"
  | "linux-armhf"
  | "darwin-x64"
  | "darwin-arm64"
  | "alpine-x64";

export interface Platform {
  readonly id: PlatformId;
  readonly label: string;
  readonly os: "win32" | "linux" | "darwin" | "alpine";
  readonly arch: "x64" | "arm64" | "armhf";
  readonly installerExt: ".ps1" | ".run" | ".command";
  readonly executableExt: "" | ".exe";
  readonly canBundleMongo: boolean;
  readonly mongoNote?: string;
}

const PLATFORM_DETAILS: Record<PlatformId, Omit<Platform, "id" | "label">> = {
  "win32-x64": {
    os: "win32",
    arch: "x64",
    installerExt: ".ps1",
    executableExt: ".exe",
    canBundleMongo: true,
  },
  "win32-arm64": {
    os: "win32",
    arch: "arm64",
    installerExt: ".ps1",
    executableExt: ".exe",
    canBundleMongo: true,
    mongoNote:
      "MongoDB does not publish native Windows ARM64 community archives; the x64 archive is bundled for Windows-on-ARM emulation.",
  },
  "linux-x64": {
    os: "linux",
    arch: "x64",
    installerExt: ".run",
    executableExt: "",
    canBundleMongo: true,
  },
  "linux-arm64": {
    os: "linux",
    arch: "arm64",
    installerExt: ".run",
    executableExt: "",
    canBundleMongo: true,
  },
  "linux-armhf": {
    os: "linux",
    arch: "armhf",
    installerExt: ".run",
    executableExt: "",
    canBundleMongo: false,
    mongoNote:
      "MongoDB Community Server does not publish ARMv7/armhf archives.",
  },
  "darwin-x64": {
    os: "darwin",
    arch: "x64",
    installerExt: ".command",
    executableExt: "",
    canBundleMongo: true,
  },
  "darwin-arm64": {
    os: "darwin",
    arch: "arm64",
    installerExt: ".command",
    executableExt: "",
    canBundleMongo: true,
  },
  "alpine-x64": {
    os: "alpine",
    arch: "x64",
    installerExt: ".run",
    executableExt: "",
    canBundleMongo: false,
    mongoNote:
      "MongoDB Community Server does not publish Alpine/musl archives.",
  },
};

function platform(id: PlatformId, label: string): Platform {
  return {
    id,
    label,
    ...PLATFORM_DETAILS[id],
  };
}

export const PLATFORMS = [
  platform("win32-x64", "x64 Windows"),
  platform("win32-arm64", "ARM64 Windows"),
  platform("linux-x64", "x64 Linux"),
  platform("linux-arm64", "ARM64 Linux"),
  platform("linux-armhf", "ARMv7 Linux"),
  platform("darwin-x64", "Intel macOS"),
  platform("darwin-arm64", "Apple Silicon macOS"),
  platform("alpine-x64", "x64 Alpine Linux"),
] as const;

export const PLATFORM_IDS = PLATFORMS.map((item) => item.id);

export function getPlatform(id: string): Platform {
  const platform = PLATFORMS.find((item) => item.id === id);
  if (!platform) {
    throw new Error(
      `Unsupported platform '${id}'. Expected one of: ${PLATFORM_IDS.join(
        ", ",
      )}.`,
    );
  }
  return platform;
}

export function hostPlatformId(): PlatformId {
  const os = process.platform;
  const arch = process.arch;
  if (os === "win32" && arch === "x64") {
    return "win32-x64";
  }
  if (os === "win32" && arch === "arm64") {
    return "win32-arm64";
  }
  if (os === "darwin" && arch === "x64") {
    return "darwin-x64";
  }
  if (os === "darwin" && arch === "arm64") {
    return "darwin-arm64";
  }
  if (os === "linux" && arch === "x64") {
    return "linux-x64";
  }
  if (os === "linux" && arch === "arm64") {
    return "linux-arm64";
  }
  if (os === "linux" && (arch === "arm" || arch === "arm64")) {
    return "linux-armhf";
  }
  throw new Error(`Cannot map host platform '${os}-${arch}' to EMA platform.`);
}

export type PackageKind = "portable" | "minimal";

export function assertPackageKind(value: string): PackageKind {
  if (value === "portable" || value === "minimal") {
    return value;
  }
  throw new Error(`Unsupported package kind '${value}'.`);
}
