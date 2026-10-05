#!/usr/bin/env node
/** Shared governance preview renderer entrypoint. */

export {
  DEFAULT_TTL_DAYS,
  buildDiscoveryMetadata,
  completenessSignature,
  emitPreviewMd,
  extractArchResources,
  extractManagementGroups,
} from "./governance-core.mjs";
