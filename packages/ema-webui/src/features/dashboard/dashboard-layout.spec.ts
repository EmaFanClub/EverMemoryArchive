import { describe, expect, test } from "vitest";

import {
  settleNormalizedDashboardLayout,
  type DashboardLayoutState,
} from "./dashboard-layout";

describe("dashboard layout helpers", () => {
  const layout: DashboardLayoutState = {
    sidebarWidth: 320,
    sidebarCollapsed: false,
    chatPanelWidth: 720,
    actorInfoWidth: 360,
    actorInfoVisible: true,
    homeSettingsVisible: false,
  };

  test("reuses the current layout when normalization keeps the same values", () => {
    const next = settleNormalizedDashboardLayout(layout, (current) => ({
      ...current,
    }));

    expect(next).toBe(layout);
  });

  test("returns the normalized layout when values change", () => {
    const normalized = settleNormalizedDashboardLayout(layout, (current) => ({
      ...current,
      chatPanelWidth: 680,
    }));

    expect(normalized).not.toBe(layout);
    expect(normalized.chatPanelWidth).toBe(680);
  });
});
