"use client";

import { Settings } from "lucide-react";

import styles from "@/app/dashboard/page.module.css";
import { GlobalSettingsPanel } from "@/features/global-settings/GlobalSettingsPanel";

export function GlobalSettingsSidePanel({
  hidden = false,
}: {
  hidden?: boolean;
}) {
  return (
    <section
      className={`${styles.actorInfoPanel} ${
        hidden ? styles.actorInfoPanelHidden : ""
      }`}
      aria-label="全局设置"
      aria-hidden={hidden}
    >
      <div
        className={styles.actorInfoTabs}
        role="tablist"
        aria-label="全局设置面板"
      >
        <button
          type="button"
          role="tab"
          aria-selected="true"
          className={`${styles.actorInfoTab} ${styles.actorInfoTabActive}`}
          tabIndex={hidden ? -1 : undefined}
        >
          <Settings aria-hidden="true" />
          <span>设置</span>
        </button>
      </div>
      <div className={styles.actorInfoBody} role="tabpanel" aria-label="设置">
        <GlobalSettingsPanel />
      </div>
    </section>
  );
}
