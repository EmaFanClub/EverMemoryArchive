"use client";

import { type CSSProperties } from "react";

import styles from "@/app/dashboard/page.module.css";

import {
  ACTOR_INFO_DEFAULT_WIDTH,
  CHAT_PANEL_MIN_WIDTH,
  LAYOUT_RESIZER_SIZE,
  SIDEBAR_DEFAULT_WIDTH,
} from "./layout-constants";

export function DashboardSkeleton() {
  return (
    <main
      className={styles.dashboardShell}
      style={
        {
          "--sidebar-width": `${SIDEBAR_DEFAULT_WIDTH}px`,
        } as CSSProperties
      }
    >
      <aside className={styles.sidebar} aria-label="主导航" />
      <div className={styles.layoutResizer} aria-hidden="true" />
      <div
        className={styles.actorWorkspace}
        style={
          {
            "--chat-panel-width": `${CHAT_PANEL_MIN_WIDTH}px`,
            "--actor-info-width": `${ACTOR_INFO_DEFAULT_WIDTH}px`,
            "--actor-workspace-width": `${
              CHAT_PANEL_MIN_WIDTH +
              LAYOUT_RESIZER_SIZE +
              ACTOR_INFO_DEFAULT_WIDTH
            }px`,
          } as CSSProperties
        }
      >
        <section className={styles.detailPanel} aria-label="详情面板" />
        <div className={styles.layoutResizer} aria-hidden="true" />
        <section className={styles.actorInfoPanel} aria-label="Actor 信息" />
      </div>
    </main>
  );
}
