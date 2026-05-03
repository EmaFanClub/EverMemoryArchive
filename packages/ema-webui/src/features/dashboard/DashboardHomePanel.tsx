"use client";

import { Settings } from "lucide-react";

import styles from "@/app/dashboard/page.module.css";

import { APP_BRAND_NAME, APP_RELEASE_VERSION } from "./layout-constants";

export function DashboardHomePanel({
  settingsOpen = false,
  onToggleSettings,
}: {
  settingsOpen?: boolean;
  onToggleSettings?: () => void;
}) {
  return (
    <div className={styles.homePanel} aria-label="首页">
      <div className={styles.homeBrand}>
        <div className={styles.homeTitleLockup}>
          <h1 className={styles.homeTitle}>{APP_BRAND_NAME}</h1>
        </div>
        <button
          type="button"
          className={`${styles.homeSettingsButton} ${
            settingsOpen ? styles.homeSettingsButtonActive : ""
          }`}
          aria-label={settingsOpen ? "关闭设置" : "打开设置"}
          aria-pressed={settingsOpen}
          onClick={onToggleSettings}
        >
          <Settings aria-hidden="true" />
        </button>
      </div>
      <div className={styles.homeVersion}>版本：{APP_RELEASE_VERSION}</div>
    </div>
  );
}
