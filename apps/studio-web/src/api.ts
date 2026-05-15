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
  previewUrl: string | null
  validation: ValidationResponse | null
  importLog: ImportLogEntryResponse[]
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

export interface ImportLogEntryResponse {
  level: 'info' | 'warning' | 'error'
  message: string
}

export interface ClipSettingsRequest {
  includeInBuild: boolean
  clipRole: string | null
  tags: string[]
}

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

export function resolveAssetUrl(assetUrl: string | null): string | null {
  if (!assetUrl) {
    return null
  }

  return `${apiBase}${assetUrl}`
}
