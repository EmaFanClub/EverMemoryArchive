const appVersion = process.env.NEXT_PUBLIC_EMA_VERSION;

if (!appVersion) {
  throw new Error("NEXT_PUBLIC_EMA_VERSION is not set.");
}

export const APP_RELEASE_VERSION = appVersion;
export const APP_VERSION_TAG = `v${APP_RELEASE_VERSION}`;
export const APP_VERSION_BADGE = formatVersionBadge(APP_RELEASE_VERSION);

function formatVersionBadge(version: string) {
  const match = /^(\d+\.\d+\.\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match) {
    return `v${version}`;
  }

  const [, baseVersion, prerelease] = match;
  if (!prerelease) {
    return `v${baseVersion}`;
  }

  const [stage, number] = prerelease.split(".");
  const stageLabel =
    stage === "alpha"
      ? "Alpha"
      : stage === "beta"
        ? "Beta"
        : stage === "rc"
          ? "RC"
          : stage;

  return number
    ? `v${baseVersion} ${stageLabel} ${number}`
    : `v${baseVersion} ${stageLabel}`;
}
