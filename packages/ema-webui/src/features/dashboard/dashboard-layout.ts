export interface DashboardLayoutState {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  chatPanelWidth: number;
  actorInfoWidth: number;
  actorInfoVisible: boolean;
  homeSettingsVisible: boolean;
}

export function settleNormalizedDashboardLayout(
  current: DashboardLayoutState,
  normalize: (layout: DashboardLayoutState) => DashboardLayoutState,
) {
  const normalized = normalize(current);
  return areDashboardLayoutsEqual(current, normalized) ? current : normalized;
}

function areDashboardLayoutsEqual(
  left: DashboardLayoutState,
  right: DashboardLayoutState,
) {
  return (
    left.sidebarWidth === right.sidebarWidth &&
    left.sidebarCollapsed === right.sidebarCollapsed &&
    left.chatPanelWidth === right.chatPanelWidth &&
    left.actorInfoWidth === right.actorInfoWidth &&
    left.actorInfoVisible === right.actorInfoVisible &&
    left.homeSettingsVisible === right.homeSettingsVisible
  );
}
