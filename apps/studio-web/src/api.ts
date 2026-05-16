const apiBase = import.meta.env.VITE_STUDIO_API_BASE ?? ''

export interface WorkspaceResponse {
  id: string
  name: string
  mode: string
  characters: CharacterResponse[]
}

export interface CharacterResponse {
  id: string
  name: string
  manifestPath: string
  visualManifestPath: string
  clips: ClipResponse[]
  samplings: SamplingQueryResponse[]
  previewUrl: string | null
  validation: ValidationResponse | null
  buildReadiness: BuildReadinessResponse
  buildReportPath: string | null
  buildReportStatus: BuildReportStatus
  runtimeBuildDraftPath: string | null
  runtimeBuildDraftStatus: BuildReportStatus
  runtimeBuildSettings: RuntimeBuildSettingsResponse
  importLog: ImportLogEntryResponse[]
}

export interface SamplingQueryResponse {
  id: string
  name: string
  capsule: SamplingCapsuleResponse
  facing: number[]
  velocity: number[]
  trajectory: SamplingTrajectoryPointResponse[]
}

export interface SamplingCapsuleResponse {
  height: number
  radius: number
}

export interface SamplingTrajectoryPointResponse {
  frameOffset: number
  position: number[]
  direction: number[]
}

export interface ClipResponse {
  id: string
  name: string
  manifestPath: string
  sourceKind: 'fbx' | 'bvh'
  sourceFileName: string
  clipRole: string | null
  tags: string[]
  frameCount: number | null
  frameRate: number | null
  durationSeconds: number | null
  previewUrl: string | null
  includeInBuild: boolean
  mirrorInBuild: boolean
  contactDetectionPreset: ContactDetectionPreset
  rootMotion: RootMotionDiagnosticsResponse | null
  footContacts: FootContactDiagnosticsResponse | null
  validation: ValidationResponse | null
  skeleton: SkeletonValidationResponse | null
  importLog: ImportLogEntryResponse[]
}

export interface RootMotionDiagnosticsResponse {
  sourceName: string
  keyCount: number
  durationSeconds: number
  displacementX: number
  displacementY: number
  displacementZ: number
  horizontalDistance: number
  averageHorizontalSpeed: number
}

export interface FootContactDiagnosticsResponse {
  velocityThreshold: number
  tracks: FootContactTrackResponse[]
}

export interface FootContactTrackResponse {
  foot: 'left' | 'right'
  sourceName: string
  keyCount: number
  ranges: FootContactRangeResponse[]
}

export interface FootContactRangeResponse {
  startFrame: number
  endFrame: number
  startSeconds: number
  endSeconds: number
}

export interface ValidationResponse {
  canCompile: boolean
  findings: ValidationFindingResponse[]
}

export interface ValidationFindingResponse {
  code: string
  severity: 'info' | 'warning' | 'error'
  message: string
}

export interface SkeletonValidationResponse {
  visualBoneCount: number
  clipBoneCount: number
  matchedBoneCount: number
  coverage: number
  missingCriticalBones: string[]
  matchedBones: string[]
  visualOnlyBones: string[]
  clipOnlyBones: string[]
}

export interface BuildReadinessResponse {
  includedClipCount: number
  mirroredCopyCount: number
  plannedClipCount: number
  warningCount: number
  errorCount: number
  roles: BuildRoleCoverageResponse[]
  planEntries: BuildPlanEntryResponse[]
  skeletonCoverage: BuildSkeletonCoverageResponse[]
  footContacts: BuildFootContactCoverageResponse[]
  findings: BuildReadinessFindingResponse[]
}

export interface BuildRoleCoverageResponse {
  role: string
  description: string
  isRequired: boolean
  includedClipCount: number
}

export interface BuildPlanEntryResponse {
  clipId: string
  clipName: string
  clipRole: string | null
  isMirrored: boolean
}

export interface BuildSkeletonCoverageResponse {
  clipId: string
  clipName: string
  coverage: number | null
  matchedBoneCount: number | null
  visualBoneCount: number | null
  status: 'ok' | 'warning' | 'error' | 'missing'
}

export interface BuildFootContactCoverageResponse {
  clipId: string
  clipName: string
  hasContacts: boolean
  rangeCount: number
  presentFeet: string[]
  missingFeet: string[]
}

export interface BuildReadinessFindingResponse {
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
  clipId: string | null
  clipName: string | null
}

export interface BuildReportResponse {
  characterId: string
  characterName: string
  reportPath: string
  generatedAtUtc: string
  readinessFingerprint: string
  buildReadiness: BuildReadinessResponse
}

export interface RuntimeBuildDraftResponse {
  characterId: string
  characterName: string
  draftPath: string
  generatedAtUtc: string
  sourceReportPath: string
  sampleFrameStep: number
  featurePreset: string[]
  artifacts: RuntimeBuildArtifactResponse[]
  skeleton: RuntimeSkeletonDraftResponse
  poses: RuntimePoseDraftResponse
  features: RuntimeFeatureDraftResponse
  database: RuntimeDatabaseDraftResponse
  buildReadiness: BuildReadinessResponse
}

export interface RuntimeBuildArtifactResponse {
  fileName: string
  kind: string
  status: string
}

export interface RuntimeBuildExportResponse {
  characterId: string
  characterName: string
  buildFolderPath: string
  zipPath: string
  includedPaths: string[]
}

export interface RuntimeSkeletonDraftResponse {
  status: 'ok' | 'warning' | 'error'
  rootBoneName: string | null
  boneCount: number
  boneNames: string[]
  slots: RuntimeSkeletonSlotResponse[]
  findings: BuildReadinessFindingResponse[]
}

export interface RuntimeSkeletonSlotResponse {
  slot: string
  boneName: string | null
  status: 'matched' | 'missing'
}

export interface RuntimePoseDraftResponse {
  status: 'ok' | 'warning' | 'error'
  sampleFrameStep: number
  clipCount: number
  plannedPoseSampleCount: number
  clips: RuntimePoseClipDraftResponse[]
  samples: RuntimePoseSampleResponse[]
  findings: BuildReadinessFindingResponse[]
}

export interface RuntimePoseClipDraftResponse {
  clipId: string
  clipName: string
  clipRole: string | null
  isMirrored: boolean
  frameCount: number | null
  frameRate: number | null
  durationSeconds: number | null
  plannedSampleCount: number
  sampleFramesPreview: number[]
}

export interface RuntimePoseSampleResponse {
  clipId: string
  clipName: string
  isMirrored: boolean
  frame: number
  seconds: number
  bones: RuntimePoseBoneSampleResponse[]
}

export interface RuntimePoseBoneSampleResponse {
  boneName: string
  translation: number[]
  rotation: number[]
  scale: number[]
}

export interface RuntimeFeatureDraftResponse {
  status: 'ok' | 'warning' | 'error'
  sampleFrameStep: number
  featureCount: number
  plannedSampleCount: number
  scale: RuntimeFeatureScaleResponse
  channels: RuntimeFeatureChannelResponse[]
  clips: RuntimeFeatureClipResponse[]
  samplePreviews: RuntimeFeatureSamplePreviewResponse[]
  findings: BuildReadinessFindingResponse[]
}

export interface RuntimeFeatureScaleResponse {
  status: string
  mode: RuntimeScaleMode
  normalizationFactor: number
  maxObservedRootSpeed: number | null
  warnings: string[]
}

export type RuntimeScaleMode = 'auto' | 'source_x0_01' | 'character_x1'

export interface RuntimeBuildSettingsResponse {
  sampleFrameStep: number
  scaleMode: RuntimeScaleMode
}

export interface RuntimeBuildSettingsRequest {
  sampleFrameStep: number
  scaleMode: RuntimeScaleMode
}

export interface RuntimeFeatureChannelResponse {
  name: string
  kind: string
  boneSlot: string | null
  trajectoryFrames: number[]
}

export interface RuntimeFeatureClipResponse {
  clipId: string
  clipName: string
  isMirrored: boolean
  plannedSampleCount: number
}

export interface RuntimeFeatureSamplePreviewResponse {
  clipId: string
  clipName: string
  isMirrored: boolean
  frame: number
  seconds: number
  values: Record<string, number | null>
}

export interface RuntimeDatabaseDraftResponse {
  status: 'ok' | 'warning' | 'error'
  schemaVersion: string
  schema: RuntimeDatabaseSchemaResponse
  clipCount: number
  sampleCount: number
  featureCount: number
  scale: RuntimeFeatureScaleResponse
  clips: RuntimeDatabaseClipResponse[]
  poseSamples: RuntimePoseSampleResponse[]
  samples: RuntimeDatabaseSampleResponse[]
  samplePreviews: RuntimeDatabaseSamplePreviewResponse[]
  findings: BuildReadinessFindingResponse[]
}

export interface RuntimeDatabaseSchemaResponse {
  id: string
  version: number
  format: string
  units: string
}

export interface RuntimeDatabaseClipResponse {
  clipId: string
  clipName: string
  clipRole: string | null
  isMirrored: boolean
  plannedSampleCount: number
  footContacts: RuntimeDatabaseContactTrackResponse[]
}

export interface RuntimeDatabaseContactTrackResponse {
  foot: string
  ranges: FootContactRangeResponse[]
}

export interface RuntimeDatabaseSamplePreviewResponse {
  clipId: string
  clipName: string
  isMirrored: boolean
  frame: number
  seconds: number
  features: Record<string, number | null>
}

export interface RuntimeDatabaseSampleResponse {
  clipId: string
  isMirrored: boolean
  frame: number
  seconds: number
  features: Record<string, number | null>
}

export type BuildReportStatus = 'none' | 'current' | 'outdated'

export interface ImportLogEntryResponse {
  level: 'info' | 'warning' | 'error'
  message: string
}

export interface ClipSettingsRequest {
  includeInBuild: boolean
  mirrorInBuild: boolean
  clipRole: string | null
  contactDetectionPreset: ContactDetectionPreset
  tags: string[]
}

export type ContactDetectionPreset = 'auto' | 'character_scale' | 'source_scale' | 'strict' | 'loose' | 'manual_only'

export async function openBrowserWorkspace(): Promise<WorkspaceResponse | null> {
  const response = await fetch(`${apiBase}/api/v1/workspaces/browser`)
  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`Open workspace failed: ${response.status}`)
  }

  return response.json()
}

export async function createBrowserWorkspace(): Promise<WorkspaceResponse> {
  const response = await fetch(`${apiBase}/api/v1/workspaces/browser`, {
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(`Create workspace failed: ${response.status}`)
  }

  return response.json()
}

export async function uploadVisualCharacter(file: File): Promise<CharacterResponse> {
  const body = new FormData()
  body.append('visual', file)

  const response = await fetch(`${apiBase}/api/v1/workspaces/browser/characters`, {
    method: 'POST',
    body,
  })

  if (response.status === 413) {
    throw new Error('File is larger than the 50 MB upload limit.')
  }

  if (!response.ok) {
    throw new Error(`Import failed: ${response.status}`)
  }

  return response.json()
}

export async function uploadClip(characterId: string, file: File): Promise<CharacterResponse> {
  const body = new FormData()
  body.append('clip', file)

  const response = await fetch(`${apiBase}/api/v1/workspaces/browser/characters/${characterId}/clips`, {
    method: 'POST',
    body,
  })

  if (response.status === 413) {
    throw new Error('File is larger than the 50 MB upload limit.')
  }

  if (!response.ok) {
    throw new Error(`Clip import failed: ${response.status}`)
  }

  return response.json()
}

export async function createSamplingQuery(characterId: string, name: string): Promise<CharacterResponse> {
  const response = await fetch(`${apiBase}/api/v1/workspaces/browser/characters/${characterId}/samplings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  })

  if (response.status === 404) {
    throw new Error('Character was not found.')
  }

  if (!response.ok) {
    throw new Error(`Sampling create failed: ${response.status}`)
  }

  return response.json()
}

export async function updateSamplingQuery(characterId: string, samplingId: string, name: string): Promise<CharacterResponse> {
  const response = await fetch(`${apiBase}/api/v1/workspaces/browser/characters/${characterId}/samplings/${samplingId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  })

  if (response.status === 404) {
    throw new Error('Sampling was not found.')
  }

  if (!response.ok) {
    throw new Error(`Sampling update failed: ${response.status}`)
  }

  return response.json()
}

export async function deleteSamplingQuery(characterId: string, samplingId: string): Promise<CharacterResponse> {
  const response = await fetch(`${apiBase}/api/v1/workspaces/browser/characters/${characterId}/samplings/${samplingId}`, {
    method: 'DELETE',
  })

  if (response.status === 404) {
    throw new Error('Sampling was not found.')
  }

  if (!response.ok) {
    throw new Error(`Sampling delete failed: ${response.status}`)
  }

  return response.json()
}

export async function replaceClipSource(characterId: string, clipId: string, file: File): Promise<CharacterResponse> {
  const body = new FormData()
  body.append('clip', file)

  const response = await fetch(`${apiBase}/api/v1/workspaces/browser/characters/${characterId}/clips/${clipId}/replace-source`, {
    method: 'POST',
    body,
  })

  if (response.status === 413) {
    throw new Error('File is larger than the 50 MB upload limit.')
  }

  if (response.status === 404) {
    throw new Error('Clip was not found.')
  }

  if (!response.ok) {
    throw new Error(`Clip source replace failed: ${response.status}`)
  }

  return response.json()
}

export async function deleteClip(characterId: string, clipId: string): Promise<CharacterResponse> {
  const response = await fetch(`${apiBase}/api/v1/workspaces/browser/characters/${characterId}/clips/${clipId}`, {
    method: 'DELETE',
  })

  if (response.status === 404) {
    throw new Error('Clip was not found.')
  }

  if (!response.ok) {
    throw new Error(`Clip delete failed: ${response.status}`)
  }

  return response.json()
}

export async function deleteCharacter(characterId: string): Promise<WorkspaceResponse> {
  const response = await fetch(`${apiBase}/api/v1/workspaces/browser/characters/${characterId}`, {
    method: 'DELETE',
  })

  if (response.status === 404) {
    throw new Error('Character was not found.')
  }

  if (!response.ok) {
    throw new Error(`Character delete failed: ${response.status}`)
  }

  return response.json()
}

export async function generateBuildReport(characterId: string): Promise<BuildReportResponse> {
  const response = await fetch(`${apiBase}/api/v1/workspaces/browser/characters/${characterId}/build-report`, {
    method: 'POST',
  })

  if (response.status === 404) {
    throw new Error('Character was not found.')
  }

  if (!response.ok) {
    throw new Error(`Build report generation failed: ${response.status}`)
  }

  return response.json()
}

export async function getBuildReport(characterId: string): Promise<BuildReportResponse> {
  const response = await fetch(`${apiBase}/api/v1/workspaces/browser/characters/${characterId}/build-report`)

  if (response.status === 404) {
    throw new Error('Build report was not found.')
  }

  if (!response.ok) {
    throw new Error(`Build report load failed: ${response.status}`)
  }

  return response.json()
}

export async function generateRuntimeBuildDraft(characterId: string, sampleFrameStep = 1, scaleMode: RuntimeScaleMode = 'auto'): Promise<RuntimeBuildDraftResponse> {
  const search = new URLSearchParams({ sampleFrameStep: String(sampleFrameStep), scaleMode })
  const response = await fetch(`${apiBase}/api/v1/workspaces/browser/characters/${characterId}/runtime-build-draft?${search.toString()}`, {
    method: 'POST',
  })

  if (response.status === 404) {
    throw new Error('Character was not found.')
  }

  if (!response.ok) {
    throw new Error(`Runtime build draft generation failed: ${response.status}`)
  }

  return response.json()
}

export async function getRuntimeBuildDraft(characterId: string): Promise<RuntimeBuildDraftResponse> {
  const response = await fetch(`${apiBase}/api/v1/workspaces/browser/characters/${characterId}/runtime-build-draft`)

  if (response.status === 404) {
    throw new Error('Runtime build draft was not found.')
  }

  if (!response.ok) {
    throw new Error(`Runtime build draft load failed: ${response.status}`)
  }

  return response.json()
}

export async function exportRuntimeBuild(characterId: string): Promise<RuntimeBuildExportResponse> {
  const response = await fetch(`${apiBase}/api/v1/workspaces/browser/characters/${characterId}/runtime-build-export`, {
    method: 'POST',
  })

  if (response.status === 404) {
    throw new Error('Runtime build draft was not found.')
  }

  if (!response.ok) {
    throw new Error(`Runtime build export failed: ${response.status}`)
  }

  return response.json()
}

export async function updateRuntimeBuildSettings(characterId: string, settings: RuntimeBuildSettingsRequest): Promise<CharacterResponse> {
  const response = await fetch(`${apiBase}/api/v1/workspaces/browser/characters/${characterId}/runtime-build-settings`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

  if (response.status === 404) {
    throw new Error('Character was not found.')
  }

  if (!response.ok) {
    throw new Error(`Runtime build settings update failed: ${response.status}`)
  }

  return response.json()
}

export async function updateClipSettings(
  characterId: string,
  clipId: string,
  settings: ClipSettingsRequest,
): Promise<CharacterResponse> {
  const response = await fetch(`${apiBase}/api/v1/workspaces/browser/characters/${characterId}/clips/${clipId}/settings`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(settings),
  })

  if (response.status === 404) {
    throw new Error('Clip was not found.')
  }

  if (!response.ok) {
    throw new Error(`Clip settings update failed: ${response.status}`)
  }

  return response.json()
}

export async function refreshFootContacts(characterId: string, clipId: string): Promise<CharacterResponse> {
  const response = await fetch(`${apiBase}/api/v1/workspaces/browser/characters/${characterId}/clips/${clipId}/foot-contacts/refresh`, {
    method: 'POST',
  })

  if (response.status === 404) {
    throw new Error('Clip was not found.')
  }

  if (!response.ok) {
    throw new Error(`Foot contact refresh failed: ${response.status}`)
  }

  return response.json()
}

export function resolveAssetUrl(assetUrl: string | null): string | null {
  if (!assetUrl) {
    return null
  }

  return `${apiBase}${assetUrl}`
}
