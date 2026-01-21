/**
 * Dashboard Module Entry Point
 *
 * Exports the main dashboard functionality for use by the CLI.
 */

export { initRegistry, registerProject, unregisterProject, listProjects, pruneStale, getProject, getProjectByPath, touchProject, getRegistryPath, findProjectByName, findProjectByIndex, updateProjectName } from './registry.js';
export { scanForProjects, scanCommonLocations, type ScanResult } from './scanner.js';
export { getAllProjectStatuses, getProjectStatus, getFullProjectState, getArtifactContent, type ProjectStatusInfo, type ProjectStatus } from './status.js';
export { renderDashboard, renderScanResults, renderPruneResults } from './cli-renderer.js';
