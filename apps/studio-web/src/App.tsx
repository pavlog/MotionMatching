import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Archive, Box as BoxIcon, CheckCircle2, CirclePlus, Copy, FileText, Film, ListTree, Loader2, Pause, Play, RefreshCw, StepBack, StepForward, TerminalSquare, Trash2, TriangleAlert, X } from 'lucide-react'
import {
  type ClipResponse,
  type BuildReportResponse,
  type CharacterResponse,
  type ContactDetectionPreset,
  type RuntimeDatabaseDraftResponse,
  type RuntimeBuildDraftResponse,
  type RuntimeFeatureChannelResponse,
  type RuntimePoseSampleResponse,
  type RuntimeScaleMode,
  type SamplingQueryResponse,
  type SamplingQueryUpdateRequest,
  type WorkspaceResponse,
  createSamplingQuery,
  createBrowserWorkspace,
  deleteCharacter,
  deleteClip,
  deleteSamplingQuery,
  exportRuntimeBuild,
  generateBuildReport,
  generateRuntimeBuildDraft,
  getBuildReport,
  getRuntimeBuildDraft,
  openBrowserWorkspace,
  refreshFootContacts,
  replaceClipSource,
  resolveAssetUrl,
  updateSamplingQuery,
  updateClipSettings,
  updateRuntimeBuildSettings,
  uploadClip,
  uploadVisualCharacter,
} from './api'
import { BabylonViewport, type SamplingGhostPosePreview } from './BabylonViewport'
import './App.css'

interface LogEntry {
  id: number
  level: 'info' | 'warning' | 'error'
  message: string
}

type Selection =
  | { type: 'character'; characterId: string }
  | { type: 'clip'; characterId: string; clipId: string }
  | { type: 'sampling'; characterId: string; samplingId: string }

type ClipContextMenu = {
  characterId: string
  clipId: string
  clipName: string
  x: number
  y: number
}

type CharacterContextMenu = {
  characterId: string
  characterName: string
  x: number
  y: number
}

type SamplingContextMenu = {
  characterId: string
  samplingId: string
  samplingName: string
  x: number
  y: number
}

type TextViewer = {
  heading: string
  title: string
  text?: string
  report?: BuildReportResponse
  runtimeDraft?: RuntimeBuildDraftResponse
  databaseDraft?: RuntimeDatabaseDraftResponse
  databasePath?: string
  currentReadiness?: CharacterResponse['buildReadiness']
}

const fallbackFrameCount = 120
const defaultSamplingFrameRate = 30
const fallbackFrameRate = defaultSamplingFrameRate
type ClipMotionMode = 'inPlace' | 'rootMotion'
type CharacterInspectorTab = 'overview' | 'sampling'
type SamplingGhostingMode = 'none' | 'every10' | 'every5' | 'every2' | 'every1' | 'window5'
type SamplingMatcherPreviewMatch = {
  pointIndex: number
  pointFrame: number
  clipId: string
  clipName: string
  isMirrored: boolean
  frame: number
  score: number
  breakdown: {
    velocity: number
    trajectoryPosition: number
    trajectoryDirection: number
    other: number
  }
  breakdownCounts: {
    velocity: number
    trajectoryPosition: number
    trajectoryDirection: number
    other: number
  }
  contributions: Array<{ name: string; delta: number; score: number }>
  matchedFeatureCount: number
}
type RuntimeQueryContractFeature = {
  name: string
  sourceChannel: string
  kind: string
  boneSlot: string | null
  trajectoryFrame: number | null
  timeSeconds: number | null
}

const clipRoles = [
  { value: 'idle_loop', description: 'no movement input' },
  { value: 'walk_loop', description: 'moving slowly' },
  { value: 'run_loop', description: 'moving fast' },
  { value: 'turn_left', description: 'committed left turn' },
  { value: 'turn_right', description: 'committed right turn' },
  { value: 'turn_left_180', description: 'reversing left' },
  { value: 'turn_right_180', description: 'reversing right' },
  { value: 'jump', description: 'jump begins' },
  { value: 'fall_loop', description: 'airborne or falling' },
  { value: 'land', description: 'landing' },
]

const defaultClipTags = ['neutral', 'calm', 'happy', 'angry', 'sad', 'tired', 'injured', 'combat', 'stealth', 'relaxed']
const legacyActionTags = ['idle', 'walk', 'run', 'turn', 'start', 'stop', 'jump', 'loop']
const contactDetectionPresets: Array<{ value: ContactDetectionPreset; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'source_scale', label: 'Source scale' },
  { value: 'character_scale', label: 'Character scale' },
  { value: 'strict', label: 'Strict' },
  { value: 'loose', label: 'Loose' },
  { value: 'manual_only', label: 'Manual only' },
]

const runtimeScaleModes: Array<{ value: RuntimeScaleMode; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'source_x0_01', label: 'Source x0.01' },
  { value: 'character_x1', label: 'Character x1' },
]

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const clipInputRef = useRef<HTMLInputElement>(null)
  const replaceClipInputRef = useRef<HTMLInputElement>(null)
  const timelineFrameRef = useRef(0)
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [timelineFrame, setTimelineFrame] = useState(0)
  const [samplingPreviewFrame, setSamplingPreviewFrame] = useState(0)
  const [samplingGhostingMode, setSamplingGhostingMode] = useState<SamplingGhostingMode>('none')
  const [showSamplingQueryVectors, setShowSamplingQueryVectors] = useState(false)
  const [selectedSamplingPointIndex, setSelectedSamplingPointIndex] = useState<number | null>(null)
  const [loopStartFrame, setLoopStartFrame] = useState(0)
  const [loopEndFrame, setLoopEndFrame] = useState(-1)
  const [isTimelinePlaying, setIsTimelinePlaying] = useState(false)
  const [animationPreviewState, setAnimationPreviewState] = useState('none')
  const [clipMotionMode, setClipMotionMode] = useState<ClipMotionMode>('inPlace')
  const [characterInspectorTab, setCharacterInspectorTab] = useState<CharacterInspectorTab>('overview')
  const [clipContextMenu, setClipContextMenu] = useState<ClipContextMenu | null>(null)
  const [characterContextMenu, setCharacterContextMenu] = useState<CharacterContextMenu | null>(null)
  const [samplingContextMenu, setSamplingContextMenu] = useState<SamplingContextMenu | null>(null)
  const [samplingDrafts, setSamplingDrafts] = useState<Record<string, SamplingQueryResponse>>({})
  const [lastBuildReport, setLastBuildReport] = useState<BuildReportResponse | null>(null)
  const [lastRuntimeDraft, setLastRuntimeDraft] = useState<RuntimeBuildDraftResponse | null>(null)
  const [selectedSamplingMatch, setSelectedSamplingMatch] = useState<SamplingMatcherPreviewMatch | null>(null)
  const [textViewer, setTextViewer] = useState<TextViewer | null>(null)
  const [runtimeSettingsSaveState, setRuntimeSettingsSaveState] = useState<{ characterId: string; state: 'saving' | 'saved' | 'failed' } | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: 1, level: 'info', message: 'Ready' },
  ])

  const selectedCharacter = useMemo(
    () => workspace?.characters.find((character) => character.id === selection?.characterId) ?? null,
    [selection?.characterId, workspace],
  )
  const selectedClip = useMemo(
    () => selectedCharacter?.clips?.find((clip) => selection?.type === 'clip' && clip.id === selection.clipId) ?? null,
    [selectedCharacter, selection],
  )
  const timelineFrameCount = selectedClip?.frameCount ?? fallbackFrameCount
  const timelineFrameRate = selectedClip?.frameRate ?? fallbackFrameRate
  const maxTimelineFrame = Math.max(timelineFrameCount - 1, 0)
  const visibleTimelineFrame = Math.min(timelineFrame, maxTimelineFrame)
  const visibleLoopStartFrame = Math.min(Math.max(loopStartFrame, 0), maxTimelineFrame)
  const visibleLoopEndFrame = Math.max(visibleLoopStartFrame, loopEndFrame >= 0 ? Math.min(loopEndFrame, maxTimelineFrame) : maxTimelineFrame)
  const hasClipTimelineMetadata = Boolean(selectedClip?.frameCount && selectedClip.frameRate && selectedClip.durationSeconds)
  const latestLog = logs.at(-1)
  const selectedRuntimeSettingsSaveState = runtimeSettingsSaveState
  const visibleRuntimeSettingsSaveState = selectedRuntimeSettingsSaveState && selectedRuntimeSettingsSaveState.characterId === selectedCharacter?.id
    ? selectedRuntimeSettingsSaveState.state
    : 'idle'
  const selectedSampling = useMemo(
    () => selectedCharacter?.samplings.find((sampling) => selection?.type === 'sampling' && sampling.id === selection.samplingId) ?? null,
    [selectedCharacter, selection],
  )
  const savedVisibleSampling = selectedSampling ?? selectedCharacter?.samplings[0] ?? null
  const visibleSampling = savedVisibleSampling ? samplingDrafts[savedVisibleSampling.id] ?? savedVisibleSampling : null
  const isSamplingPreviewActive = Boolean(selectedCharacter && !selectedClip && characterInspectorTab === 'sampling')
  const samplingPreviewFrameCount = visibleSampling ? getSamplingPreviewFrameCount(visibleSampling) : 1
  const maxSamplingPreviewFrame = Math.max(samplingPreviewFrameCount - 1, 0)
  const visibleSamplingPreviewFrame = Math.min(samplingPreviewFrame, maxSamplingPreviewFrame)
  const hasSamplingTimeline = Boolean(isSamplingPreviewActive && visibleSampling)
  const samplingMatcherPreview = useMemo(
    () => visibleSampling && lastRuntimeDraft && lastRuntimeDraft.characterId === selectedCharacter?.id
      ? buildSamplingMatcherPreview(visibleSampling, lastRuntimeDraft.database)
      : [],
    [lastRuntimeDraft, selectedCharacter?.id, visibleSampling],
  )
  const activeSamplingPreviewMatch = selectedSamplingMatch ?? samplingMatcherPreview[0] ?? null
  const hasSamplingPreviewTimeline = Boolean(hasSamplingTimeline && activeSamplingPreviewMatch)
  const hasBottomTimeline = Boolean(selectedClip || hasSamplingTimeline)
  const visibleSelectedSamplingPointIndex = selectedSamplingPointIndex !== null && visibleSampling?.trajectory[selectedSamplingPointIndex]
    ? selectedSamplingPointIndex
    : null
  const selectedSamplingPointFrame = visibleSelectedSamplingPointIndex !== null
    ? visibleSampling?.trajectory[visibleSelectedSamplingPointIndex]?.frameOffset ?? null
    : null
  const samplingQueryVectorFrames = useMemo(() => {
    const runtimeDraft = lastRuntimeDraft
    const runtimeFrames = runtimeDraft && runtimeDraft.characterId === selectedCharacter?.id
      ? runtimeDraft.features.channels.flatMap((channel) => channel.trajectoryFrames)
      : []
    const frames = runtimeFrames.length ? runtimeFrames : visibleSampling?.trajectory.map((point) => point.frameOffset) ?? []
    return [...new Set(frames)]
      .filter((frame) => Number.isFinite(frame) && frame > 0)
      .sort((left, right) => left - right)
  }, [lastRuntimeDraft, selectedCharacter?.id, visibleSampling])
  const selectedSamplingGhostPoses = useMemo(() => {
    if (!activeSamplingPreviewMatch || !lastRuntimeDraft || lastRuntimeDraft.characterId !== selectedCharacter?.id || !visibleSampling) {
      return []
    }

    return buildSamplingGhostPosePreviews(
      lastRuntimeDraft.database.poseSamples,
      activeSamplingPreviewMatch,
      visibleSampling,
      visibleSamplingPreviewFrame,
      samplingGhostingMode,
    )
  }, [activeSamplingPreviewMatch, lastRuntimeDraft, samplingGhostingMode, selectedCharacter?.id, visibleSampling, visibleSamplingPreviewFrame])

  useEffect(() => {
    timelineFrameRef.current = visibleTimelineFrame
  }, [visibleTimelineFrame])

  const appendLog = useCallback((message: string, level: LogEntry['level'] = 'info') => {
    setLogs((current) => [
      ...current.slice(-7),
      {
        id: Date.now() + Math.random(),
        level,
        message,
      },
    ])
  }, [])

  const appendImportLogs = useCallback((entries: { level: LogEntry['level']; message: string }[]) => {
    if (!entries.length) {
      return
    }

    setLogs((current) => [
      ...current,
      ...entries.map((entry) => ({
        id: Date.now() + Math.random(),
        level: entry.level,
        message: entry.message,
      })),
    ].slice(-8))
  }, [])

  const seekTimeline = useCallback((frame: number) => {
    setTimelineFrame(Math.min(Math.max(frame, 0), maxTimelineFrame))
    setIsTimelinePlaying(false)
  }, [maxTimelineFrame])

  const seekSamplingTimeline = useCallback((frame: number) => {
    setSamplingPreviewFrame(Math.min(Math.max(frame, 0), maxSamplingPreviewFrame))
    setIsTimelinePlaying(false)
  }, [maxSamplingPreviewFrame])

  const stepTimeline = useCallback((delta: number) => {
    setIsTimelinePlaying(false)
    setTimelineFrame((current) => Math.min(Math.max(current + delta, 0), maxTimelineFrame))
  }, [maxTimelineFrame])

  const stepSamplingTimeline = useCallback((delta: number) => {
    setIsTimelinePlaying(false)
    setSamplingPreviewFrame((current) => Math.min(Math.max(current + delta, 0), maxSamplingPreviewFrame))
  }, [maxSamplingPreviewFrame])

  const resetTimeline = useCallback(() => {
    setTimelineFrame(0)
    setLoopStartFrame(0)
    setLoopEndFrame(-1)
    setIsTimelinePlaying(false)
  }, [])

  const selectCharacter = useCallback((characterId: string) => {
    resetTimeline()
    setSelection({ type: 'character', characterId })
  }, [resetTimeline])

  const selectClip = useCallback((characterId: string, clipId: string) => {
    resetTimeline()
    setSelection({ type: 'clip', characterId, clipId })
    setCharacterInspectorTab('overview')
  }, [resetTimeline])

  const selectClipFrame = useCallback((characterId: string, clipId: string, frame: number) => {
    resetTimeline()
    setSelection({ type: 'clip', characterId, clipId })
    setCharacterInspectorTab('overview')
    setTimelineFrame(Math.max(Math.round(frame), 0))
    setIsTimelinePlaying(false)
  }, [resetTimeline])

  const selectMatcherSample = useCallback((characterId: string, match: SamplingMatcherPreviewMatch) => {
    setSamplingPreviewFrame(match.pointFrame)
    selectClipFrame(characterId, match.clipId, match.frame)
    appendLog(`Opened matcher result ${match.clipName} F${match.frame + 1}${match.isMirrored ? ' (mirrored source)' : ''}`)
  }, [appendLog, selectClipFrame])

  const previewMatcherSample = useCallback((match: SamplingMatcherPreviewMatch) => {
    setSelectedSamplingMatch(match)
    setSamplingPreviewFrame(match.pointFrame)
    appendLog(`Previewing matcher ghost ${match.clipName} F${match.frame + 1}${match.isMirrored ? ' Mirror' : ''}`)
  }, [appendLog])

  const selectSampling = useCallback((characterId: string, samplingId: string) => {
    resetTimeline()
    setSelection({ type: 'sampling', characterId, samplingId })
    setCharacterInspectorTab('sampling')
  }, [resetTimeline])

  const openClipContextMenu = useCallback((event: React.MouseEvent, characterId: string, clip: ClipResponse) => {
    event.preventDefault()
    selectClip(characterId, clip.id)
    setCharacterContextMenu(null)
    setSamplingContextMenu(null)
    setClipContextMenu({
      characterId,
      clipId: clip.id,
      clipName: clip.name,
      x: event.clientX,
      y: event.clientY,
    })
  }, [selectClip])

  const openCharacterContextMenu = useCallback((event: React.MouseEvent, character: CharacterResponse) => {
    event.preventDefault()
    selectCharacter(character.id)
    setClipContextMenu(null)
    setSamplingContextMenu(null)
    setCharacterContextMenu({
      characterId: character.id,
      characterName: character.name,
      x: event.clientX,
      y: event.clientY,
    })
  }, [selectCharacter])

  const openSamplingContextMenu = useCallback((event: React.MouseEvent, characterId: string, sampling: SamplingQueryResponse) => {
    event.preventDefault()
    selectSampling(characterId, sampling.id)
    setClipContextMenu(null)
    setCharacterContextMenu(null)
    setSamplingContextMenu({
      characterId,
      samplingId: sampling.id,
      samplingName: sampling.name,
      x: event.clientX,
      y: event.clientY,
    })
  }, [selectSampling])

  useEffect(() => {
    if (!isTimelinePlaying || !selectedClip || maxTimelineFrame <= 0) {
      return
    }

    const loopStart = visibleLoopStartFrame
    const loopEnd = visibleLoopEndFrame
    const startFrame = Math.min(Math.max(timelineFrameRef.current, loopStart), loopEnd)
    const startTime = window.performance.now()
    const frameSpan = loopEnd - loopStart + 1
    let animationFrameId = 0
    let lastFrame = startFrame

    const tick = (now: number) => {
      const elapsedSeconds = (now - startTime) / 1000
      const elapsedFrames = Math.floor(elapsedSeconds * timelineFrameRate)
      const nextFrame = loopStart + ((startFrame - loopStart + elapsedFrames) % frameSpan)

      if (nextFrame !== lastFrame) {
        lastFrame = nextFrame
        setTimelineFrame(nextFrame)
      }

      animationFrameId = window.requestAnimationFrame(tick)
    }

    animationFrameId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(animationFrameId)
  }, [isTimelinePlaying, maxTimelineFrame, selectedClip, timelineFrameRate, visibleLoopEndFrame, visibleLoopStartFrame])

  useEffect(() => {
    if (!isTimelinePlaying || !hasSamplingPreviewTimeline || maxSamplingPreviewFrame <= 0) {
      return
    }

    const startFrame = Math.min(Math.max(visibleSamplingPreviewFrame, 0), maxSamplingPreviewFrame)
    const startTime = performance.now()
    let animationFrame = 0

    const advance = (now: number) => {
      const elapsedSeconds = (now - startTime) / 1000
      const elapsedFrames = Math.floor(elapsedSeconds * fallbackFrameRate)
      const nextFrame = (startFrame + elapsedFrames) % (maxSamplingPreviewFrame + 1)
      setSamplingPreviewFrame(nextFrame)
      animationFrame = window.requestAnimationFrame(advance)
    }

    animationFrame = window.requestAnimationFrame(advance)
    return () => window.cancelAnimationFrame(animationFrame)
  }, [hasSamplingPreviewTimeline, isTimelinePlaying, maxSamplingPreviewFrame, visibleSamplingPreviewFrame])

  useEffect(() => {
    const handleTimelineKeys = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (!selectedClip && !hasSamplingPreviewTimeline)) {
        return
      }

      if (event.code === 'Space') {
        setIsTimelinePlaying((current) => !current)
        event.preventDefault()
      }
      if (event.key.toLowerCase() === 'q' || event.key === 'ArrowLeft') {
        if (selectedClip) {
          stepTimeline(event.shiftKey ? -10 : -1)
        } else {
          stepSamplingTimeline(event.shiftKey ? -10 : -1)
        }
        event.preventDefault()
      }
      if (event.key.toLowerCase() === 'e' || event.key === 'ArrowRight') {
        if (selectedClip) {
          stepTimeline(event.shiftKey ? 10 : 1)
        } else {
          stepSamplingTimeline(event.shiftKey ? 10 : 1)
        }
        event.preventDefault()
      }
      if (event.key === 'Home') {
        if (selectedClip) {
          setTimelineFrame(0)
        } else {
          setSamplingPreviewFrame(0)
        }
        event.preventDefault()
      }
      if (event.key === 'End') {
        if (selectedClip) {
          setTimelineFrame(maxTimelineFrame)
        } else {
          setSamplingPreviewFrame(maxSamplingPreviewFrame)
        }
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', handleTimelineKeys)
    return () => window.removeEventListener('keydown', handleTimelineKeys)
  }, [hasSamplingPreviewTimeline, maxSamplingPreviewFrame, maxTimelineFrame, selectedClip, stepSamplingTimeline, stepTimeline])

  useEffect(() => {
    if (!clipContextMenu && !characterContextMenu && !samplingContextMenu) {
      return
    }

    const closeMenu = () => {
      setClipContextMenu(null)
      setCharacterContextMenu(null)
      setSamplingContextMenu(null)
    }
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu()
      }
    }

    window.addEventListener('click', closeMenu)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('keydown', closeMenuOnEscape)
    return () => {
      window.removeEventListener('click', closeMenu)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('keydown', closeMenuOnEscape)
    }
  }, [characterContextMenu, clipContextMenu, samplingContextMenu])

  useEffect(() => {
    let cancelled = false

    async function loadWorkspace() {
      try {
        const opened = await openBrowserWorkspace()
        if (cancelled) {
          return
        }

        setWorkspace(opened)
        if (opened?.characters.length) {
          selectCharacter(opened.characters[0].id)
        }
        appendLog(opened ? `Opened ${opened.name}` : 'No browser workspace found')
      } catch (error) {
        appendLog(error instanceof Error ? error.message : 'Open workspace failed', 'error')
      }
    }

    loadWorkspace()
    return () => {
      cancelled = true
    }
  }, [appendLog, selectCharacter])

  async function handleAddCharacter(file: File) {
    setIsBusy(true)
    appendLog(`Importing ${file.name}`)
    try {
      const currentWorkspace = workspace ?? await createBrowserWorkspace()
      const character = await uploadVisualCharacter(file)
      setWorkspace({
        ...currentWorkspace,
        characters: [
          ...currentWorkspace.characters.filter((item) => item.id !== character.id),
          character,
        ],
      })
      selectCharacter(character.id)
      appendLog(`Imported ${character.name}`, character.validation?.canCompile === false ? 'warning' : 'info')
      appendImportLogs(character.importLog)
    } catch (error) {
      appendLog(error instanceof Error ? error.message : 'Import failed', 'error')
    } finally {
      setIsBusy(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  async function handleAddClip(file: File) {
    if (!selectedCharacter) {
      appendLog('Select a character before importing a clip', 'warning')
      return
    }

    setIsBusy(true)
    appendLog(`Importing clip ${file.name}`)
    try {
      const updatedCharacter = await uploadClip(selectedCharacter.id, file)
      setWorkspace((currentWorkspace) => currentWorkspace
        ? {
            ...currentWorkspace,
            characters: currentWorkspace.characters.map((character) =>
              character.id === updatedCharacter.id ? updatedCharacter : character,
            ),
          }
        : currentWorkspace)
      const newClip = updatedCharacter.clips.at(-1)
      if (newClip) {
        selectClip(updatedCharacter.id, newClip.id)
      } else {
        selectCharacter(updatedCharacter.id)
      }
      appendLog(`Imported clip ${newClip?.name ?? file.name}`)
      if (newClip) {
        appendImportLogs(newClip.importLog)
      }
    } catch (error) {
      appendLog(error instanceof Error ? error.message : 'Clip import failed', 'error')
    } finally {
      setIsBusy(false)
      if (clipInputRef.current) {
        clipInputRef.current.value = ''
      }
    }
  }

  async function handleReplaceClipSource(file: File) {
    if (!selectedCharacter || !selectedClip) {
      appendLog('Select a clip before replacing its source', 'warning')
      return
    }

    setIsBusy(true)
    appendLog(`Replacing source for ${selectedClip.name}`)
    try {
      const updatedCharacter = await replaceClipSource(selectedCharacter.id, selectedClip.id, file)
      setWorkspace((currentWorkspace) => currentWorkspace
        ? {
            ...currentWorkspace,
            characters: currentWorkspace.characters.map((character) =>
              character.id === updatedCharacter.id ? updatedCharacter : character,
            ),
          }
        : currentWorkspace)
      const updatedClip = updatedCharacter.clips.find((clip) => clip.id === selectedClip.id)
      if (updatedClip) {
        selectClip(updatedCharacter.id, updatedClip.id)
        appendImportLogs(updatedClip.importLog)
      }
      appendLog(`Replaced source for ${updatedClip?.name ?? selectedClip.name}`)
    } catch (error) {
      appendLog(error instanceof Error ? error.message : 'Clip source replace failed', 'error')
    } finally {
      setIsBusy(false)
      if (replaceClipInputRef.current) {
        replaceClipInputRef.current.value = ''
      }
    }
  }

  async function handleDeleteClip(characterId: string, clipId: string) {
    const character = workspace?.characters.find((item) => item.id === characterId)
    const clip = character?.clips.find((item) => item.id === clipId)
    if (!clip || !character) {
      setClipContextMenu(null)
      appendLog('Clip was not found', 'warning')
      return
    }

    if (!window.confirm(`Delete clip "${clip.name}"?`)) {
      setClipContextMenu(null)
      return
    }

    setIsBusy(true)
    setClipContextMenu(null)
    appendLog(`Deleting clip ${clip.name}`)
    try {
      const updatedCharacter = await deleteClip(characterId, clipId)
      setWorkspace((currentWorkspace) => currentWorkspace
        ? {
            ...currentWorkspace,
            characters: currentWorkspace.characters.map((item) =>
              item.id === updatedCharacter.id ? updatedCharacter : item,
            ),
          }
        : currentWorkspace)

      if (selection?.type === 'clip' && selection.clipId === clipId) {
        selectCharacter(updatedCharacter.id)
      }
      appendLog(`Deleted clip ${clip.name}`)
    } catch (error) {
      appendLog(error instanceof Error ? error.message : 'Clip delete failed', 'error')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleDeleteCharacter(characterId: string) {
    const character = workspace?.characters.find((item) => item.id === characterId)
    if (!character) {
      return
    }

    setCharacterContextMenu(null)
    if (!window.confirm(`Delete character "${character.name}" and all of its clips?`)) {
      return
    }

    setIsBusy(true)
    appendLog(`Deleting ${character.name}`)
    try {
      const updatedWorkspace = await deleteCharacter(characterId)
      setWorkspace(updatedWorkspace)
      const nextCharacter = updatedWorkspace.characters[0]
      if (nextCharacter) {
        selectCharacter(nextCharacter.id)
      } else {
        setSelection(null)
        resetTimeline()
      }

      appendLog(`Deleted ${character.name}`)
    } catch (error) {
      appendLog(error instanceof Error ? error.message : 'Character delete failed', 'error')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleCreateSampling(character: CharacterResponse) {
    const name = `Sampling ${character.samplings.length + 1}`
    setIsBusy(true)
    appendLog(`Creating sampling ${name}`)
    try {
      const updatedCharacter = await createSamplingQuery(character.id, name)
      setWorkspace((currentWorkspace) => currentWorkspace
        ? {
            ...currentWorkspace,
            characters: currentWorkspace.characters.map((item) =>
              item.id === updatedCharacter.id ? updatedCharacter : item,
            ),
          }
        : currentWorkspace)
      const createdSampling = updatedCharacter.samplings.at(-1)
      if (createdSampling) {
        selectSampling(updatedCharacter.id, createdSampling.id)
        appendLog(`Created sampling ${createdSampling.name}`)
      }
    } catch (error) {
      appendLog(error instanceof Error ? error.message : 'Sampling create failed', 'error')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleRenameSampling(characterId: string, samplingId: string) {
    const character = workspace?.characters.find((item) => item.id === characterId)
    const sampling = character?.samplings.find((item) => item.id === samplingId)
    if (!character || !sampling) {
      setSamplingContextMenu(null)
      appendLog('Sampling was not found', 'warning')
      return
    }

    const name = window.prompt('Sampling name', sampling.name)
    setSamplingContextMenu(null)
    if (name === null) {
      return
    }

    setIsBusy(true)
    appendLog(`Renaming sampling ${sampling.name}`)
    try {
      const updatedCharacter = await updateSamplingQuery(characterId, samplingId, { name })
      setWorkspace((currentWorkspace) => currentWorkspace
        ? {
            ...currentWorkspace,
            characters: currentWorkspace.characters.map((item) =>
              item.id === updatedCharacter.id ? updatedCharacter : item,
            ),
          }
        : currentWorkspace)
      const updatedSampling = updatedCharacter.samplings.find((item) => item.id === samplingId)
      if (updatedSampling) {
        selectSampling(updatedCharacter.id, updatedSampling.id)
        appendLog(`Renamed sampling to ${updatedSampling.name}`)
      }
    } catch (error) {
      appendLog(error instanceof Error ? error.message : 'Sampling rename failed', 'error')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleUpdateSampling(characterId: string, samplingId: string, update: SamplingQueryUpdateRequest) {
    setIsBusy(true)
    appendLog('Saving sampling')
    try {
      const updatedCharacter = await updateSamplingQuery(characterId, samplingId, update)
      setWorkspace((currentWorkspace) => currentWorkspace
        ? {
            ...currentWorkspace,
            characters: currentWorkspace.characters.map((item) =>
              item.id === updatedCharacter.id ? updatedCharacter : item,
            ),
          }
        : currentWorkspace)
      const updatedSampling = updatedCharacter.samplings.find((item) => item.id === samplingId)
      if (updatedSampling) {
        setSamplingDrafts((current) => {
          const next = { ...current }
          delete next[samplingId]
          return next
        })
        selectSampling(updatedCharacter.id, updatedSampling.id)
        appendLog(`Saved sampling ${updatedSampling.name}`)
      }
    } catch (error) {
      appendLog(error instanceof Error ? error.message : 'Sampling save failed', 'error')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleDeleteSampling(characterId: string, samplingId: string) {
    const character = workspace?.characters.find((item) => item.id === characterId)
    const sampling = character?.samplings.find((item) => item.id === samplingId)
    if (!character || !sampling) {
      setSamplingContextMenu(null)
      appendLog('Sampling was not found', 'warning')
      return
    }

    if (!window.confirm(`Delete sampling "${sampling.name}"?`)) {
      setSamplingContextMenu(null)
      return
    }

    setIsBusy(true)
    setSamplingContextMenu(null)
    setSamplingDrafts((current) => {
      const next = { ...current }
      delete next[samplingId]
      return next
    })
    appendLog(`Deleting sampling ${sampling.name}`)
    try {
      const updatedCharacter = await deleteSamplingQuery(characterId, samplingId)
      setWorkspace((currentWorkspace) => currentWorkspace
        ? {
            ...currentWorkspace,
            characters: currentWorkspace.characters.map((item) =>
              item.id === updatedCharacter.id ? updatedCharacter : item,
            ),
          }
        : currentWorkspace)

      if (selection?.type === 'sampling' && selection.samplingId === samplingId) {
        selectCharacter(updatedCharacter.id)
        setCharacterInspectorTab('sampling')
      }
      appendLog(`Deleted sampling ${sampling.name}`)
    } catch (error) {
      appendLog(error instanceof Error ? error.message : 'Sampling delete failed', 'error')
    } finally {
      setIsBusy(false)
    }
  }

  function handleSamplingDraftChange(query: SamplingQueryResponse) {
    const normalizedQuery = normalizeSamplingDraftVelocity(query)
    setSamplingDrafts((current) => ({
      ...current,
      [normalizedQuery.id]: normalizedQuery,
    }))
  }

  async function handleUpdateClipSettings(
    characterId: string,
    clip: ClipResponse,
    settings: Partial<Pick<ClipResponse, 'includeInBuild' | 'mirrorInBuild' | 'clipRole' | 'contactDetectionPreset' | 'tags'>>,
  ) {
    setIsBusy(true)
    try {
      const updatedCharacter = await updateClipSettings(characterId, clip.id, {
        includeInBuild: settings.includeInBuild ?? clip.includeInBuild,
        mirrorInBuild: settings.mirrorInBuild ?? clip.mirrorInBuild,
        clipRole: settings.clipRole === undefined ? clip.clipRole : settings.clipRole,
        contactDetectionPreset: settings.contactDetectionPreset ?? clip.contactDetectionPreset,
        tags: settings.tags ?? clip.tags,
      })

      setWorkspace((currentWorkspace) => currentWorkspace
        ? {
            ...currentWorkspace,
            characters: currentWorkspace.characters.map((item) =>
              item.id === updatedCharacter.id ? updatedCharacter : item,
            ),
          }
        : currentWorkspace)
      appendLog(`Updated clip settings for ${clip.name}`)
    } catch (error) {
      appendLog(error instanceof Error ? error.message : 'Clip settings update failed', 'error')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleUpdateRuntimeBuildSettings(settings: Partial<{ sampleFrameStep: number; scaleMode: RuntimeScaleMode; trajectoryPredictionFrames: number[] }>) {
    if (!selectedCharacter) {
      return
    }

    const nextSettings = {
      sampleFrameStep: settings.sampleFrameStep ?? selectedCharacter.runtimeBuildSettings.sampleFrameStep,
      scaleMode: settings.scaleMode ?? selectedCharacter.runtimeBuildSettings.scaleMode,
      trajectoryPredictionFrames: settings.trajectoryPredictionFrames ?? selectedCharacter.runtimeBuildSettings.trajectoryPredictionFrames,
    }

    try {
      setRuntimeSettingsSaveState({ characterId: selectedCharacter.id, state: 'saving' })
      const updatedCharacter = await updateRuntimeBuildSettings(selectedCharacter.id, nextSettings)
      setWorkspace((currentWorkspace) => currentWorkspace
        ? {
            ...currentWorkspace,
            characters: currentWorkspace.characters.map((item) =>
              item.id === updatedCharacter.id ? updatedCharacter : item,
            ),
          }
        : currentWorkspace)
      setRuntimeSettingsSaveState({ characterId: selectedCharacter.id, state: 'saved' })
    } catch (error) {
      setRuntimeSettingsSaveState({ characterId: selectedCharacter.id, state: 'failed' })
      appendLog(error instanceof Error ? error.message : 'Runtime build settings update failed', 'error')
    }
  }

  async function handleRefreshFootContacts(characterId: string, clip: ClipResponse) {
    setIsBusy(true)
    appendLog(`Refreshing foot contacts for ${clip.name}`)
    try {
      const updatedCharacter = await refreshFootContacts(characterId, clip.id)

      setWorkspace((currentWorkspace) => currentWorkspace
        ? {
            ...currentWorkspace,
            characters: currentWorkspace.characters.map((item) =>
              item.id === updatedCharacter.id ? updatedCharacter : item,
            ),
          }
        : currentWorkspace)
      appendLog(`Refreshed foot contacts for ${clip.name}`)
    } catch (error) {
      appendLog(error instanceof Error ? error.message : 'Foot contact refresh failed', 'error')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleGenerateBuildReport(character: CharacterResponse) {
    setIsBusy(true)
    appendLog(`Generating build report for ${character.name}`)
    try {
      const report = await generateBuildReport(character.id)
      setLastBuildReport(report)
      setWorkspace((currentWorkspace) => currentWorkspace
        ? {
            ...currentWorkspace,
            characters: currentWorkspace.characters.map((item) =>
              item.id === character.id ? { ...item, buildReportPath: report.reportPath, buildReportStatus: 'current' } : item,
            ),
          }
        : currentWorkspace)
      appendLog(`Build report generated: ${report.reportPath} (${report.buildReadiness.warningCount} warnings, ${report.buildReadiness.errorCount} errors)`, report.buildReadiness.errorCount > 0 ? 'error' : report.buildReadiness.warningCount > 0 ? 'warning' : 'info')
    } catch (error) {
      appendLog(error instanceof Error ? error.message : 'Build report generation failed', 'error')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleViewBuildReport(character: CharacterResponse) {
    const cachedReport = lastBuildReport?.characterId === character.id ? lastBuildReport : null
    if (cachedReport) {
      openBuildReportViewer(cachedReport, character.buildReadiness)
      return
    }

    setIsBusy(true)
    appendLog(`Loading build report for ${character.name}`)
    try {
      const report = await getBuildReport(character.id)
      setLastBuildReport(report)
      openBuildReportViewer(report, character.buildReadiness)
      appendLog(`Opened build report: ${report.reportPath}`)
    } catch (error) {
      appendLog(error instanceof Error ? error.message : 'Build report load failed', 'error')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleGenerateRuntimeBuildDraft(character: CharacterResponse) {
    const { sampleFrameStep, scaleMode, trajectoryPredictionFrames } = character.runtimeBuildSettings
    setIsBusy(true)
    appendLog(`Building runtime draft for ${character.name} at step ${sampleFrameStep}, scale ${scaleMode}, trajectory +${trajectoryPredictionFrames.join('/')}f @${defaultSamplingFrameRate}`)
    try {
      const draft = await generateRuntimeBuildDraft(character.id, sampleFrameStep, scaleMode)
      setLastRuntimeDraft(draft)
      setLastBuildReport({
        characterId: draft.characterId,
        characterName: draft.characterName,
        reportPath: draft.sourceReportPath,
        generatedAtUtc: draft.generatedAtUtc,
        readinessFingerprint: '',
        buildReadiness: draft.buildReadiness,
      })
      setWorkspace((currentWorkspace) => currentWorkspace
        ? {
            ...currentWorkspace,
            characters: currentWorkspace.characters.map((item) =>
              item.id === character.id
                ? {
                    ...item,
                    buildReportPath: draft.sourceReportPath,
                    buildReportStatus: 'current',
                    runtimeBuildDraftPath: draft.draftPath,
                    runtimeBuildDraftStatus: 'current',
                  }
                : item,
            ),
          }
        : currentWorkspace)
      appendLog(`Runtime build complete: ${draft.draftPath} (${draft.database.sampleCount} database samples, ${draft.poses.samples.length} pose value samples)`, draft.database.status === 'error' ? 'error' : draft.database.status === 'warning' ? 'warning' : 'info')
    } catch (error) {
      appendLog(error instanceof Error ? error.message : 'Runtime build draft generation failed', 'error')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleViewRuntimeBuildDraft(character: CharacterResponse) {
    const cachedDraft = lastRuntimeDraft?.characterId === character.id ? lastRuntimeDraft : null
    if (cachedDraft) {
      openRuntimeDraftViewer(cachedDraft, character.buildReadiness)
      return
    }

    setIsBusy(true)
    appendLog(`Loading runtime build draft for ${character.name}`)
    try {
      const draft = await getRuntimeBuildDraft(character.id)
      setLastRuntimeDraft(draft)
      openRuntimeDraftViewer(draft, character.buildReadiness)
      appendLog(`Opened runtime build draft: ${draft.draftPath}`)
    } catch (error) {
      appendLog(error instanceof Error ? error.message : 'Runtime build draft load failed', 'error')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleViewRuntimeDatabaseDraft(character: CharacterResponse) {
    const cachedDraft = lastRuntimeDraft?.characterId === character.id ? lastRuntimeDraft : null
    if (cachedDraft) {
      openRuntimeDatabaseDraftViewer(cachedDraft)
      return
    }

    setIsBusy(true)
    appendLog(`Loading runtime database draft for ${character.name}`)
    try {
      const draft = await getRuntimeBuildDraft(character.id)
      setLastRuntimeDraft(draft)
      openRuntimeDatabaseDraftViewer(draft)
      appendLog(`Opened runtime database draft: ${runtimeDatabasePathFromDraft(draft)}`)
    } catch (error) {
      appendLog(error instanceof Error ? error.message : 'Runtime database draft load failed', 'error')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleCopyRuntimeBuildFolder(character: CharacterResponse) {
    const cachedDraft = lastRuntimeDraft?.characterId === character.id ? lastRuntimeDraft : null
    const draftPath = cachedDraft?.draftPath ?? character.runtimeBuildDraftPath
    if (!draftPath) {
      appendLog('Runtime build folder is unavailable until Build Runtime runs.', 'warning')
      return
    }

    try {
      await navigator.clipboard.writeText(buildFolderFromDraftPath(draftPath))
      appendLog(`Copied runtime build folder: ${buildFolderFromDraftPath(draftPath)}`)
    } catch {
      appendLog('Runtime build folder copy failed', 'error')
    }
  }

  async function handleExportRuntimeBuild(character: CharacterResponse) {
    setIsBusy(true)
    appendLog(`Exporting runtime build ZIP for ${character.name}`)
    try {
      const result = await exportRuntimeBuild(character.id)
      appendLog(`Runtime build ZIP exported: ${result.zipPath} (${result.includedPaths.length} files)`)
    } catch (error) {
      appendLog(error instanceof Error ? error.message : 'Runtime build export failed', 'error')
    } finally {
      setIsBusy(false)
    }
  }

  function openBuildReportViewer(report: BuildReportResponse, currentReadiness: CharacterResponse['buildReadiness']) {
    setTextViewer({
      heading: 'Build Report',
      title: report.reportPath,
      report,
      currentReadiness,
    })
  }

  function openRuntimeDraftViewer(draft: RuntimeBuildDraftResponse, currentReadiness: CharacterResponse['buildReadiness']) {
    setTextViewer({
      heading: 'Runtime Draft',
      title: draft.draftPath,
      runtimeDraft: draft,
      currentReadiness,
    })
  }

  function openRuntimeDatabaseDraftViewer(draft: RuntimeBuildDraftResponse) {
    const databasePath = runtimeDatabasePathFromDraft(draft)
    setTextViewer({
      heading: 'Database Draft',
      title: databasePath,
      databaseDraft: draft.database,
      databasePath,
    })
  }

  function openLogViewer() {
    setTextViewer({
      heading: 'Log',
      title: 'Recent messages',
      text: logs.map((entry) => `[${entry.level.toUpperCase()}] ${entry.message}`).join('\n'),
    })
  }

  return (
    <main className="studio-shell">
      <aside className="panel panel-left" aria-label="Workspace tree">
        <header className="panel-header">
          <span className="panel-title">
            <ListTree size={16} aria-hidden="true" />
            Workspace
          </span>
        </header>
        <input
          ref={fileInputRef}
          className="hidden-file-input"
          type="file"
          accept=".fbx"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) {
              handleAddCharacter(file)
            }
          }}
        />
        <input
          ref={clipInputRef}
          className="hidden-file-input"
          type="file"
          accept=".fbx,.bvh"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) {
              handleAddClip(file)
            }
          }}
        />
        <input
          ref={replaceClipInputRef}
          className="hidden-file-input"
          type="file"
          accept=".fbx,.bvh"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) {
              handleReplaceClipSource(file)
            }
          }}
        />
        <div className="tree-content">
          <button
            type="button"
            className="primary-action"
            disabled={isBusy}
            onClick={() => fileInputRef.current?.click()}
          >
            {isBusy ? <Loader2 size={16} aria-hidden="true" /> : <CirclePlus size={16} aria-hidden="true" />}
            {isBusy ? 'Importing' : 'Add Character'}
          </button>
          <button
            type="button"
            className="secondary-action"
            disabled={isBusy || !selectedCharacter}
            onClick={() => clipInputRef.current?.click()}
          >
            {isBusy ? <Loader2 size={16} aria-hidden="true" /> : <Film size={16} aria-hidden="true" />}
            Add Clip
          </button>
          <div className="tree-list">
            {workspace?.characters.map((character) => (
              <div key={character.id} className="tree-group">
                <button
                  type="button"
                  className={`tree-item ${selection?.type === 'character' && character.id === selection.characterId ? 'selected' : ''}`}
                  onClick={() => selectCharacter(character.id)}
                  onContextMenu={(event) => openCharacterContextMenu(event, character)}
                >
                  {validationIcon(character)}
                  <span>{character.name}</span>
                </button>
                <div className="tree-folder">
                  <div className="tree-folder-label">
                    <span>Clips</span>
                    <span>{character.clips?.length ?? 0}</span>
                  </div>
                  {(character.clips ?? []).map((clip) => (
                    <button
                      key={clip.id}
                      type="button"
                      className={`tree-item tree-item-child ${selection?.type === 'clip' && clip.id === selection.clipId ? 'selected' : ''}`}
                      onClick={() => selectClip(character.id, clip.id)}
                      onContextMenu={(event) => openClipContextMenu(event, character.id, clip)}
                    >
                      {clipValidationIcon(clip)}
                      <span>{clip.name}</span>
                    </button>
                  ))}
                </div>
                <div className="tree-folder">
                  <div className="tree-folder-label">
                    <span>Samplings</span>
                    <button
                      type="button"
                      className="tree-folder-add"
                      disabled={isBusy}
                      onClick={(event) => {
                        event.stopPropagation()
                        handleCreateSampling(character)
                      }}
                      aria-label={`Add sampling for ${character.name}`}
                      title="Add sampling"
                    >
                      +
                    </button>
                  </div>
                  {character.samplings.map((sampling) => (
                    <button
                      key={`${character.id}-${sampling.id}`}
                      type="button"
                      className={`tree-item tree-item-child tree-item-sampling ${selection?.type === 'sampling' && selection.characterId === character.id && selection.samplingId === sampling.id ? 'selected' : ''}`}
                      onClick={() => selectSampling(character.id, sampling.id)}
                      onContextMenu={(event) => openSamplingContextMenu(event, character.id, sampling)}
                    >
                      <FileText size={14} aria-hidden="true" />
                      <span>{sampling.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <section className="center-stack">
        <BabylonViewport
          previewUrl={resolveAssetUrl(selectedCharacter?.previewUrl ?? null)}
          clipPreviewUrl={resolveAssetUrl(selectedClip?.previewUrl ?? null)}
          clipFrame={selectedClip ? visibleTimelineFrame : null}
          clipFrameCount={selectedClip ? timelineFrameCount : null}
          clipFrameRate={selectedClip?.frameRate ?? null}
          clipDurationSeconds={selectedClip?.durationSeconds ?? null}
          footContacts={selectedClip?.footContacts ?? null}
          clipMotionMode={clipMotionMode}
          samplingPreview={isSamplingPreviewActive}
          samplingQuery={visibleSampling}
          samplingFrameRate={defaultSamplingFrameRate}
          samplingGhostPoses={isSamplingPreviewActive ? selectedSamplingGhostPoses : []}
          samplingPreviewFrame={visibleSamplingPreviewFrame}
          samplingQueryVectorFrames={samplingQueryVectorFrames}
          showSamplingQueryVectors={isSamplingPreviewActive && showSamplingQueryVectors}
          selectedSamplingPointIndex={visibleSelectedSamplingPointIndex}
          onSamplingPointSelect={setSelectedSamplingPointIndex}
          label={selectedClip ? `${selectedCharacter?.name ?? 'Character'} / ${selectedClip.name}` : selectedCharacter?.name ?? 'Empty scene'}
          onClipMotionModeChange={setClipMotionMode}
          onAnimationStateChange={setAnimationPreviewState}
          onSamplingQueryChange={handleSamplingDraftChange}
        />
      </section>

      <aside className="panel panel-right" aria-label="Object inspector">
        <header className="panel-header">
          <span className="panel-title">
            <FileText size={16} aria-hidden="true" />
            Inspector
          </span>
        </header>
        {selectedClip && selectedCharacter ? (
          <ClipInspector
            character={selectedCharacter}
            clip={selectedClip}
            animationPreviewState={animationPreviewState}
            clipMotionMode={clipMotionMode}
            isBusy={isBusy}
            onUpdateSettings={(settings) => handleUpdateClipSettings(selectedCharacter.id, selectedClip, settings)}
            onRefreshFootContacts={() => handleRefreshFootContacts(selectedCharacter.id, selectedClip)}
            onReplaceSource={() => replaceClipInputRef.current?.click()}
          />
        ) : selectedCharacter ? (
          <CharacterInspector
            character={selectedCharacter}
            isBusy={isBusy}
            lastBuildReport={lastBuildReport?.characterId === selectedCharacter.id ? lastBuildReport : null}
            lastRuntimeDraft={lastRuntimeDraft?.characterId === selectedCharacter.id ? lastRuntimeDraft : null}
            selectedSampling={savedVisibleSampling}
            selectedSamplingDraft={visibleSampling}
            runtimeSampleFrameStep={selectedCharacter.runtimeBuildSettings.sampleFrameStep}
            runtimeScaleMode={selectedCharacter.runtimeBuildSettings.scaleMode}
            runtimeTrajectoryPredictionFrames={selectedCharacter.runtimeBuildSettings.trajectoryPredictionFrames}
            activeTab={characterInspectorTab}
            runtimeSettingsSaveState={visibleRuntimeSettingsSaveState}
            hasBuildReport={Boolean((lastBuildReport?.characterId === selectedCharacter.id && lastBuildReport) || selectedCharacter.buildReportPath)}
            hasRuntimeDraft={Boolean((lastRuntimeDraft?.characterId === selectedCharacter.id && lastRuntimeDraft) || selectedCharacter.runtimeBuildDraftPath)}
            onGenerateBuildReport={() => handleGenerateBuildReport(selectedCharacter)}
            onGenerateRuntimeBuildDraft={() => handleGenerateRuntimeBuildDraft(selectedCharacter)}
            onLoadRuntimeDraft={() => handleViewRuntimeBuildDraft(selectedCharacter)}
            onViewBuildReport={() => handleViewBuildReport(selectedCharacter)}
            onViewRuntimeDraft={() => handleViewRuntimeBuildDraft(selectedCharacter)}
            onViewRuntimeDatabaseDraft={() => handleViewRuntimeDatabaseDraft(selectedCharacter)}
            onCopyRuntimeBuildFolder={() => handleCopyRuntimeBuildFolder(selectedCharacter)}
            onExportRuntimeBuild={() => handleExportRuntimeBuild(selectedCharacter)}
            onActiveTabChange={setCharacterInspectorTab}
            onSamplingDraftChange={handleSamplingDraftChange}
            onUpdateSampling={(samplingId, update) => handleUpdateSampling(selectedCharacter.id, samplingId, update)}
            onRuntimeSampleFrameStepChange={(sampleFrameStep) => handleUpdateRuntimeBuildSettings({ sampleFrameStep })}
            onRuntimeScaleModeChange={(scaleMode) => handleUpdateRuntimeBuildSettings({ scaleMode })}
            onRuntimeTrajectoryPredictionFramesChange={(trajectoryPredictionFrames) => handleUpdateRuntimeBuildSettings({ trajectoryPredictionFrames })}
            onSelectClip={(clipId) => selectClip(selectedCharacter.id, clipId)}
            selectedMatcherKey={selectedSamplingMatch ? samplingMatcherPreviewKey(selectedSamplingMatch) : null}
            onPreviewMatcherSample={previewMatcherSample}
            onSelectMatcherSample={(match) => selectMatcherSample(selectedCharacter.id, match)}
            selectedSamplingPointIndex={visibleSelectedSamplingPointIndex}
            onSamplingPointSelect={setSelectedSamplingPointIndex}
          />
        ) : (
          <div className="inspector-empty">
            Select a character or imported asset.
          </div>
        )}
      </aside>

      <section className={`bottom-panel ${hasBottomTimeline ? 'has-timeline' : 'log-only'}`} aria-label="Timeline and logs">
        {selectedClip ? (
          <TimelinePanel
            clip={selectedClip}
            title={selectedClip.name}
            frame={visibleTimelineFrame}
            frameCount={timelineFrameCount}
            frameRate={timelineFrameRate}
            durationSeconds={selectedClip.durationSeconds}
            hasMetadata={hasClipTimelineMetadata}
            isEnabled
            isPlaying={isTimelinePlaying}
            footContacts={selectedClip.footContacts}
            onTogglePlay={() => selectedClip && setIsTimelinePlaying((current) => !current)}
            onStep={stepTimeline}
            onSeek={seekTimeline}
            loopStartFrame={visibleLoopStartFrame}
            loopEndFrame={visibleLoopEndFrame}
            onSetLoopStart={(frame) => {
              const nextStart = Math.min(Math.max(frame, 0), visibleLoopEndFrame)
              setLoopStartFrame(nextStart)
            }}
            onSetLoopEnd={(frame) => {
              const nextEnd = Math.max(Math.min(frame, maxTimelineFrame), visibleLoopStartFrame)
              setLoopEndFrame(nextEnd)
            }}
          />
        ) : hasSamplingTimeline ? (
          <TimelinePanel
            clip={null}
            title={hasSamplingPreviewTimeline ? `Sampling: ${activeSamplingPreviewMatch?.clipName ?? 'match'}` : 'Sampling: load samples'}
            frame={visibleSamplingPreviewFrame}
            frameCount={samplingPreviewFrameCount}
            frameRate={fallbackFrameRate}
            durationSeconds={samplingPreviewFrameCount / fallbackFrameRate}
            hasMetadata
            isEnabled={hasSamplingPreviewTimeline}
            isPlaying={isTimelinePlaying && hasSamplingPreviewTimeline}
            footContacts={null}
            markerFrames={visibleSampling?.trajectory.map((point) => point.frameOffset) ?? []}
            activeMarkerFrame={selectedSamplingPointFrame}
            ghostingMode={samplingGhostingMode}
            onGhostingModeChange={setSamplingGhostingMode}
            showQueryVectors={showSamplingQueryVectors}
            onShowQueryVectorsChange={setShowSamplingQueryVectors}
            onTogglePlay={() => hasSamplingPreviewTimeline && setIsTimelinePlaying((current) => !current)}
            onStep={stepSamplingTimeline}
            onSeek={seekSamplingTimeline}
            loopStartFrame={0}
            loopEndFrame={maxSamplingPreviewFrame}
            onSetLoopStart={() => undefined}
            onSetLoopEnd={() => undefined}
            showLoopControls={false}
          />
        ) : null}
        <button type="button" className="log-strip" onClick={openLogViewer} title="Open log">
          <TerminalSquare size={15} aria-hidden="true" />
          <div className="log-lines">
            <span className={`log-line ${latestLog?.level ?? 'info'}`}>
              {latestLog?.message ?? 'Ready'}
            </span>
          </div>
        </button>
      </section>
      {clipContextMenu ? (
        <div
          className="context-menu"
          style={{ left: clipContextMenu.x, top: clipContextMenu.y }}
          role="menu"
          aria-label={`Clip actions for ${clipContextMenu.clipName}`}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="context-menu-item danger"
            role="menuitem"
            disabled={isBusy}
            onClick={() => handleDeleteClip(clipContextMenu.characterId, clipContextMenu.clipId)}
          >
            <Trash2 size={14} aria-hidden="true" />
            Delete
          </button>
        </div>
      ) : null}
      {characterContextMenu ? (
        <div
          className="context-menu"
          style={{ left: characterContextMenu.x, top: characterContextMenu.y }}
          role="menu"
          aria-label={`Character actions for ${characterContextMenu.characterName}`}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="context-menu-item danger"
            role="menuitem"
            disabled={isBusy}
            onClick={() => handleDeleteCharacter(characterContextMenu.characterId)}
          >
            <Trash2 size={14} aria-hidden="true" />
            Delete Character
          </button>
        </div>
      ) : null}
      {samplingContextMenu ? (
        <div
          className="context-menu"
          style={{ left: samplingContextMenu.x, top: samplingContextMenu.y }}
          role="menu"
          aria-label={`Sampling actions for ${samplingContextMenu.samplingName}`}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="context-menu-item"
            role="menuitem"
            disabled={isBusy}
            onClick={() => handleRenameSampling(samplingContextMenu.characterId, samplingContextMenu.samplingId)}
          >
            <FileText size={14} aria-hidden="true" />
            Rename
          </button>
          <button
            type="button"
            className="context-menu-item danger"
            role="menuitem"
            disabled={isBusy}
            onClick={() => handleDeleteSampling(samplingContextMenu.characterId, samplingContextMenu.samplingId)}
          >
            <Trash2 size={14} aria-hidden="true" />
            Delete Sampling
          </button>
        </div>
      ) : null}
      {textViewer ? (
        <TextModal
          heading={textViewer.heading}
          title={textViewer.title}
          text={textViewer.text}
          report={textViewer.report}
          runtimeDraft={textViewer.runtimeDraft}
          databaseDraft={textViewer.databaseDraft}
          databasePath={textViewer.databasePath}
          currentReadiness={textViewer.currentReadiness}
          onClose={() => setTextViewer(null)}
        />
      ) : null}
    </main>
  )
}

function TextModal({
  heading,
  title,
  text,
  report,
  runtimeDraft,
  databaseDraft,
  databasePath,
  currentReadiness,
  onClose,
}: {
  heading: string
  title: string
  text?: string
  report?: BuildReportResponse
  runtimeDraft?: RuntimeBuildDraftResponse
  databaseDraft?: RuntimeDatabaseDraftResponse
  databasePath?: string
  currentReadiness?: CharacterResponse['buildReadiness']
  onClose: () => void
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="report-modal"
        role="dialog"
        aria-modal="true"
        aria-label={heading}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="report-modal-header">
          <div>
            <h2>{heading}</h2>
            <span>{title}</span>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={`Close ${heading.toLowerCase()}`}>
            <X size={15} aria-hidden="true" />
          </button>
        </header>
        {report ? (
          <BuildReportView report={report} currentReadiness={currentReadiness} />
        ) : runtimeDraft ? (
          <RuntimeDraftView draft={runtimeDraft} currentReadiness={currentReadiness} />
        ) : databaseDraft ? (
          <DatabaseDraftView database={databaseDraft} path={databasePath ?? title} />
        ) : (
          <pre className="report-modal-text">{text}</pre>
        )}
      </section>
    </div>
  )
}

function BuildReportView({
  report,
  currentReadiness,
}: {
  report: BuildReportResponse
  currentReadiness?: CharacterResponse['buildReadiness']
}) {
  const readiness = report.buildReadiness
  const presentRoles = readiness.roles.filter((role) => role.includedClipCount > 0)
  const missingRoles = readiness.roles.filter((role) => role.isRequired && role.includedClipCount === 0)
  const changes = currentReadiness ? describeReadinessChanges(readiness, currentReadiness) : []
  const [pathCopyState, setPathCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function copyBuildReportPaths() {
    try {
      await navigator.clipboard.writeText(buildReportPathsText(report))
      setPathCopyState('copied')
    } catch {
      setPathCopyState('failed')
    }
  }

  return (
    <div className="report-view">
      <section className="report-section">
        <h3>Summary</h3>
        <dl className="report-summary-grid">
          <dt>Character</dt>
          <dd>{report.characterName}</dd>
          <dt>Generated</dt>
          <dd>{formatReportDate(report.generatedAtUtc)}</dd>
          <dt>Included</dt>
          <dd>{readiness.includedClipCount}</dd>
          <dt>Mirrored</dt>
          <dd>{readiness.mirroredCopyCount}</dd>
          <dt>Planned</dt>
          <dd>{readiness.plannedClipCount}</dd>
          <dt>Warnings</dt>
          <dd>{readiness.warningCount}</dd>
          <dt>Errors</dt>
          <dd>{readiness.errorCount}</dd>
        </dl>
        <button type="button" className="inspector-action" onClick={copyBuildReportPaths}>
          <Copy size={14} aria-hidden="true" />
          {pathCopyState === 'copied' ? 'Copied Paths' : pathCopyState === 'failed' ? 'Copy Failed' : 'Copy Paths'}
        </button>
      </section>
      {changes.length ? (
        <section className="report-section">
          <h3>Outdated Changes</h3>
          <div className="report-table">
            {changes.map((change) => (
              <div key={change} className="report-row warning single">
                <span>{change}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <section className="report-section">
        <h3>Roles</h3>
        <p>Present: {presentRoles.length ? presentRoles.map((role) => `${role.role} (${role.includedClipCount})`).join(', ') : 'None'}</p>
        <p>Missing: {missingRoles.length ? missingRoles.map((role) => role.role).join(', ') : 'None'}</p>
      </section>
      <section className="report-section">
        <h3>Plan</h3>
        <div className="report-table">
          {readiness.planEntries.map((entry) => (
            <div key={`${entry.clipId}-${entry.isMirrored ? 'mirror' : 'source'}`} className="report-row">
              <span>{entry.clipName}</span>
              <span>{entry.clipRole ?? 'Unassigned'}</span>
              <span>{entry.isMirrored ? 'Mirrored' : 'Source'}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="report-section">
        <h3>Skeleton</h3>
        <div className="report-table">
          {readiness.skeletonCoverage.map((item) => (
            <div key={item.clipId} className={`report-row ${item.status}`}>
              <span>{item.clipName}</span>
              <span>{item.coverage === null ? '--' : `${Math.round(item.coverage * 100)}%`}</span>
              <span>{item.status}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="report-section">
        <h3>Foot Contacts</h3>
        <div className="report-table">
          {readiness.footContacts.map((item) => (
            <div key={item.clipId} className={`report-row ${item.hasContacts ? 'ok' : 'missing'}`}>
              <span>{item.clipName}</span>
              <span>{item.hasContacts ? `${item.rangeCount} ranges` : 'Missing'}</span>
              <span>{item.missingFeet.length ? `Missing ${item.missingFeet.join(', ')}` : item.presentFeet.join(', ')}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="report-section">
        <h3>Findings</h3>
        <div className="report-table">
          {readiness.findings.length ? readiness.findings.map((finding, index) => (
            <div key={`${finding.severity}-${finding.code}-${finding.clipId ?? 'character'}-${index}`} className={`report-row ${finding.severity}`}>
              <span>{finding.clipName ?? 'Character'}</span>
              <span>{finding.code}</span>
              <span>{finding.message}</span>
            </div>
          )) : <p>No findings</p>}
        </div>
      </section>
      <section className="report-section">
        <h3>Raw JSON</h3>
        <pre className="report-modal-text raw">{JSON.stringify(report, null, 2)}</pre>
      </section>
    </div>
  )
}

function RuntimeDraftView({
  draft,
  currentReadiness,
}: {
  draft: RuntimeBuildDraftResponse
  currentReadiness?: CharacterResponse['buildReadiness']
}) {
  const readiness = draft.buildReadiness
  const changes = currentReadiness ? describeReadinessChanges(readiness, currentReadiness) : []
  const queryContractFeatures = buildRuntimeQueryContractFeatures(draft)
  const [contractCopyState, setContractCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [pathCopyState, setPathCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [folderCopyState, setFolderCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function copyEngineQueryContract() {
    try {
      await navigator.clipboard.writeText(buildEngineQueryContract(draft))
      setContractCopyState('copied')
    } catch {
      setContractCopyState('failed')
    }
  }

  async function copyRuntimeDraftPaths() {
    try {
      await navigator.clipboard.writeText(runtimeDraftPathsText(draft))
      setPathCopyState('copied')
    } catch {
      setPathCopyState('failed')
    }
  }

  async function copyRuntimeBuildFolder() {
    try {
      await navigator.clipboard.writeText(buildFolderFromDraftPath(draft.draftPath))
      setFolderCopyState('copied')
    } catch {
      setFolderCopyState('failed')
    }
  }

  return (
    <div className="report-view">
      <section className="report-section">
        <h3>Summary</h3>
        <dl className="report-summary-grid">
          <dt>Character</dt>
          <dd>{draft.characterName}</dd>
          <dt>Generated</dt>
          <dd>{formatReportDate(draft.generatedAtUtc)}</dd>
          <dt>Source report</dt>
          <dd>{draft.sourceReportPath}</dd>
          <dt>Sample step</dt>
          <dd>{draft.sampleFrameStep}</dd>
          <dt>Skeleton</dt>
          <dd>{`${draft.skeleton.status}, ${draft.skeleton.boneCount} bones`}</dd>
          <dt>Poses</dt>
          <dd>{`${draft.poses.status}, ${draft.poses.samples.length}/${draft.poses.plannedPoseSampleCount} values`}</dd>
          <dt>Features</dt>
          <dd>{`${draft.features.status}, ${draft.features.featureCount} channels`}</dd>
          <dt>Scale</dt>
          <dd>{`${formatRuntimeScaleMode(draft.features.scale.mode)}, ${draft.features.scale.status}, x${formatNumber(draft.features.scale.normalizationFactor)}`}</dd>
          <dt>Included</dt>
          <dd>{readiness.includedClipCount}</dd>
          <dt>Planned</dt>
          <dd>{readiness.plannedClipCount}</dd>
        </dl>
        <button type="button" className="inspector-action" onClick={copyEngineQueryContract}>
          <FileText size={14} aria-hidden="true" />
          {contractCopyState === 'copied' ? 'Copied Query Contract' : contractCopyState === 'failed' ? 'Copy Failed' : 'Copy Query Contract'}
        </button>
        <button type="button" className="inspector-action" onClick={copyRuntimeDraftPaths}>
          <Copy size={14} aria-hidden="true" />
          {pathCopyState === 'copied' ? 'Copied Paths' : pathCopyState === 'failed' ? 'Copy Failed' : 'Copy Paths'}
        </button>
        <button type="button" className="inspector-action" onClick={copyRuntimeBuildFolder}>
          <Copy size={14} aria-hidden="true" />
          {folderCopyState === 'copied' ? 'Copied Build Folder' : folderCopyState === 'failed' ? 'Copy Failed' : 'Copy Build Folder'}
        </button>
      </section>
      {draft.poses.plannedPoseSampleCount > 0 && draft.poses.samples.length === 0 ? (
        <section className="report-section">
          <h3>Pose Warning</h3>
          <div className="report-table">
            <div className="report-row warning single">
              <span>Pose value samples are missing. Rebuild after clip preview GLBs are available, or check clip import warnings.</span>
            </div>
          </div>
        </section>
      ) : null}
      {changes.length ? (
        <section className="report-section">
          <h3>Outdated Changes</h3>
          <div className="report-table">
            {changes.map((change) => (
              <div key={change} className="report-row warning single">
                <span>{change}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <section className="report-section">
        <h3>Query Contract</h3>
        <p>Runtime must read this feature layout from the database and fill query values by these exact names.</p>
        <div className="report-table feature-contract-table">
          {queryContractFeatures.map((feature) => (
            <div key={feature.name} className="report-row">
              <span>{feature.name}</span>
              <span>{feature.kind}</span>
              <span>{feature.timeSeconds === null ? feature.boneSlot ?? '--' : `+${feature.trajectoryFrame}f / ${formatNumber(feature.timeSeconds)}s`}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="report-section">
        <h3>Artifacts</h3>
        <div className="report-table">
          {draft.artifacts.map((artifact) => (
            <div key={`${artifact.kind}-${artifact.fileName}`} className={`report-row ${artifact.status === 'blocked' ? 'error' : artifact.status === 'draft' ? 'ok' : ''}`}>
              <span>{artifact.fileName}</span>
              <span>{artifact.kind}</span>
              <span>{artifact.status}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="report-section">
        <h3>Feature Preset</h3>
        {draft.features.scale.warnings.length ? (
          <div className="report-table">
            {draft.features.scale.warnings.map((warning) => (
              <div key={warning} className="report-row warning single">
                <span>{warning}</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="report-table">
          {draft.features.channels.map((channel) => (
            <div key={`${channel.name}-${channel.boneSlot ?? 'none'}`} className="report-row">
              <span>{channel.name}</span>
              <span>{channel.kind}</span>
              <span>{channel.trajectoryFrames.length ? `${channel.boneSlot ?? '--'} ${formatTrajectoryChannelOffsets(channel)}` : channel.boneSlot ?? '--'}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="report-section">
        <h3>Pose Samples</h3>
        <div className="report-table">
          {draft.poses.clips.length ? draft.poses.clips.map((clip) => (
            <div key={`${clip.clipId}-${clip.isMirrored ? 'mirror' : 'source'}`} className={`report-row ${clip.plannedSampleCount > 0 ? 'ok' : 'warning'}`}>
              <span>{clip.clipName}</span>
              <span>{clip.clipRole ?? 'Unassigned'}{clip.isMirrored ? ' mirror' : ''}</span>
              <span>{`${clip.plannedSampleCount} samples, F ${clip.sampleFramesPreview.join(', ') || '--'}`}</span>
            </div>
          )) : <p>No pose samples planned</p>}
        </div>
      </section>
      <section className="report-section">
        <h3>Pose Values Preview</h3>
        <div className="report-table">
          {draft.poses.samples.length ? draft.poses.samples.slice(0, 12).map((sample, index) => (
            <div key={`${sample.clipId}-${sample.isMirrored ? 'mirror' : 'source'}-${sample.frame}-${index}-pose`} className="report-row">
              <span>{`${sample.clipName}${sample.isMirrored ? ' Mirror' : ''} F${sample.frame + 1}`}</span>
              <span>{`${sample.bones.length} bones`}</span>
              <span>{formatPoseBonePreview(sample.bones)}</span>
            </div>
          )) : <p>No pose values sampled</p>}
        </div>
      </section>
      <section className="report-section">
        <h3>Feature Samples</h3>
        <div className="report-table">
          {draft.features.clips.length ? draft.features.clips.map((clip) => (
            <div key={`${clip.clipId}-${clip.isMirrored ? 'mirror' : 'source'}`} className={`report-row ${clip.plannedSampleCount > 0 ? 'ok' : 'warning'}`}>
              <span>{clip.clipName}</span>
              <span>{clip.isMirrored ? 'Mirrored' : 'Source'}</span>
              <span>{`${clip.plannedSampleCount} samples x ${draft.features.featureCount} channels`}</span>
            </div>
          )) : <p>No feature samples planned</p>}
        </div>
      </section>
      <section className="report-section">
        <h3>Database Draft</h3>
        <dl className="report-summary-grid">
          <dt>Status</dt>
          <dd>{draft.database.status}</dd>
          <dt>Schema</dt>
          <dd>{`${draft.database.schema.id} v${draft.database.schema.version}`}</dd>
          <dt>Clips</dt>
          <dd>{draft.database.clipCount}</dd>
          <dt>Samples</dt>
          <dd>{draft.database.sampleCount}</dd>
          <dt>Pose values</dt>
          <dd>{draft.database.poseSamples.length}</dd>
          <dt>Features</dt>
          <dd>{draft.database.featureCount}</dd>
        </dl>
        <div className="report-table">
          {draft.database.clips.length ? draft.database.clips.map((clip) => (
            <div key={`${clip.clipId}-${clip.isMirrored ? 'mirror' : 'source'}-database`} className={`report-row ${clip.footContacts.length ? 'ok' : 'warning'}`}>
              <span>{clip.clipName}</span>
              <span>{clip.isMirrored ? 'Mirrored' : 'Source'}</span>
              <span>{`${clip.plannedSampleCount} samples, ${formatSourceTimeline(clip)}, ${clip.footContacts.length} contact tracks`}</span>
            </div>
          )) : <p>No database clips planned</p>}
        </div>
      </section>
      <section className="report-section">
        <h3>Feature Value Preview</h3>
        <div className="report-table">
          {draft.features.samplePreviews.length ? draft.features.samplePreviews.slice(0, 18).map((sample, index) => (
            <div key={`${sample.clipId}-${sample.isMirrored ? 'mirror' : 'source'}-${sample.frame}-${index}`} className="report-row">
              <span>{`${sample.clipName}${sample.isMirrored ? ' Mirror' : ''} F${sample.frame + 1}`}</span>
              <span>{`${formatNumber(sample.seconds)}s`}</span>
              <span>{formatFeaturePreviewValues(sample.values)}</span>
            </div>
          )) : <p>No feature value preview</p>}
        </div>
      </section>
      <section className="report-section">
        <h3>Skeleton Slots</h3>
        <div className="report-table">
          {draft.skeleton.slots.map((slot) => (
            <div key={slot.slot} className={`report-row ${slot.status === 'matched' ? 'ok' : 'missing'}`}>
              <span>{slot.slot}</span>
              <span>{slot.status}</span>
              <span>{slot.boneName ?? '--'}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="report-section">
        <h3>Skeleton Bones</h3>
        <p>{draft.skeleton.boneNames.length ? draft.skeleton.boneNames.join(', ') : 'No bones'}</p>
      </section>
      <section className="report-section">
        <h3>Runtime Findings</h3>
        <div className="report-table">
          {[...draft.skeleton.findings, ...draft.poses.findings, ...draft.features.findings, ...draft.database.findings].length ? (
            [...draft.skeleton.findings, ...draft.poses.findings, ...draft.features.findings, ...draft.database.findings].map((finding, index) => (
              <div key={`${finding.severity}-${finding.code}-${index}`} className={`report-row ${finding.severity}`}>
                <span>{finding.clipName ?? 'Runtime'}</span>
                <span>{finding.code}</span>
                <span>{finding.message}</span>
              </div>
            ))
          ) : <p>No runtime draft findings</p>}
        </div>
      </section>
      <section className="report-section">
        <h3>Raw JSON</h3>
        <pre className="report-modal-text raw">{JSON.stringify(draft, null, 2)}</pre>
      </section>
    </div>
  )
}

function DatabaseDraftView({
  database,
  path,
}: {
  database: RuntimeDatabaseDraftResponse
  path: string
}) {
  const [jsonCopyState, setJsonCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [queryCopyState, setQueryCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [selectedClipKey, setSelectedClipKey] = useState('all')
  const [frameFilter, setFrameFilter] = useState('')
  const [selectedSampleKey, setSelectedSampleKey] = useState<string | null>(null)
  const clipLookup = useMemo(() => new Map(database.clips.map((clip) => [runtimeClipKey(clip.clipId, clip.isMirrored), clip])), [database.clips])
  const rawFrameFilter = frameFilter.trim() === '' ? null : Number(frameFilter)
  const parsedFrameFilter = rawFrameFilter === null || !Number.isFinite(rawFrameFilter) ? null : rawFrameFilter
  const filteredSamples = useMemo(() => database.samples.filter((sample) => {
    if (selectedClipKey !== 'all' && runtimeClipKey(sample.clipId, sample.isMirrored) !== selectedClipKey) {
      return false
    }

    return parsedFrameFilter === null || sample.frame === Math.max(Math.round(parsedFrameFilter) - 1, 0)
  }), [database.samples, parsedFrameFilter, selectedClipKey])
  const visibleSamples = filteredSamples.slice(0, 80)
  const selectedSample = filteredSamples.find((sample) => runtimeDatabaseSampleKey(sample) === selectedSampleKey)
    ?? filteredSamples[0]
    ?? database.samples[0]
    ?? null
  const selectedSampleClip = selectedSample ? clipLookup.get(runtimeClipKey(selectedSample.clipId, selectedSample.isMirrored)) : null
  const selectedFeatureEntries = selectedSample ? Object.entries(selectedSample.features) : []

  async function copyDatabaseJson() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(database, null, 2))
      setJsonCopyState('copied')
    } catch {
      setJsonCopyState('failed')
    }
  }

  async function copyQuerySample() {
    if (!selectedSample) {
      return
    }

    const payload = {
      schema: database.schema,
      scale: database.scale,
      sourceClip: selectedSampleClip ? {
        frameCount: selectedSampleClip.frameCount,
        frameRate: selectedSampleClip.frameRate,
        durationSeconds: selectedSampleClip.durationSeconds,
      } : null,
      sample: {
        clipId: selectedSample.clipId,
        clipName: selectedSampleClip?.clipName ?? selectedSample.clipId,
        isMirrored: selectedSample.isMirrored,
        frame: selectedSample.frame,
        seconds: selectedSample.seconds,
        features: selectedSample.features,
      },
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
      setQueryCopyState('copied')
    } catch {
      setQueryCopyState('failed')
    }
  }

  return (
    <div className="report-view">
      <section className="report-section">
        <h3>Summary</h3>
        <dl className="report-summary-grid">
          <dt>Path</dt>
          <dd>{path}</dd>
          <dt>Status</dt>
          <dd>{database.status}</dd>
          <dt>Schema</dt>
          <dd>{`${database.schema.id} v${database.schema.version}`}</dd>
          <dt>Format</dt>
          <dd>{database.schema.format}</dd>
          <dt>Units</dt>
          <dd>{database.schema.units}</dd>
          <dt>Clips</dt>
          <dd>{database.clipCount}</dd>
          <dt>Samples</dt>
          <dd>{database.sampleCount}</dd>
          <dt>Pose values</dt>
          <dd>{database.poseSamples.length}</dd>
          <dt>Features</dt>
          <dd>{database.featureCount}</dd>
          <dt>Scale</dt>
          <dd>{`${formatRuntimeScaleMode(database.scale.mode)}, x${formatNumber(database.scale.normalizationFactor)}`}</dd>
        </dl>
        <button type="button" className="inspector-action" onClick={copyDatabaseJson}>
          <Copy size={14} aria-hidden="true" />
          {jsonCopyState === 'copied' ? 'Copied JSON' : jsonCopyState === 'failed' ? 'Copy Failed' : 'Copy JSON'}
        </button>
      </section>
      {database.sampleCount > 0 && database.poseSamples.length === 0 ? (
        <section className="report-section">
          <h3>Pose Warning</h3>
          <div className="report-table">
            <div className="report-row warning single">
              <span>Database has feature samples but no pose values. Runtime import should treat this draft as incomplete.</span>
            </div>
          </div>
        </section>
      ) : null}
      <section className="report-section">
        <h3>Clips</h3>
        <div className="report-table">
          {database.clips.length ? database.clips.map((clip) => (
            <div key={`${clip.clipId}-${clip.isMirrored ? 'mirror' : 'source'}-database-view`} className={`report-row ${clip.footContacts.length ? 'ok' : 'warning'}`}>
              <span>{clip.clipName}</span>
              <span>{clip.clipRole ?? 'Unassigned'}{clip.isMirrored ? ' mirror' : ''}</span>
              <span>{`${clip.plannedSampleCount} samples, ${formatSourceTimeline(clip)}, ${clip.footContacts.length} contact tracks`}</span>
            </div>
          )) : <p>No database clips planned</p>}
        </div>
      </section>
      <section className="report-section">
        <h3>Samples</h3>
        <div className="database-sample-controls">
          <label className="setting-field">
            Clip
            <select value={selectedClipKey} onChange={(event) => setSelectedClipKey(event.target.value)}>
              <option value="all">All clips</option>
              {database.clips.map((clip) => (
                <option key={runtimeClipKey(clip.clipId, clip.isMirrored)} value={runtimeClipKey(clip.clipId, clip.isMirrored)}>
                  {`${clip.clipName}${clip.isMirrored ? ' Mirror' : ''}`}
                </option>
              ))}
            </select>
          </label>
          <label className="setting-field">
            Frame
            <input
              type="number"
              min={1}
              step={1}
              value={frameFilter}
              onChange={(event) => setFrameFilter(event.target.value)}
              placeholder="Any"
            />
          </label>
          <span className="database-sample-count">{`${filteredSamples.length}/${database.samples.length} samples`}</span>
        </div>
        <div className="report-table">
          {visibleSamples.length ? visibleSamples.map((sample) => {
            const clipKey = runtimeClipKey(sample.clipId, sample.isMirrored)
            const sampleKey = runtimeDatabaseSampleKey(sample)
            const clip = clipLookup.get(clipKey)

            return (
              <button
                key={sampleKey}
                type="button"
                className={`report-row report-row-button ${selectedSample && sampleKey === runtimeDatabaseSampleKey(selectedSample) ? 'active' : ''}`}
                onClick={() => setSelectedSampleKey(sampleKey)}
              >
                <span>{`${clip?.clipName ?? sample.clipId}${sample.isMirrored ? ' Mirror' : ''} F${sample.frame + 1}`}</span>
                <span>{`${formatNumber(sample.seconds)}s`}</span>
                <span>{formatFeaturePreviewValues(sample.features)}</span>
              </button>
            )
          }) : <p>No database samples</p>}
          {filteredSamples.length > visibleSamples.length ? (
            <div className="report-row single">
              <span>{`Showing first ${visibleSamples.length} filtered samples. Narrow the frame or clip filter for more.`}</span>
            </div>
          ) : null}
        </div>
      </section>
      <section className="report-section">
        <h3>Runtime Query Preview</h3>
        {selectedSample ? (
          <>
            <dl className="report-summary-grid">
              <dt>Clip</dt>
              <dd>{`${selectedSampleClip?.clipName ?? selectedSample.clipId}${selectedSample.isMirrored ? ' Mirror' : ''}`}</dd>
              <dt>Frame</dt>
              <dd>{selectedSample.frame + 1}</dd>
              <dt>Time</dt>
              <dd>{`${formatNumber(selectedSample.seconds)}s`}</dd>
              <dt>Source FPS</dt>
              <dd>{selectedSampleClip ? formatSourceTimeline(selectedSampleClip) : 'Unknown'}</dd>
              <dt>Scale</dt>
              <dd>{`${formatRuntimeScaleMode(database.scale.mode)} x${formatNumber(database.scale.normalizationFactor)}`}</dd>
            </dl>
            <button type="button" className="inspector-action" onClick={copyQuerySample}>
              <Copy size={14} aria-hidden="true" />
              {queryCopyState === 'copied' ? 'Copied Query Sample' : queryCopyState === 'failed' ? 'Copy Failed' : 'Copy Query Sample'}
            </button>
            <div className="report-table feature-vector-table">
              {selectedFeatureEntries.map(([name, value]) => (
                <div key={name} className="report-row">
                  <span>{name}</span>
                  <span>{value === null ? 'null' : formatNumber(value)}</span>
                  <span>{value === null ? 'missing' : 'ready'}</span>
                </div>
              ))}
            </div>
          </>
        ) : <p>No sample selected</p>}
      </section>
      <section className="report-section">
        <h3>Findings</h3>
        <div className="report-table">
          {database.findings.length ? database.findings.map((finding, index) => (
            <div key={`${finding.severity}-${finding.code}-${index}`} className={`report-row ${finding.severity}`}>
              <span>{finding.clipName ?? 'Database'}</span>
              <span>{finding.code}</span>
              <span>{finding.message}</span>
            </div>
          )) : <p>No database findings</p>}
        </div>
      </section>
      <section className="report-section">
        <h3>Raw JSON</h3>
        <pre className="report-modal-text raw">{JSON.stringify(database, null, 2)}</pre>
      </section>
    </div>
  )
}

function TimelinePanel({
  clip,
  title,
  frame,
  frameCount,
  frameRate,
  durationSeconds,
  hasMetadata,
  isEnabled,
  isPlaying,
  footContacts,
  markerFrames = [],
  activeMarkerFrame,
  ghostingMode,
  onGhostingModeChange,
  showQueryVectors,
  onShowQueryVectorsChange,
  onTogglePlay,
  onStep,
  onSeek,
  loopStartFrame,
  loopEndFrame,
  onSetLoopStart,
  onSetLoopEnd,
  showLoopControls = true,
}: {
  clip: ClipResponse | null
  title: string
  frame: number
  frameCount: number
  frameRate: number
  durationSeconds: number | null
  hasMetadata: boolean
  isEnabled: boolean
  isPlaying: boolean
  footContacts: ClipResponse['footContacts']
  markerFrames?: number[]
  activeMarkerFrame?: number | null
  ghostingMode?: SamplingGhostingMode
  onGhostingModeChange?: (mode: SamplingGhostingMode) => void
  showQueryVectors?: boolean
  onShowQueryVectorsChange?: (value: boolean) => void
  onTogglePlay: () => void
  onStep: (delta: number) => void
  onSeek: (frame: number) => void
  loopStartFrame: number
  loopEndFrame: number
  onSetLoopStart: (frame: number) => void
  onSetLoopEnd: (frame: number) => void
  showLoopControls?: boolean
}) {
  const rulerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const maxFrame = Math.max(frameCount - 1, 0)
  const isClipTimeline = Boolean(clip)
  const displayFrame = isClipTimeline ? frame + 1 : frame
  const displayMaxFrame = isClipTimeline ? frameCount : maxFrame
  const progress = `${maxFrame > 0 ? (frame / maxFrame) * 100 : 0}%`
  const loopStartProgress = `${maxFrame > 0 ? (loopStartFrame / maxFrame) * 100 : 0}%`
  const loopEndProgress = `${maxFrame > 0 ? (loopEndFrame / maxFrame) * 100 : 0}%`
  const displayDurationSeconds = durationSeconds && durationSeconds > 0
    ? durationSeconds
    : frameCount / Math.max(frameRate, 1)
  const currentSeconds = maxFrame > 0
    ? Math.min(Math.max(frame / maxFrame, 0), 1) * displayDurationSeconds
    : 0
  const metadataSuffix = hasMetadata ? '' : ' estimated'
  const frameTickStep = frameCount <= 80 ? 1 : Math.ceil(frameCount / 80)
  const frameLabelStep = frameCount <= 40 ? 10 : Math.max(10, Math.ceil(frameCount / 80) * 10)
  const frameTicks = Array.from({ length: maxFrame + 1 }, (_, index) => index)
    .filter((index) => index === 0 || index === maxFrame || index % frameTickStep === 0)
    .map((index) => ({
      frame: index,
      label: index === 0 || index === maxFrame || index % frameLabelStep === 0 ? `${isClipTimeline ? index + 1 : index}` : null,
      left: `${maxFrame > 0 ? (index / maxFrame) * 100 : 0}%`,
    }))
  const timelineMarkers = markerFrames
    .filter((markerFrame) => markerFrame >= 0 && markerFrame <= maxFrame)
    .map((markerFrame) => ({
      frame: markerFrame,
      left: `${maxFrame > 0 ? (markerFrame / maxFrame) * 100 : 0}%`,
    }))
  const contactRanges = footContacts?.tracks.flatMap((track) =>
    track.ranges.flatMap((range) => {
      const ranges = [{
        key: `${track.foot}-${range.startFrame}-${range.endFrame}`,
        foot: track.foot,
        left: `${maxFrame > 0 ? (Math.min(Math.max(range.startFrame, 0), maxFrame) / maxFrame) * 100 : 0}%`,
        right: `calc(100% - ${maxFrame > 0 ? (Math.min(Math.max(range.endFrame, 0), maxFrame) / maxFrame) * 100 : 0}%)`,
      }]

      if (maxFrame > 0 && range.startFrame === 0) {
        ranges.push({
          key: `${track.foot}-${range.startFrame}-${range.endFrame}-loop-end`,
          foot: track.foot,
          left: '100%',
          right: '0%',
        })
      }

      return ranges
    }),
  ) ?? []

  const seekFromClientX = (clientX: number) => {
    if (!isEnabled) {
      return
    }

    const bounds = rulerRef.current?.getBoundingClientRect()
    if (!bounds) {
      return
    }

    const ratio = (clientX - bounds.left) / Math.max(bounds.width, 1)
    onSeek(Math.round(Math.min(Math.max(ratio, 0), 1) * maxFrame))
  }

  const seekFromPointer = (event: React.PointerEvent<HTMLElement>) => {
    seekFromClientX(event.clientX)
  }

  return (
    <div className={`timeline-strip ${showLoopControls ? '' : 'sampling-timeline'}`}>
      <div className="timeline-controls" aria-label="Timeline controls">
        <button type="button" disabled={!isEnabled} onClick={() => onSeek(0)} title="First frame" aria-label="First frame">
          <StepBack size={14} aria-hidden="true" />
        </button>
        <button type="button" disabled={!isEnabled} onClick={() => onStep(-1)} title="Previous frame" aria-label="Previous frame">
          <StepBack size={14} aria-hidden="true" />
        </button>
        <button type="button" disabled={!isEnabled} onClick={onTogglePlay} title={isPlaying ? 'Pause' : 'Play'} aria-label={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
        </button>
        <button type="button" disabled={!isEnabled} onClick={() => onStep(1)} title="Next frame" aria-label="Next frame">
          <StepForward size={14} aria-hidden="true" />
        </button>
        <button type="button" disabled={!isEnabled} onClick={() => onSeek(maxFrame)} title="Last frame" aria-label="Last frame">
          <StepForward size={14} aria-hidden="true" />
        </button>
      </div>
      {showLoopControls ? (
        <div className="timeline-meta">
          <span className="timeline-clip-name">{title}</span>
          <span>{isEnabled ? `${formatTimelineTime(currentSeconds)} / ${formatTimelineTime(displayDurationSeconds)}${metadataSuffix}` : '--:--'}</span>
        </div>
      ) : null}
      <div
        ref={rulerRef}
        className={`timeline-ruler ${isDragging ? 'dragging' : ''}`}
        role="slider"
        aria-label="Timeline scrubber"
        aria-valuemin={isEnabled ? (isClipTimeline ? 1 : 0) : 0}
        aria-valuemax={isEnabled ? displayMaxFrame : 0}
        aria-valuenow={isEnabled ? displayFrame : 0}
        aria-valuetext={isEnabled ? `Frame ${displayFrame} of ${displayMaxFrame}` : undefined}
        tabIndex={isEnabled ? 0 : -1}
        onPointerDown={(event) => {
          if (!isEnabled) {
            return
          }

          event.currentTarget.setPointerCapture(event.pointerId)
          setIsDragging(true)
          seekFromPointer(event)
        }}
        onPointerMove={(event) => {
          if (isDragging) {
            seekFromPointer(event)
          }
        }}
        onPointerUp={(event) => {
          if (isDragging) {
            seekFromPointer(event)
          }
          setIsDragging(false)
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
        onPointerCancel={(event) => {
          setIsDragging(false)
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
          }
        }}
        onKeyDown={(event) => {
          if (!isEnabled) {
            return
          }

          if (event.key === 'ArrowLeft') {
            onStep(event.shiftKey ? -10 : -1)
            event.preventDefault()
          }
          if (event.key === 'ArrowRight') {
            onStep(event.shiftKey ? 10 : 1)
            event.preventDefault()
          }
          if (event.key === 'Home') {
            onSeek(0)
            event.preventDefault()
          }
          if (event.key === 'End') {
            onSeek(maxFrame)
            event.preventDefault()
          }
        }}
      >
        {frameTicks.map((tick) => (
          <span
            key={tick.frame}
            className={`timeline-frame-tick ${tick.label ? 'major' : ''} ${tick.frame === frame ? 'current' : ''}`}
            style={{ left: tick.left }}
            aria-hidden="true"
          >
            {tick.label ? <span>{tick.label}</span> : null}
          </span>
        ))}
        {showLoopControls ? (
          <>
            <div className="timeline-loop-range" style={{ left: loopStartProgress, right: `calc(100% - ${loopEndProgress})` }} />
            <div className="timeline-loop-marker start" style={{ left: loopStartProgress }} />
            <div className="timeline-loop-marker end" style={{ left: loopEndProgress }} />
          </>
        ) : null}
        {timelineMarkers.map((marker) => (
          <div
            key={`marker-${marker.frame}`}
            className={`timeline-sampling-marker ${activeMarkerFrame === marker.frame ? 'active' : ''}`}
            style={{ left: marker.left }}
            aria-hidden="true"
          />
        ))}
        {contactRanges.map((range) => (
          <div
            key={range.key}
            className={`timeline-contact-range ${range.foot}`}
            style={{ left: range.left, right: range.right }}
            aria-hidden="true"
          />
        ))}
        <div className="timeline-fill" style={{ width: progress }} />
        <div
          className="timeline-playhead-hit"
          style={{ left: progress }}
          onPointerDown={(event) => {
            if (!isEnabled) {
              return
            }

            event.stopPropagation()
            event.currentTarget.setPointerCapture(event.pointerId)
            setIsDragging(true)
            seekFromPointer(event)
          }}
          onPointerMove={(event) => {
            if (isDragging) {
              seekFromPointer(event)
            }
          }}
          onPointerUp={(event) => {
            if (isDragging) {
              seekFromPointer(event)
            }
            setIsDragging(false)
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
          }}
          onPointerCancel={(event) => {
            setIsDragging(false)
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
          }}
        />
        <div className="timeline-playhead" style={{ left: progress }}>
          <span className="timeline-playhead-handle" />
          <span className="timeline-playhead-frame">{displayFrame}</span>
        </div>
      </div>
      {showLoopControls ? (
        <div className="timeline-readout" aria-label="Timeline readout">
          <label className="frame-input-label">
            F
            <input
              type="number"
              min={1}
              max={frameCount}
              disabled={!isEnabled}
              value={isEnabled ? displayFrame : ''}
              onChange={(event) => {
                const nextFrame = Number.parseInt(event.target.value, 10)
                if (Number.isFinite(nextFrame)) {
                  onSeek(isClipTimeline ? nextFrame - 1 : nextFrame)
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur()
                }
              }}
            />
            /{isEnabled ? displayMaxFrame : '--'}
          </label>
          <span className="timeline-fps-label">{isEnabled ? `@${frameRate.toFixed(0)} fps` : '-- fps'}</span>
          <span>{isEnabled ? `L ${loopStartFrame + 1}-${loopEndFrame + 1}` : 'L --'}</span>
          <span className="timeline-range-actions">
            <button type="button" disabled={!isEnabled} onClick={() => onSetLoopStart(frame)}>In</button>
            <button type="button" disabled={!isEnabled} onClick={() => onSetLoopEnd(frame)}>Out</button>
          </span>
        </div>
      ) : null}
      {!showLoopControls ? (
        <div className="timeline-sampling-readout-row" aria-label="Sampling timeline controls">
          <span className="timeline-time-label">{isEnabled ? `${formatTimelineTime(currentSeconds)} / ${formatTimelineTime(displayDurationSeconds)}` : '--:--'}</span>
          <label className="frame-input-label">
            F
            <input
              type="number"
              min={1}
              max={frameCount}
              disabled={!isEnabled}
              value={isEnabled ? displayFrame : ''}
              onChange={(event) => {
                const nextFrame = Number.parseInt(event.target.value, 10)
                if (Number.isFinite(nextFrame)) {
                  onSeek(nextFrame)
                }
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur()
                }
              }}
            />
            /{isEnabled ? displayMaxFrame : '--'}
          </label>
          <span className="timeline-fps-label">{isEnabled ? `@${frameRate.toFixed(0)} fps` : '-- fps'}</span>
          {onGhostingModeChange ? (
            <label className="timeline-ghosting-label">
              Ghost
              <select
                value={ghostingMode ?? 'none'}
                disabled={!isEnabled}
                onChange={(event) => onGhostingModeChange(event.target.value as SamplingGhostingMode)}
              >
                <option value="none">none</option>
                <option value="every10">every 10</option>
                <option value="every5">every 5</option>
                <option value="every2">every 2</option>
                <option value="every1">every 1</option>
                <option value="window5">-5..+5</option>
              </select>
            </label>
          ) : null}
          {onShowQueryVectorsChange ? (
            <label className="timeline-toggle-label">
              <input
                type="checkbox"
                checked={Boolean(showQueryVectors)}
                disabled={!isEnabled}
                onChange={(event) => onShowQueryVectorsChange(event.target.checked)}
              />
              Query vectors
            </label>
          ) : null}
          <span className="timeline-clip-name">{title}</span>
        </div>
      ) : null}
    </div>
  )
}

function formatTimelineTime(seconds: number) {
  if (!Number.isFinite(seconds)) {
    return '0.000s'
  }

  return `${Math.max(seconds, 0).toFixed(3)}s`
}

function ClipInspector({
  character,
  clip,
  animationPreviewState,
  clipMotionMode,
  isBusy,
  onUpdateSettings,
  onRefreshFootContacts,
  onReplaceSource,
}: {
  character: CharacterResponse
  clip: ClipResponse
  animationPreviewState: string
  clipMotionMode: ClipMotionMode
  isBusy: boolean
  onUpdateSettings: (settings: Partial<Pick<ClipResponse, 'includeInBuild' | 'mirrorInBuild' | 'clipRole' | 'contactDetectionPreset' | 'tags'>>) => void
  onRefreshFootContacts: () => void
  onReplaceSource: () => void
}) {
  const [customTag, setCustomTag] = useState('')
  const activeTags = new Set(clip.tags)
  const hasLegacyActionTags = clip.tags.some((tag) => legacyActionTags.includes(tag))
  const toggleTag = (tag: string) => {
    const nextTags = activeTags.has(tag)
      ? clip.tags.filter((item) => item !== tag)
      : [...clip.tags, tag]
    onUpdateSettings({ tags: nextTags })
  }

  const addCustomTag = () => {
    const normalized = customTag.trim().toLowerCase().replace(/\s+/g, '_').replace(/-+/g, '_')
    if (!normalized || activeTags.has(normalized)) {
      setCustomTag('')
      return
    }

    onUpdateSettings({ tags: [...clip.tags, normalized] })
    setCustomTag('')
  }

  const clearLegacyActionTags = () => {
    onUpdateSettings({ tags: clip.tags.filter((tag) => !legacyActionTags.includes(tag)) })
  }

  return (
    <div className="inspector-content">
      <section className="inspector-section">
        <h2>{clip.name}</h2>
        <dl>
          <dt>ID</dt>
          <dd>{clip.id}</dd>
          <dt>Character</dt>
          <dd>{character.name}</dd>
          <dt>Manifest</dt>
          <dd>{clip.manifestPath}</dd>
          <dt>Source</dt>
          <dd>{clip.sourceFileName}</dd>
          <dt>Kind</dt>
          <dd>{clip.sourceKind.toUpperCase()}</dd>
          <dt>Build</dt>
          <dd>{clip.includeInBuild ? `Included${clip.mirrorInBuild ? ' + mirrored copy' : ''}` : 'Excluded'}</dd>
          <dt>Role</dt>
          <dd>{clip.clipRole ?? 'Unassigned'}</dd>
          <dt>Tags</dt>
          <dd>{clip.tags.length ? clip.tags.join(', ') : 'None'}</dd>
          <dt>Timeline</dt>
          <dd>{clip.frameCount && clip.frameRate && clip.durationSeconds ? `${clip.frameCount} frames, ${clip.frameRate.toFixed(2)} fps, ${clip.durationSeconds.toFixed(2)}s` : 'Not parsed yet'}</dd>
          <dt>Preview</dt>
          <dd>{clip.previewUrl ? 'Animation cache ready' : 'No animation cache'}</dd>
          <dt>Retarget</dt>
          <dd>{formatAnimationPreviewState(animationPreviewState)}</dd>
          <dt>Motion</dt>
          <dd>{clipMotionMode === 'rootMotion' ? 'Root motion' : 'In-place'}</dd>
          <dt>Contacts</dt>
          <dd>{formatContactDetectionPreset(clip.contactDetectionPreset)}</dd>
        </dl>
      </section>
      <section className="inspector-section">
        <h3>Clip Settings</h3>
        <button
          type="button"
          className="inspector-action"
          disabled={isBusy}
          onClick={onReplaceSource}
        >
          <RefreshCw size={14} aria-hidden="true" />
          Replace Source
        </button>
        <label className="setting-row">
          <span>Include in build</span>
          <input
            type="checkbox"
            checked={clip.includeInBuild}
            disabled={isBusy}
            onChange={(event) => onUpdateSettings({ includeInBuild: event.target.checked })}
          />
        </label>
        <label className="setting-row">
          <span>Add mirrored copy</span>
          <input
            type="checkbox"
            checked={clip.mirrorInBuild}
            disabled={isBusy || !clip.includeInBuild}
            onChange={(event) => onUpdateSettings({ mirrorInBuild: event.target.checked })}
          />
        </label>
        <label className="setting-field">
          <span>Role</span>
          <select
            value={clip.clipRole ?? ''}
            disabled={isBusy}
            onChange={(event) => onUpdateSettings({ clipRole: event.target.value || null })}
          >
            <option value="">Unassigned</option>
            {clipRoles.map((role) => (
              <option key={role.value} value={role.value}>{`${role.value} - ${role.description}`}</option>
            ))}
          </select>
        </label>
        <label className="setting-field">
          <span>Contact preset</span>
          <select
            value={clip.contactDetectionPreset}
            disabled={isBusy}
            onChange={(event) => onUpdateSettings({ contactDetectionPreset: event.target.value as ContactDetectionPreset })}
          >
            {contactDetectionPresets.map((preset) => (
              <option key={preset.value} value={preset.value}>{preset.label}</option>
            ))}
          </select>
        </label>
        <div className="tag-grid" aria-label="Clip tags">
          {defaultClipTags.map((tag) => (
            <label key={tag} className={`tag-toggle ${activeTags.has(tag) ? 'active' : ''}`}>
              <input
                type="checkbox"
                checked={activeTags.has(tag)}
                disabled={isBusy}
                onChange={() => toggleTag(tag)}
              />
              <span>{tag}</span>
            </label>
          ))}
        </div>
        <div className="custom-tag-row">
          <input
            type="text"
            value={customTag}
            disabled={isBusy}
            placeholder="custom_tag"
            onChange={(event) => setCustomTag(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addCustomTag()
              }
            }}
          />
          <button type="button" disabled={isBusy || !customTag.trim()} onClick={addCustomTag}>Add</button>
        </div>
        {clip.tags.some((tag) => !defaultClipTags.includes(tag)) ? (
          <div className="custom-tag-list">
            {clip.tags.filter((tag) => !defaultClipTags.includes(tag)).map((tag) => (
              <button
                key={tag}
                type="button"
                disabled={isBusy}
                onClick={() => onUpdateSettings({ tags: clip.tags.filter((item) => item !== tag) })}
              >
                {tag}
              </button>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          className="inspector-action"
          disabled={isBusy || !hasLegacyActionTags}
          onClick={clearLegacyActionTags}
        >
          Clear action tags
        </button>
      </section>
      <section className="inspector-section">
        <h3>Validation</h3>
        {clip.validation ? (
          <div className={`validation-summary ${clip.validation.canCompile ? 'ok' : 'blocked'}`}>
            {clip.validation.canCompile ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertCircle size={16} aria-hidden="true" />}
            <span>{clip.validation.canCompile ? 'Ready for preview' : 'Blocked'}</span>
          </div>
        ) : (
          <p className="muted">Not checked</p>
        )}
        <div className="finding-list">
          {clip.validation?.findings.map((finding) => (
            <div key={`${finding.severity}-${finding.code}`} className={`finding ${finding.severity}`}>
              <strong>{finding.code}</strong>
              <span>{finding.message}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="inspector-section">
        <h3>Skeleton Match</h3>
        {clip.skeleton ? (
          <>
            <dl>
              <dt>Coverage</dt>
              <dd>{`${clip.skeleton.matchedBoneCount}/${clip.skeleton.visualBoneCount} (${Math.round(clip.skeleton.coverage * 100)}%)`}</dd>
              <dt>Clip bones</dt>
              <dd>{clip.skeleton.clipBoneCount}</dd>
              <dt>Missing</dt>
              <dd>{clip.skeleton.missingCriticalBones.length ? clip.skeleton.missingCriticalBones.join(', ') : 'No critical gaps'}</dd>
              <dt>Matched</dt>
              <dd>{formatBoneList(clip.skeleton.matchedBones)}</dd>
              <dt>Visual only</dt>
              <dd>{formatBoneList(clip.skeleton.visualOnlyBones)}</dd>
              <dt>Clip only</dt>
              <dd>{formatBoneList(clip.skeleton.clipOnlyBones)}</dd>
            </dl>
            <div className="coverage-track" aria-label="Skeleton coverage">
              <span style={{ width: `${Math.min(Math.max(clip.skeleton.coverage, 0), 1) * 100}%` }} />
            </div>
          </>
        ) : (
          <p className="muted">Skeleton details unavailable</p>
        )}
      </section>
      <section className="inspector-section">
        <h3>Root Motion</h3>
        {clip.rootMotion ? (
          <dl>
            <dt>Source</dt>
            <dd>{clip.rootMotion.sourceName}</dd>
            <dt>Keys</dt>
            <dd>{clip.rootMotion.keyCount}</dd>
            <dt>Delta</dt>
            <dd>{formatRootMotionDelta(clip.rootMotion)}</dd>
            <dt>XZ</dt>
            <dd>{`${formatNumber(clip.rootMotion.horizontalDistance)} units, ${formatNumber(clip.rootMotion.averageHorizontalSpeed)} u/s`}</dd>
          </dl>
        ) : (
          <p className="muted">No root motion diagnostics</p>
        )}
      </section>
      <section className="inspector-section">
        <h3>Foot Contacts</h3>
        <button
          type="button"
          className="inspector-action"
          disabled={isBusy || !clip.previewUrl}
          onClick={onRefreshFootContacts}
        >
          {isBusy ? <Loader2 size={14} aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
          Refresh
        </button>
        {clip.footContacts ? (
          <>
            <dl>
              <dt>Threshold</dt>
              <dd>{`${formatNumber(clip.footContacts.velocityThreshold)} u/s`}</dd>
              <dt>Ranges</dt>
              <dd>{clip.footContacts.tracks.reduce((total, track) => total + track.ranges.length, 0)}</dd>
            </dl>
            <div className="contact-track-list">
              {clip.footContacts.tracks.map((track) => (
                <div key={`${track.foot}-${track.sourceName}`} className={`contact-track ${track.foot}`}>
                  <strong>{track.foot === 'left' ? 'Left' : 'Right'}: {track.sourceName}</strong>
                  <span>{track.ranges.length ? track.ranges.map((range) => `F ${range.startFrame + 1}-${range.endFrame + 1}`).join(', ') : 'No ranges'}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="muted">No foot contact diagnostics</p>
        )}
      </section>
      <ImportLogPanel entries={clip.importLog} />
    </div>
  )
}

function formatAnimationPreviewState(state: string) {
  if (state.startsWith('applied:')) {
    return `${state.slice('applied:'.length)} tracks applied`
  }

  if (state === 'loading') {
    return 'Loading animation'
  }

  if (state === 'unmatched') {
    return 'No matching tracks'
  }

  if (state === 'failed') {
    return 'Preview failed'
  }

  return 'Not active'
}

function formatContactDetectionPreset(preset: ContactDetectionPreset) {
  return contactDetectionPresets.find((item) => item.value === preset)?.label ?? 'Auto'
}

function formatRootMotionDelta(rootMotion: NonNullable<ClipResponse['rootMotion']>) {
  return `X ${formatNumber(rootMotion.displacementX)}, Y ${formatNumber(rootMotion.displacementY)}, Z ${formatNumber(rootMotion.displacementZ)}`
}

function formatNumber(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : '--'
}

function formatBoneList(values: string[]) {
  return values.length ? values.join(', ') : '--'
}

function formatFeaturePreviewValues(values: Record<string, number | null>) {
  const visibleEntries = Object.entries(values)
    .filter(([name, value]) => value !== null && (
      name === 'hips_velocity' ||
      name.endsWith('_foot_velocity') ||
      name.startsWith('trajectory_position_') ||
      name.startsWith('trajectory_direction_')
    ))
    .slice(0, 8)

  return visibleEntries.length
    ? visibleEntries.map(([name, value]) => `${name} ${formatNumber(value ?? Number.NaN)}`).join(', ')
    : '--'
}

function runtimeClipKey(clipId: string, isMirrored: boolean) {
  return `${clipId}:${isMirrored ? 'mirror' : 'source'}`
}

function runtimeDatabaseSampleKey(sample: { clipId: string; isMirrored: boolean; frame: number }) {
  return `${runtimeClipKey(sample.clipId, sample.isMirrored)}:${sample.frame}`
}

function samplingMatcherPreviewKey(match: SamplingMatcherPreviewMatch) {
  return `${match.pointFrame}:${runtimeDatabaseSampleKey(match)}`
}

function formatPoseBonePreview(bones: Array<{ boneName: string; translation: number[]; rotation: number[] }>) {
  const bone = bones[0]
  if (!bone) {
    return '--'
  }

  return `${bone.boneName} T ${formatVector(bone.translation)} R ${formatVector(bone.rotation)}`
}

function formatVector(values: number[]) {
  return `[${values.slice(0, 4).map((value) => formatNumber(value)).join(', ')}]`
}

function updateVectorValue(values: number[], index: number, value: number) {
  const next = [...values]
  while (next.length < 3) {
    next.push(0)
  }
  next[index] = Number.isFinite(value) ? value : 0
  return next
}

function deriveSamplingVelocityFromTrajectory(trajectory: SamplingQueryResponse['trajectory']) {
  return sampleSamplingVelocityAtFrame(trajectory, 0)
}

function sortSamplingTrajectoryByFrame(trajectory: SamplingQueryResponse['trajectory']) {
  return [...trajectory].sort((left, right) => left.frameOffset - right.frameOffset)
}

function sampleSamplingVelocityAtFrame(trajectory: SamplingQueryResponse['trajectory'], frame: number) {
  const keyframes = buildSamplingVelocityKeyframes(trajectory)
  if (!keyframes.length) {
    return [0, 0, 0]
  }

  if (frame <= keyframes[0].frameOffset) {
    return roundVelocity(keyframes[0].velocity)
  }

  for (let index = 1; index < keyframes.length; index += 1) {
    const previous = keyframes[index - 1]
    const next = keyframes[index]
    if (frame <= next.frameOffset) {
      const ratio = (frame - previous.frameOffset) / Math.max(next.frameOffset - previous.frameOffset, 1)
      return roundVelocity([
        lerp(previous.velocity[0] ?? 0, next.velocity[0] ?? 0, ratio),
        0,
        lerp(previous.velocity[2] ?? 0, next.velocity[2] ?? 0, ratio),
      ])
    }
  }

  return roundVelocity(keyframes.at(-1)?.velocity ?? [0, 0, 0])
}

function samplingSpeedAtFrame(trajectory: SamplingQueryResponse['trajectory'], frame: number) {
  const velocity = sampleSamplingVelocityAtFrame(trajectory, frame)
  return Math.hypot(velocity[0] ?? 0, velocity[2] ?? 0)
}

function buildSamplingVelocityKeyframes(trajectory: SamplingQueryResponse['trajectory']) {
  const points = [
    { frameOffset: 0, position: [0, 0, 0] },
    ...sortSamplingTrajectoryByFrame(trajectory),
  ]

  return points.map((point, index) => {
    const previous = points[index - 1]
    const next = points[index + 1]
    if (previous && next) {
      return {
        frameOffset: point.frameOffset,
        velocity: calculateSamplingPointVelocity(previous, next),
      }
    }

    if (next) {
      return {
        frameOffset: point.frameOffset,
        velocity: calculateSamplingPointVelocity(point, next),
      }
    }

    if (previous) {
      return {
        frameOffset: point.frameOffset,
        velocity: calculateSamplingPointVelocity(previous, point),
      }
    }

    return {
      frameOffset: point.frameOffset,
      velocity: [0, 0, 0],
    }
  })
}

function calculateSamplingPointVelocity(
  fromPoint: { frameOffset: number; position: number[] },
  toPoint: { frameOffset: number; position: number[] },
) {
  const seconds = Math.max(toPoint.frameOffset - fromPoint.frameOffset, 1) / fallbackFrameRate
  return [
    ((toPoint.position[0] ?? 0) - (fromPoint.position[0] ?? 0)) / seconds,
    0,
    ((toPoint.position[2] ?? 0) - (fromPoint.position[2] ?? 0)) / seconds,
  ]
}

function roundVelocity(velocity: number[]) {
  return [
    Number((velocity[0] ?? 0).toFixed(2)),
    0,
    Number((velocity[2] ?? 0).toFixed(2)),
  ]
}

function normalizeSamplingDraftVelocity(query: SamplingQueryResponse): SamplingQueryResponse {
  return {
    ...query,
    velocity: deriveSamplingVelocityFromTrajectory(query.trajectory),
  }
}

function extrapolateTrajectoryPoint(
  sourcePoint: SamplingQueryResponse['trajectory'][number],
  previousPoint: SamplingQueryResponse['trajectory'][number] | null,
  facing: number[],
) {
  if (previousPoint) {
    const frameDelta = Math.max(sourcePoint.frameOffset - previousPoint.frameOffset, 1)
    return {
      frameOffset: sourcePoint.frameOffset + frameDelta,
      position: [
        Number(((sourcePoint.position[0] ?? 0) + ((sourcePoint.position[0] ?? 0) - (previousPoint.position[0] ?? 0))).toFixed(2)),
        0,
        Number(((sourcePoint.position[2] ?? 0) + ((sourcePoint.position[2] ?? 0) - (previousPoint.position[2] ?? 0))).toFixed(2)),
      ],
      direction: sourcePoint.direction,
    }
  }

  const frameDelta = 20
  const seconds = frameDelta / fallbackFrameRate
  return {
    frameOffset: sourcePoint.frameOffset + frameDelta,
    position: [
      Number(((sourcePoint.position[0] ?? 0) + (facing[0] ?? 0) * 100 * seconds).toFixed(2)),
      0,
      Number(((sourcePoint.position[2] ?? 0) + (facing[2] ?? 1) * 100 * seconds).toFixed(2)),
    ],
    direction: sourcePoint.direction,
  }
}

function buildSamplingGhostPosePreviews(
  poseSamples: RuntimePoseSampleResponse[],
  match: SamplingMatcherPreviewMatch,
  query: SamplingQueryResponse,
  previewFrame: number,
  ghostingMode: SamplingGhostingMode,
): SamplingGhostPosePreview[] {
  const matchPoseSamples = poseSamples.filter((sample) =>
    sample.clipId === match.clipId &&
    sample.isMirrored === match.isMirrored)
  const maxPreviewFrame = getSamplingPreviewFrameCount(query) - 1
  const trailFrames = buildSamplingGhostTrailFrames(previewFrame, maxPreviewFrame, ghostingMode)
  const current = buildSamplingGhostPosePreview(matchPoseSamples, match, query, previewFrame, false)
  const trail = trailFrames
    .filter((frame) => frame !== previewFrame)
    .map((frame) => buildSamplingGhostPosePreview(matchPoseSamples, match, query, frame, true))
    .filter((preview) => preview !== null)

  return current ? [...trail, current] : trail
}

function buildSamplingGhostPosePreview(
  samples: RuntimePoseSampleResponse[],
  match: SamplingMatcherPreviewMatch,
  query: SamplingQueryResponse,
  previewFrame: number,
  isTrail: boolean,
): SamplingGhostPosePreview | null {
  const pose = findClosestPoseSample(samples, wrapPosePreviewFrame(samples, match.frame + previewFrame))
  if (!pose) {
    return null
  }

  const placement = getSamplingPreviewPlacement(query, previewFrame)
  return {
    pose,
    anchor: placement.anchor,
    heading: placement.heading,
    alpha: isTrail ? 0.18 : 0.92,
    scale: isTrail ? 0.58 : 1,
  }
}

function buildSamplingGhostTrailFrames(currentFrame: number, maxFrame: number, mode: SamplingGhostingMode) {
  if (mode === 'none') {
    return []
  }

  if (mode === 'window5') {
    return Array.from({ length: 11 }, (_, index) => currentFrame - 5 + index)
      .filter((frame) => frame >= 0 && frame <= maxFrame)
  }

  const step = mode === 'every10'
    ? 10
    : mode === 'every5'
      ? 5
      : mode === 'every2'
        ? 2
        : 1
  return Array.from({ length: Math.floor(maxFrame / step) + 1 }, (_, index) => index * step)
}

function wrapPosePreviewFrame(samples: RuntimePoseSampleResponse[], targetFrame: number) {
  const maxFrame = samples.reduce((currentMax, sample) => Math.max(currentMax, sample.frame), 0)
  if (maxFrame <= 0) {
    return targetFrame
  }

  const frameCount = maxFrame + 1
  return ((targetFrame % frameCount) + frameCount) % frameCount
}

function findClosestPoseSample(samples: RuntimePoseSampleResponse[], targetFrame: number) {
  return samples.reduce<RuntimePoseSampleResponse | null>((best, sample) => {
    if (!best) {
      return sample
    }

    return Math.abs(sample.frame - targetFrame) < Math.abs(best.frame - targetFrame) ? sample : best
  }, null)
}

function getSamplingPointHeading(points: SamplingQueryResponse['trajectory'], index: number, fallback: number[]) {
  const point = points[index]
  const nextPoint = points[index + 1]
  const previousPoint = points[index - 1]
  if (point && nextPoint) {
    return [
      (nextPoint.position[0] ?? 0) - (point.position[0] ?? 0),
      0,
      (nextPoint.position[2] ?? 0) - (point.position[2] ?? 0),
    ]
  }

  if (point && previousPoint) {
    return [
      (point.position[0] ?? 0) - (previousPoint.position[0] ?? 0),
      0,
      (point.position[2] ?? 0) - (previousPoint.position[2] ?? 0),
    ]
  }

  return point?.position ?? fallback
}

function getSamplingPreviewFrameCount(query: SamplingQueryResponse) {
  const maxFrame = query.trajectory.reduce((currentMax, point) => Math.max(currentMax, point.frameOffset), 0)
  return Math.max(maxFrame + 1, 1)
}

function getSamplingPreviewPlacement(query: SamplingQueryResponse, frame: number) {
  const points = [
    { frameOffset: 0, position: [0, 0, 0], direction: query.facing },
    ...[...query.trajectory].sort((left, right) => left.frameOffset - right.frameOffset),
  ]
  const clampedFrame = Math.max(frame, 0)
  const nextIndex = points.findIndex((point) => point.frameOffset >= clampedFrame)
  const nextPoint = nextIndex >= 0 ? points[nextIndex] : points.at(-1)
  const previousPoint = nextIndex > 0
    ? points[nextIndex - 1]
    : points[0]

  if (!nextPoint || !previousPoint || nextPoint.frameOffset === previousPoint.frameOffset) {
    return {
      anchor: nextPoint?.position ?? [0, 0, 0],
      heading: getSamplingPointHeading(points, Math.max(nextIndex, 0), query.facing),
    }
  }

  const segmentRatio = Math.min(Math.max((clampedFrame - previousPoint.frameOffset) / (nextPoint.frameOffset - previousPoint.frameOffset), 0), 1)
  return {
    anchor: [
      lerp(previousPoint.position[0] ?? 0, nextPoint.position[0] ?? 0, segmentRatio),
      0,
      lerp(previousPoint.position[2] ?? 0, nextPoint.position[2] ?? 0, segmentRatio),
    ],
    heading: [
      (nextPoint.position[0] ?? 0) - (previousPoint.position[0] ?? 0),
      0,
      (nextPoint.position[2] ?? 0) - (previousPoint.position[2] ?? 0),
    ],
  }
}

function lerp(start: number, end: number, ratio: number) {
  return Number((start + (end - start) * ratio).toFixed(2))
}

function vectorToYawDegrees(values: number[]) {
  const x = values[0] ?? 0
  const z = values[2] ?? 1
  const degrees = Math.atan2(x, z) * 180 / Math.PI
  return Number.isFinite(degrees) ? degrees : 0
}

function buildSamplingMatcherPreview(query: SamplingQueryResponse, database: RuntimeDatabaseDraftResponse): SamplingMatcherPreviewMatch[] {
  const clipLookup = new Map(database.clips.map((clip) => [runtimeClipKey(clip.clipId, clip.isMirrored), clip]))
  const trajectory = sortSamplingTrajectoryByFrame(query.trajectory)
  return trajectory
    .map((point, pointIndex) => {
      const queryFeatures = buildSamplingPointQueryFeatureValues(query, point, database.scale.normalizationFactor)
      return database.samples
        .map((sample) => {
          const clip = clipLookup.get(runtimeClipKey(sample.clipId, sample.isMirrored))
          if (query.roleFilter && clip?.clipRole !== query.roleFilter) {
            return null
          }

          let score = 0
          let matchedFeatureCount = 0
          const breakdown = {
            velocity: 0,
            trajectoryPosition: 0,
            trajectoryDirection: 0,
            other: 0,
          }
          const breakdownCounts = {
            velocity: 0,
            trajectoryPosition: 0,
            trajectoryDirection: 0,
            other: 0,
          }
          const contributions: SamplingMatcherPreviewMatch['contributions'] = []

          for (const [name, queryValue] of Object.entries(queryFeatures)) {
            const sampleValue = getSamplingSampleFeatureValue(sample.features, name)
            if (sampleValue === null || sampleValue === undefined || !Number.isFinite(sampleValue)) {
              continue
            }

            const delta = sampleValue - queryValue
            const componentScore = delta * delta
            const group = classifySamplingFeature(name)
            score += componentScore
            breakdown[group] += componentScore
            breakdownCounts[group] += 1
            contributions.push({
              name,
              delta,
              score: Math.sqrt(componentScore),
            })
            matchedFeatureCount += 1
          }

          return {
            pointIndex,
            pointFrame: point.frameOffset,
            clipId: sample.clipId,
            clipName: clip?.clipName ?? sample.clipId,
            isMirrored: sample.isMirrored,
            frame: sample.frame,
            score: matchedFeatureCount > 0 ? Math.sqrt(score / matchedFeatureCount) : 0,
            breakdown,
            breakdownCounts,
            contributions: contributions.sort((left, right) => right.score - left.score),
            matchedFeatureCount,
          }
        })
        .filter((match) => match !== null)
        .filter((match) => match.matchedFeatureCount > 0)
        .sort((left, right) => left.score - right.score)[0] ?? null
    })
    .filter((match) => match !== null)
}

function classifySamplingFeature(name: string): keyof SamplingMatcherPreviewMatch['breakdown'] {
  if (name === 'hips_velocity' || name.endsWith('_velocity')) {
    return 'velocity'
  }

  if (name.startsWith('trajectory_position_')) {
    return 'trajectoryPosition'
  }

  if (name.startsWith('trajectory_direction_')) {
    return 'trajectoryDirection'
  }

  return 'other'
}

function formatSamplingScoreBreakdown(match: SamplingMatcherPreviewMatch) {
  const parts = [
    `V ${formatBreakdownGroup(match, 'velocity')}`,
    `P ${formatBreakdownGroup(match, 'trajectoryPosition')}`,
    `D ${formatBreakdownGroup(match, 'trajectoryDirection')}`,
  ]

  if (match.breakdown.other > 0) {
    parts.push(`O ${formatBreakdownGroup(match, 'other')}`)
  }

  return parts.join('  ')
}

function formatBreakdownGroup(match: SamplingMatcherPreviewMatch, group: keyof SamplingMatcherPreviewMatch['breakdown']) {
  const count = match.breakdownCounts[group]
  return count > 0 ? formatNumber(Math.sqrt(match.breakdown[group] / count)) : '--'
}

function formatSamplingContributionSummary(match: SamplingMatcherPreviewMatch) {
  return match.contributions.slice(0, 4)
    .map((item) => `${item.name} Δ${formatNumber(Math.abs(item.delta))}`)
    .join('  ')
}

function countSamplingRoleCandidates(query: SamplingQueryResponse, database: RuntimeDatabaseDraftResponse) {
  if (!query.roleFilter) {
    return database.samples.length
  }

  const clipLookup = new Map(database.clips.map((clip) => [runtimeClipKey(clip.clipId, clip.isMirrored), clip]))
  return database.samples.filter((sample) => clipLookup.get(runtimeClipKey(sample.clipId, sample.isMirrored))?.clipRole === query.roleFilter).length
}

function buildSamplingPointQueryFeatureValues(
  query: SamplingQueryResponse,
  point: SamplingQueryResponse['trajectory'][number],
  normalizationFactor: number,
) {
  const facing = normalizeVector2(query.facing[0] ?? 0, query.facing[2] ?? 1)
  const derivedVelocity = sampleSamplingVelocityAtFrame(query.trajectory, point.frameOffset)
  const velocityX = derivedVelocity[0] ?? 0
  const velocityZ = derivedVelocity[2] ?? 0
  const values: Record<string, number> = {
    hips_velocity: Number((Math.hypot(velocityX, velocityZ) * normalizationFactor).toFixed(4)),
  }

  const offset = point.frameOffset
  const x = point.position[0] ?? 0
  const z = point.position[2] ?? 0
  const projectedDistance = (x * facing.x + z * facing.z) * normalizationFactor
  const pointDirection = normalizeVector2(point.direction[0] ?? query.facing[0] ?? 0, point.direction[2] ?? query.facing[2] ?? 1)
  const facingAlignment = pointDirection.x * facing.x + pointDirection.z * facing.z
  values[buildTrajectoryFeatureValueName('trajectory_position', offset)] = Number(projectedDistance.toFixed(4))
  values[buildTrajectoryFeatureValueName('trajectory_direction', offset)] = Number(facingAlignment.toFixed(4))

  return values
}

function buildSamplingContractQueryFeatureValues(
  query: SamplingQueryResponse,
  channels: RuntimeFeatureChannelResponse[],
  normalizationFactor: number,
) {
  const values = new Map<string, number | null>()
  const facing = normalizeVector2(query.facing[0] ?? 0, query.facing[2] ?? 1)
  const derivedVelocity = sampleSamplingVelocityAtFrame(query.trajectory, 0)
  const velocityX = derivedVelocity[0] ?? 0
  const velocityZ = derivedVelocity[2] ?? 0

  for (const channel of channels) {
    if (channel.trajectoryFrames.length > 0) {
      for (const frame of channel.trajectoryFrames) {
        const placement = getSamplingPreviewPlacement(query, frame)
        const key = buildTrajectoryFeatureValueName(channel.name, frame)
        if (channel.name === 'trajectory_position') {
          const x = placement.anchor[0] ?? 0
          const z = placement.anchor[2] ?? 0
          values.set(key, Number(((x * facing.x + z * facing.z) * normalizationFactor).toFixed(4)))
        } else if (channel.name === 'trajectory_direction') {
          const heading = normalizeVector2(placement.heading[0] ?? query.facing[0] ?? 0, placement.heading[2] ?? query.facing[2] ?? 1)
          values.set(key, Number((heading.x * facing.x + heading.z * facing.z).toFixed(4)))
        } else {
          values.set(key, null)
        }
      }
    } else if (channel.name === 'hips_velocity') {
      values.set(channel.name, Number((Math.hypot(velocityX, velocityZ) * normalizationFactor).toFixed(4)))
    } else {
      values.set(channel.name, null)
    }
  }

  return [...values.entries()].map(([name, value]) => ({ name, value }))
}

function normalizeVector2(x: number, z: number) {
  const length = Math.hypot(x, z)
  return length > 0.0001 ? { x: x / length, z: z / length } : { x: 0, z: 1 }
}

function getSamplingSampleFeatureValue(features: Record<string, number | null>, name: string) {
  const directValue = features[name]
  if (directValue !== undefined) {
    return directValue
  }

  const trajectoryFeature = parseTrajectoryFeatureName(name)
  if (!trajectoryFeature) {
    return undefined
  }

  return estimateTrajectoryFeatureValue(features, trajectoryFeature.prefix, trajectoryFeature.frame)
}

function parseTrajectoryFeatureName(name: string) {
  const match = /^(trajectory_(?:position|direction))_(\d+)f?$/.exec(name)
  if (!match) {
    return null
  }

  return {
    prefix: match[1],
    frame: Number.parseInt(match[2], 10),
  }
}

function estimateTrajectoryFeatureValue(features: Record<string, number | null>, prefix: string, frame: number) {
  const samples = Object.entries(features)
    .map(([featureName, value]) => {
      const parsed = parseTrajectoryFeatureName(featureName)
      return parsed && parsed.prefix === prefix && value !== null && Number.isFinite(value)
        ? { frame: parsed.frame, value }
        : null
    })
    .filter((sample) => sample !== null)
    .sort((left, right) => left.frame - right.frame)

  if (!samples.length) {
    return undefined
  }

  if (samples.length === 1 || frame <= samples[0].frame) {
    return samples[0].value
  }

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1]
    const next = samples[index]
    if (frame <= next.frame) {
      const ratio = (frame - previous.frame) / Math.max(next.frame - previous.frame, 1)
      return previous.value + (next.value - previous.value) * ratio
    }
  }

  const last = samples.at(-1)
  return last?.value
}

function buildEngineQueryContract(draft: RuntimeBuildDraftResponse) {
  const contract = {
    characterName: draft.characterName,
    sampleFrameStep: draft.sampleFrameStep,
    samplingFrameRate: defaultSamplingFrameRate,
    samplingFrameRateNote: 'Sampling authoring frames convert to seconds with frameOffset / samplingFrameRate.',
    scale: {
      mode: draft.features.scale.mode,
      normalizationFactor: draft.features.scale.normalizationFactor,
      maxObservedRootSpeed: draft.features.scale.maxObservedRootSpeed,
      note: 'Engine query units must match these database units.',
    },
    features: buildRuntimeQueryContractFeatures(draft),
    sourceChannels: draft.features.channels.map((channel) => ({
      name: channel.name,
      kind: channel.kind,
      boneSlot: channel.boneSlot,
      trajectoryFrames: channel.trajectoryFrames,
      trajectoryTimesSeconds: channel.trajectoryTimesSeconds,
    })),
    skeletonSlots: draft.skeleton.slots.map((slot) => ({
      slot: slot.slot,
      boneName: slot.boneName,
      status: slot.status,
    })),
    plannedSamples: {
      poseSamples: draft.poses.plannedPoseSampleCount,
      poseValueSamples: draft.poses.samples.length,
      featureSamples: draft.features.plannedSampleCount,
      databaseSamples: draft.database.sampleCount,
    },
  }

  return JSON.stringify(contract, null, 2)
}

function buildRuntimeQueryContractFeatures(draft: RuntimeBuildDraftResponse): RuntimeQueryContractFeature[] {
  return draft.features.channels.flatMap<RuntimeQueryContractFeature>((channel) => {
    if (channel.trajectoryFrames.length > 0) {
      return channel.trajectoryFrames.map((frame, index) => ({
        name: buildTrajectoryFeatureValueName(channel.name, frame),
        sourceChannel: channel.name,
        kind: channel.kind,
        boneSlot: channel.boneSlot,
        trajectoryFrame: frame,
        timeSeconds: channel.trajectoryTimesSeconds?.[index] ?? samplingFrameSeconds(frame),
      }))
    }

    return [{
      name: channel.name,
      sourceChannel: channel.name,
      kind: channel.kind,
      boneSlot: channel.boneSlot,
      trajectoryFrame: null,
      timeSeconds: null,
    }]
  })
}

function buildTrajectoryFeatureValueName(channelName: string, frameOffset: number) {
  return `${channelName}_${frameOffset}f`
}

function buildReportPathsText(report: BuildReportResponse) {
  return [
    `Build report: ${report.reportPath}`,
  ].join('\n')
}

function runtimeDraftPathsText(draft: RuntimeBuildDraftResponse) {
  const buildFolder = buildFolderFromDraftPath(draft.draftPath)
  const artifactPaths = draft.artifacts.map((artifact) => `${artifact.kind}: ${buildFolder}/${artifact.fileName}`)

  return [
    `Runtime draft: ${draft.draftPath}`,
    `Source report: ${draft.sourceReportPath}`,
    ...artifactPaths,
  ].join('\n')
}

function runtimeDatabasePathFromDraft(draft: RuntimeBuildDraftResponse) {
  const buildFolder = buildFolderFromDraftPath(draft.draftPath)
  const databaseArtifact = draft.artifacts.find((artifact) => artifact.kind === 'database')
  return databaseArtifact ? `${buildFolder}/${databaseArtifact.fileName}` : `${buildFolder}/${draft.characterName}.mmdatabase`
}

function buildFolderFromDraftPath(draftPath: string) {
  return draftPath.split('/').slice(0, -1).join('/')
}

function formatRuntimeScaleMode(mode: RuntimeScaleMode) {
  return runtimeScaleModes.find((item) => item.value === mode)?.label ?? 'Auto'
}

function formatRuntimeScaleSummary(draft: RuntimeBuildDraftResponse | null) {
  if (!draft) {
    return 'Not generated'
  }

  const scale = draft.features.scale
  return `${formatRuntimeScaleMode(scale.mode)} x${formatNumber(scale.normalizationFactor)}`
}

function samplingFrameSeconds(frame: number) {
  return frame / defaultSamplingFrameRate
}

function formatSamplingFrameTime(frame: number) {
  return `${formatNumber(samplingFrameSeconds(frame))}s @${defaultSamplingFrameRate}fps`
}

function formatSamplingFrameSeconds(frame: number) {
  return `${formatNumber(samplingFrameSeconds(frame))}s`
}

function parsePredictionFrameList(value: string, fallback: number[]) {
  const parsed = value
    .split(/[,\s/]+/)
    .map((part) => Math.round(Number(part)))
    .filter((frame) => Number.isFinite(frame) && frame > 0)
    .map((frame) => Math.min(Math.max(frame, 1), 600))
  const uniqueFrames = [...new Set(parsed)].sort((left, right) => left - right)
  return uniqueFrames.length ? uniqueFrames : fallback
}

function numberArraysEqual(left: number[], right: number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function formatTrajectoryChannelOffsets(channel: RuntimeFeatureChannelResponse) {
  const times = channel.trajectoryTimesSeconds?.length
    ? channel.trajectoryTimesSeconds
    : channel.trajectoryFrames.map(samplingFrameSeconds)
  return `+${channel.trajectoryFrames.join('/')}f @${defaultSamplingFrameRate} (${times.map((seconds) => `${formatNumber(seconds)}s`).join('/')})`
}

function formatSourceTimeline(clip: { frameCount?: number | null; frameRate?: number | null; durationSeconds?: number | null }) {
  const frameRate = clip.frameRate && clip.frameRate > 0 ? `${formatNumber(clip.frameRate)} fps` : 'unknown fps'
  const frameCount = clip.frameCount ? `${clip.frameCount}f` : 'unknown frames'
  const duration = clip.durationSeconds && clip.durationSeconds > 0 ? `${formatNumber(clip.durationSeconds)}s` : 'unknown duration'
  return `${frameRate}, ${frameCount}, ${duration}`
}

function formatRuntimeSettingsSaveState(state: 'idle' | 'saving' | 'saved' | 'failed') {
  if (state === 'saving') {
    return 'Saving settings'
  }

  if (state === 'saved') {
    return 'Settings saved'
  }

  if (state === 'failed') {
    return 'Settings failed'
  }

  return 'Settings stored in character'
}

function formatBuildReportStatus(status: CharacterResponse['buildReportStatus']) {
  if (status === 'current') {
    return 'Report current'
  }

  if (status === 'outdated') {
    return 'Report outdated'
  }

  return 'No report'
}

function formatRuntimeDraftStatus(status: CharacterResponse['runtimeBuildDraftStatus']) {
  if (status === 'current') {
    return 'Runtime draft current'
  }

  if (status === 'outdated') {
    return 'Runtime draft outdated'
  }

  return 'No runtime draft'
}

function formatReportDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function describeReadinessChanges(
  saved: CharacterResponse['buildReadiness'],
  current: CharacterResponse['buildReadiness'],
) {
  const changes: string[] = []
  const addCountChange = (label: string, savedValue: number, currentValue: number) => {
    if (savedValue !== currentValue) {
      changes.push(`${label}: ${savedValue} -> ${currentValue}`)
    }
  }

  addCountChange('Included clips', saved.includedClipCount, current.includedClipCount)
  addCountChange('Mirrored copies', saved.mirroredCopyCount, current.mirroredCopyCount)
  addCountChange('Planned entries', saved.plannedClipCount, current.plannedClipCount)
  addCountChange('Warnings', saved.warningCount, current.warningCount)
  addCountChange('Errors', saved.errorCount, current.errorCount)

  if (summarizeRoleCoverage(saved) !== summarizeRoleCoverage(current)) {
    changes.push('Role coverage changed')
  }
  if (summarizePlanEntries(saved) !== summarizePlanEntries(current)) {
    changes.push('Build plan entries changed')
  }
  if (summarizeSkeletonCoverage(saved) !== summarizeSkeletonCoverage(current)) {
    changes.push('Skeleton coverage changed')
  }
  if (summarizeFootContacts(saved) !== summarizeFootContacts(current)) {
    changes.push('Foot contact coverage changed')
  }
  if (summarizeFindings(saved) !== summarizeFindings(current)) {
    changes.push('Finding list changed')
  }

  return changes
}

function summarizeRoleCoverage(readiness: CharacterResponse['buildReadiness']) {
  return readiness.roles.map((role) => `${role.role}:${role.includedClipCount}`).join('|')
}

function summarizePlanEntries(readiness: CharacterResponse['buildReadiness']) {
  return readiness.planEntries.map((entry) => `${entry.clipId}:${entry.clipRole ?? ''}:${entry.isMirrored}`).join('|')
}

function summarizeSkeletonCoverage(readiness: CharacterResponse['buildReadiness']) {
  return readiness.skeletonCoverage.map((item) => `${item.clipId}:${item.status}:${item.coverage ?? ''}`).join('|')
}

function summarizeFootContacts(readiness: CharacterResponse['buildReadiness']) {
  return readiness.footContacts.map((item) => `${item.clipId}:${item.rangeCount}:${item.presentFeet.join(',')}:${item.missingFeet.join(',')}`).join('|')
}

function summarizeFindings(readiness: CharacterResponse['buildReadiness']) {
  return readiness.findings.map((finding) => `${finding.clipId ?? ''}:${finding.severity}:${finding.code}:${finding.message}`).join('|')
}

function BuildReadinessPanel({
  character,
  onSelectClip,
}: {
  character: CharacterResponse
  onSelectClip: (clipId: string) => void
}) {
  const readiness = character.buildReadiness
  const presentRoles = readiness.roles.filter((role) => role.includedClipCount > 0)
  const missingRoles = readiness.roles.filter((role) => role.isRequired && role.includedClipCount === 0)
  const blocking = readiness.errorCount > 0

  return (
    <section className="inspector-section">
      <h3>Build Readiness</h3>
      <div className={`validation-summary ${blocking ? 'blocked' : readiness.warningCount > 0 ? 'warn' : 'ok'}`}>
        {blocking ? <AlertCircle size={16} aria-hidden="true" /> : readiness.warningCount > 0 ? <TriangleAlert size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
        <span>{blocking ? 'Blocked' : readiness.warningCount > 0 ? 'Has warnings' : 'Ready'}</span>
      </div>
      <div className="readiness-stats" aria-label="Build readiness counts">
        <span><strong>{readiness.includedClipCount}</strong> included</span>
        <span><strong>{readiness.mirroredCopyCount}</strong> mirrored</span>
        <span><strong>{readiness.plannedClipCount}</strong> planned</span>
        <span><strong>{readiness.warningCount}</strong> warnings</span>
        <span><strong>{readiness.errorCount}</strong> errors</span>
      </div>
      <div className="role-coverage" aria-label="Role coverage">
        {readiness.roles.map((role) => (
          <span key={role.role} className={`role-pill ${role.includedClipCount > 0 ? 'present' : 'missing'}`} title={role.description}>
            {role.role}
            {role.includedClipCount > 0 ? ` ${role.includedClipCount}` : ''}
          </span>
        ))}
      </div>
      <dl>
        <dt>Present</dt>
        <dd>{presentRoles.length ? presentRoles.map((role) => role.role).join(', ') : 'None'}</dd>
        <dt>Missing</dt>
        <dd>{missingRoles.length ? missingRoles.map((role) => role.role).join(', ') : 'None'}</dd>
      </dl>
      <div className="finding-list">
        {readiness.findings.slice(0, 6).map((finding, index) => finding.clipId ? (
          <button
            key={`${finding.severity}-${finding.code}-${finding.clipId}-${index}`}
            type="button"
            className={`finding finding-action ${finding.severity}`}
            onClick={() => onSelectClip(finding.clipId!)}
          >
            <strong>{finding.clipName ? `${finding.clipName}: ${finding.code}` : finding.code}</strong>
            <span>{finding.message}</span>
          </button>
        ) : (
          <div key={`${finding.severity}-${finding.code}-character-${index}`} className={`finding ${finding.severity}`}>
            <strong>{finding.code}</strong>
            <span>{finding.message}</span>
          </div>
        ))}
        {readiness.findings.length > 6 ? (
          <p className="muted">{readiness.findings.length - 6} more finding(s)</p>
        ) : null}
      </div>
    </section>
  )
}

function BuildPlanPanel({
  character,
  onSelectClip,
}: {
  character: CharacterResponse
  onSelectClip: (clipId: string) => void
}) {
  const readiness = character.buildReadiness

  return (
    <section className="inspector-section">
      <h3>Build Plan</h3>
      {readiness.planEntries.length ? (
        <div className="build-plan-list">
          {readiness.planEntries.map((entry) => (
            <button
              key={`${entry.clipId}-${entry.isMirrored ? 'mirror' : 'source'}`}
              type="button"
              className="build-plan-row"
              onClick={() => onSelectClip(entry.clipId)}
            >
              <span>{entry.clipName}</span>
              <span>{entry.clipRole ?? 'Unassigned'}{entry.isMirrored ? ' mirror' : ''}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">No included clips</p>
      )}
      <div className="build-coverage-list">
        {readiness.skeletonCoverage.map((item) => (
          <button
            key={`skeleton-${item.clipId}`}
            type="button"
            className={`coverage-row ${item.status}`}
            onClick={() => onSelectClip(item.clipId)}
          >
            <span>{item.clipName}</span>
            <span>{item.coverage === null ? 'Skeleton --' : `Skeleton ${Math.round(item.coverage * 100)}%`}</span>
          </button>
        ))}
        {readiness.footContacts.map((item) => (
          <button
            key={`contacts-${item.clipId}`}
            type="button"
            className={`coverage-row ${item.hasContacts ? 'ok' : 'missing'}`}
            onClick={() => onSelectClip(item.clipId)}
          >
            <span>{item.clipName}</span>
            <span>{item.hasContacts ? `Contacts ${item.rangeCount}` : 'Contacts missing'}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function CharacterInspector({
  character,
  isBusy,
  hasBuildReport,
  hasRuntimeDraft,
  lastBuildReport,
  lastRuntimeDraft,
  selectedSampling,
  selectedSamplingDraft,
  runtimeSampleFrameStep,
  runtimeScaleMode,
  runtimeTrajectoryPredictionFrames,
  activeTab,
  runtimeSettingsSaveState,
  onGenerateBuildReport,
  onGenerateRuntimeBuildDraft,
  onLoadRuntimeDraft,
  onViewBuildReport,
  onViewRuntimeDraft,
  onViewRuntimeDatabaseDraft,
  onCopyRuntimeBuildFolder,
  onExportRuntimeBuild,
  onActiveTabChange,
  onSamplingDraftChange,
  onUpdateSampling,
  onRuntimeSampleFrameStepChange,
  onRuntimeScaleModeChange,
  onRuntimeTrajectoryPredictionFramesChange,
  onSelectClip,
  selectedMatcherKey,
  onPreviewMatcherSample,
  onSelectMatcherSample,
  selectedSamplingPointIndex,
  onSamplingPointSelect,
}: {
  character: CharacterResponse
  isBusy: boolean
  hasBuildReport: boolean
  hasRuntimeDraft: boolean
  lastBuildReport: BuildReportResponse | null
  lastRuntimeDraft: RuntimeBuildDraftResponse | null
  selectedSampling: SamplingQueryResponse | null
  selectedSamplingDraft: SamplingQueryResponse | null
  runtimeSampleFrameStep: number
  runtimeScaleMode: RuntimeScaleMode
  runtimeTrajectoryPredictionFrames: number[]
  activeTab: CharacterInspectorTab
  runtimeSettingsSaveState: 'idle' | 'saving' | 'saved' | 'failed'
  onGenerateBuildReport: () => void
  onGenerateRuntimeBuildDraft: () => void
  onLoadRuntimeDraft: () => void
  onViewBuildReport: () => void
  onViewRuntimeDraft: () => void
  onViewRuntimeDatabaseDraft: () => void
  onCopyRuntimeBuildFolder: () => void
  onExportRuntimeBuild: () => void
  onActiveTabChange: (tab: CharacterInspectorTab) => void
  onSamplingDraftChange: (query: SamplingQueryResponse) => void
  onUpdateSampling: (samplingId: string, update: SamplingQueryUpdateRequest) => void
  onRuntimeSampleFrameStepChange: (value: number) => void
  onRuntimeScaleModeChange: (value: RuntimeScaleMode) => void
  onRuntimeTrajectoryPredictionFramesChange: (value: number[]) => void
  onSelectClip: (clipId: string) => void
  selectedMatcherKey: string | null
  onPreviewMatcherSample: (match: SamplingMatcherPreviewMatch) => void
  onSelectMatcherSample: (match: SamplingMatcherPreviewMatch) => void
  selectedSamplingPointIndex: number | null
  onSamplingPointSelect: (index: number | null) => void
}) {
  const trajectoryFrameSource = runtimeTrajectoryPredictionFrames.join(', ')
  const [trajectoryFrameDraft, setTrajectoryFrameDraft] = useState({ source: trajectoryFrameSource, value: trajectoryFrameSource })
  const visibleTrajectoryFrameDraft = trajectoryFrameDraft.source === trajectoryFrameSource ? trajectoryFrameDraft.value : trajectoryFrameSource
  const parsedTrajectoryFrameDraft = parsePredictionFrameList(visibleTrajectoryFrameDraft, runtimeTrajectoryPredictionFrames)
  const commitTrajectoryFrameDraft = () => {
    const nextFrames = parsePredictionFrameList(visibleTrajectoryFrameDraft, runtimeTrajectoryPredictionFrames)
    setTrajectoryFrameDraft({ source: trajectoryFrameSource, value: nextFrames.join(', ') })
    if (!numberArraysEqual(nextFrames, runtimeTrajectoryPredictionFrames)) {
      onRuntimeTrajectoryPredictionFramesChange(nextFrames)
    }
  }

  return (
    <div className="inspector-content">
      <section className="inspector-section">
        <h2>{character.name}</h2>
        <div className="inspector-tabs" role="tablist" aria-label="Character inspector tabs">
          <button
            type="button"
            className={activeTab === 'overview' ? 'active' : ''}
            onClick={() => onActiveTabChange('overview')}
          >
            Build
          </button>
          <button
            type="button"
            className={activeTab === 'sampling' ? 'active' : ''}
            onClick={() => onActiveTabChange('sampling')}
          >
            Sampling
          </button>
        </div>
        {activeTab === 'overview' ? (
          <>
            <dl>
              <dt>ID</dt>
              <dd>{character.id}</dd>
              <dt>Manifest</dt>
              <dd>{character.manifestPath}</dd>
              <dt>Visual</dt>
              <dd>{character.visualManifestPath}</dd>
              <dt>Preview</dt>
              <dd>{character.previewUrl ? 'Ready' : 'Not generated'}</dd>
              <dt>Clips</dt>
              <dd>{character.clips?.length ?? 0}</dd>
              <dt>Report</dt>
              <dd>{formatBuildReportStatus(character.buildReportStatus)}</dd>
              <dt>Runtime</dt>
              <dd>{formatRuntimeDraftStatus(character.runtimeBuildDraftStatus)}</dd>
              <dt>Scale</dt>
              <dd>{formatRuntimeScaleSummary(lastRuntimeDraft)}</dd>
            </dl>
            <label className="setting-field">
              Runtime sample step
              <input
                type="number"
                min={1}
                max={120}
                step={1}
                value={runtimeSampleFrameStep}
                disabled={isBusy}
                onChange={(event) => onRuntimeSampleFrameStepChange(Math.min(Math.max(Math.round(Number(event.target.value) || 1), 1), 120))}
              />
            </label>
            <label className="setting-field">
              {`Trajectory horizon F@${defaultSamplingFrameRate}`}
              <input
                type="text"
                value={visibleTrajectoryFrameDraft}
                disabled={isBusy}
                onChange={(event) => setTrajectoryFrameDraft({ source: trajectoryFrameSource, value: event.target.value })}
                onBlur={commitTrajectoryFrameDraft}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitTrajectoryFrameDraft()
                    event.currentTarget.blur()
                  }
                }}
              />
            </label>
            <p className="muted">
              {parsedTrajectoryFrameDraft.map((frame) => `+${frame}f=${formatSamplingFrameTime(frame)}`).join(', ')}
            </p>
            <label className="setting-field">
              Runtime scale mode
              <select
                value={runtimeScaleMode}
                disabled={isBusy}
                onChange={(event) => onRuntimeScaleModeChange(event.target.value as RuntimeScaleMode)}
              >
                {runtimeScaleModes.map((mode) => (
                  <option key={mode.value} value={mode.value}>{mode.label}</option>
                ))}
              </select>
            </label>
            <span className={`settings-save-state ${runtimeSettingsSaveState}`}>
              {formatRuntimeSettingsSaveState(runtimeSettingsSaveState)}
            </span>
            <button type="button" className="inspector-action" disabled={isBusy} onClick={onGenerateBuildReport}>
              {isBusy ? <Loader2 size={14} aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}
              Generate Build Report
            </button>
            <button type="button" className="inspector-action" disabled={isBusy} onClick={onGenerateRuntimeBuildDraft}>
              {isBusy ? <Loader2 size={14} aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}
              Build Runtime
            </button>
            <button type="button" className={`inspector-action report-status-${character.buildReportStatus}`} disabled={isBusy || !hasBuildReport} onClick={onViewBuildReport} title={formatBuildReportStatus(character.buildReportStatus)}>
              <FileText size={14} aria-hidden="true" />
              {lastBuildReport ? 'View Report' : character.buildReportPath ? 'Load Report' : 'View Report'}
            </button>
            <button type="button" className={`inspector-action report-status-${character.runtimeBuildDraftStatus}`} disabled={isBusy || !hasRuntimeDraft} onClick={onViewRuntimeDraft} title={formatRuntimeDraftStatus(character.runtimeBuildDraftStatus)}>
              <FileText size={14} aria-hidden="true" />
              {lastRuntimeDraft ? 'View Runtime Draft' : character.runtimeBuildDraftPath ? 'Load Runtime Draft' : 'View Runtime Draft'}
            </button>
            <button type="button" className={`inspector-action report-status-${character.runtimeBuildDraftStatus}`} disabled={isBusy || !hasRuntimeDraft} onClick={onViewRuntimeDatabaseDraft} title={formatRuntimeDraftStatus(character.runtimeBuildDraftStatus)}>
              <FileText size={14} aria-hidden="true" />
              View Database Draft
            </button>
            <button type="button" className={`inspector-action report-status-${character.runtimeBuildDraftStatus}`} disabled={isBusy || !hasRuntimeDraft} onClick={onCopyRuntimeBuildFolder} title="Copy runtime build folder">
              <Copy size={14} aria-hidden="true" />
              Copy Build Folder
            </button>
            <button type="button" className={`inspector-action report-status-${character.runtimeBuildDraftStatus}`} disabled={isBusy || !hasRuntimeDraft} onClick={onExportRuntimeBuild} title="Export runtime build folder as ZIP">
              <Archive size={14} aria-hidden="true" />
              Export ZIP
            </button>
          </>
        ) : (
          <SamplingInspector
            key={`${selectedSampling?.id ?? character.samplings[0]?.id ?? 'sampling-empty'}-${selectedSampling?.name ?? character.samplings[0]?.name ?? ''}`}
            character={character}
            sampling={selectedSampling ?? character.samplings[0] ?? null}
            draft={selectedSamplingDraft}
            runtimeDraft={lastRuntimeDraft}
            hasRuntimeDraft={hasRuntimeDraft}
            isBusy={isBusy}
            onGenerateRuntimeBuildDraft={onGenerateRuntimeBuildDraft}
            onLoadRuntimeDraft={onLoadRuntimeDraft}
            onDraftChange={onSamplingDraftChange}
            onUpdateSampling={onUpdateSampling}
            selectedMatchKey={selectedMatcherKey}
            onPreviewMatch={onPreviewMatcherSample}
            onSelectMatch={onSelectMatcherSample}
            selectedSamplingPointIndex={selectedSamplingPointIndex}
            onSamplingPointSelect={onSamplingPointSelect}
          />
        )}
      </section>
      {activeTab === 'overview' ? (
        <>
          <BuildReadinessPanel character={character} onSelectClip={onSelectClip} />
          <BuildPlanPanel character={character} onSelectClip={onSelectClip} />
          <section className="inspector-section">
            <h3>Validation</h3>
            {character.validation ? (
              <div className={`validation-summary ${character.validation.canCompile ? 'ok' : 'blocked'}`}>
                {character.validation.canCompile ? <CheckCircle2 size={16} aria-hidden="true" /> : <AlertCircle size={16} aria-hidden="true" />}
                <span>{character.validation.canCompile ? 'Ready for preview' : 'Blocked'}</span>
              </div>
            ) : (
              <p className="muted">Not checked</p>
            )}
            <div className="finding-list">
              {character.validation?.findings.map((finding) => (
                <div key={`${finding.severity}-${finding.code}`} className={`finding ${finding.severity}`}>
                  <strong>{finding.code}</strong>
                  <span>{finding.message}</span>
                </div>
              ))}
            </div>
          </section>
          <ImportLogPanel entries={character.importLog} />
        </>
      ) : null}
    </div>
  )
}

function SamplingInspector({
  character,
  sampling,
  draft,
  runtimeDraft,
  hasRuntimeDraft,
  isBusy,
  onGenerateRuntimeBuildDraft,
  onLoadRuntimeDraft,
  onDraftChange,
  onUpdateSampling,
  selectedMatchKey,
  onPreviewMatch,
  onSelectMatch,
  selectedSamplingPointIndex,
  onSamplingPointSelect,
}: {
  character: CharacterResponse
  sampling: SamplingQueryResponse | null
  draft: SamplingQueryResponse | null
  runtimeDraft: RuntimeBuildDraftResponse | null
  hasRuntimeDraft: boolean
  isBusy: boolean
  onGenerateRuntimeBuildDraft: () => void
  onLoadRuntimeDraft: () => void
  onDraftChange: (query: SamplingQueryResponse) => void
  onUpdateSampling: (samplingId: string, update: SamplingQueryUpdateRequest) => void
  selectedMatchKey: string | null
  onPreviewMatch: (match: SamplingMatcherPreviewMatch) => void
  onSelectMatch: (match: SamplingMatcherPreviewMatch) => void
  selectedSamplingPointIndex: number | null
  onSamplingPointSelect: (index: number | null) => void
}) {
  const runtimeScale = runtimeDraft
    ? `${formatRuntimeScaleMode(runtimeDraft.features.scale.mode)} x${formatNumber(runtimeDraft.features.scale.normalizationFactor)}`
    : 'Not generated'
  const normalizedDraft = draft ? normalizeSamplingDraftVelocity(draft) : null
  const hasChanges = Boolean(sampling && normalizedDraft && JSON.stringify(sampling) !== JSON.stringify(normalizedDraft))
  const facingAngle = draft ? vectorToYawDegrees(draft.facing) : 0
  const matcherPreview = useMemo(
    () => draft && runtimeDraft ? buildSamplingMatcherPreview(draft, runtimeDraft.database) : [],
    [draft, runtimeDraft],
  )
  const samplingQueryFeatureValues = useMemo(
    () => draft && runtimeDraft
      ? buildSamplingContractQueryFeatureValues(draft, runtimeDraft.features.channels, runtimeDraft.database.scale.normalizationFactor)
      : [],
    [draft, runtimeDraft],
  )
  const roleFilteredCandidateCount = useMemo(
    () => draft && runtimeDraft ? countSamplingRoleCandidates(draft, runtimeDraft.database) : 0,
    [draft, runtimeDraft],
  )
  const runtimeSampleLookup = useMemo(
    () => new Map(runtimeDraft?.database.samples.map((sample) => [runtimeDatabaseSampleKey(sample), sample]) ?? []),
    [runtimeDraft],
  )

  function updateDraft(updater: (current: SamplingQueryResponse) => SamplingQueryResponse) {
    if (!draft) {
      return
    }

    onDraftChange(updater(draft))
  }

  function updateRoleFilter(roleFilter: string | null) {
    updateDraft((current) => ({
      ...current,
      roleFilter,
    }))
  }

  function updateCapsule(field: keyof SamplingQueryResponse['capsule'], value: number) {
    updateDraft((current) => ({
      ...current,
      capsule: {
        ...current.capsule,
        [field]: value,
      },
    }))
  }

  function updateFacingAngle(degrees: number) {
    const radians = degrees * Math.PI / 180
    updateDraft((current) => ({
      ...current,
      facing: [Number(Math.sin(radians).toFixed(3)), 0, Number(Math.cos(radians).toFixed(3))],
    }))
  }

  function updateTrajectory(index: number, field: 'frameOffset' | 'positionX' | 'positionZ', value: number) {
    updateDraft((current) => {
      const trajectory = current.trajectory.map((point, pointIndex) => {
        if (pointIndex !== index) {
          return point
        }

        if (field === 'frameOffset') {
          return { ...point, frameOffset: Math.max(Math.round(value), 1) }
        }

        return {
          ...point,
          position: updateVectorValue(point.position, field === 'positionX' ? 0 : 2, value),
        }
      })

      return {
        ...current,
        velocity: deriveSamplingVelocityFromTrajectory(trajectory),
        trajectory,
      }
    })
  }

  function saveSampling() {
    if (!draft) {
      return
    }

    onUpdateSampling(draft.id, {
      name: draft.name,
      roleFilter: draft.roleFilter ?? '',
      capsule: draft.capsule,
      facing: draft.facing,
      velocity: deriveSamplingVelocityFromTrajectory(draft.trajectory),
      trajectory: draft.trajectory,
    })
  }

  function projectVelocityForFrames(velocity: number[], frameDelta: number) {
    const seconds = Math.max(frameDelta, 1) / fallbackFrameRate
    return [
      Number(((velocity[0] ?? 0) * seconds).toFixed(2)),
      0,
      Number(((velocity[2] ?? 0) * seconds).toFixed(2)),
    ]
  }

  function addTrajectoryPoint() {
    updateDraft((current) => {
      const lastPoint = current.trajectory.at(-1)
      const nextFrame = (lastPoint?.frameOffset ?? 0) + 20
      const frameDelta = lastPoint ? nextFrame - lastPoint.frameOffset : nextFrame
      const sourceVelocity = sampleSamplingVelocityAtFrame(current.trajectory, lastPoint?.frameOffset ?? 0)
      const velocityOffset = projectVelocityForFrames(sourceVelocity, frameDelta)
      const nextPosition = lastPoint
        ? [
            Number(((lastPoint.position[0] ?? 0) + velocityOffset[0]).toFixed(2)),
            0,
            Number(((lastPoint.position[2] ?? 0) + velocityOffset[2]).toFixed(2)),
          ]
        : velocityOffset

      const trajectory = [
        ...current.trajectory,
        {
          frameOffset: nextFrame,
          position: nextPosition,
          direction: current.facing,
        },
      ]

      return {
        ...current,
        velocity: deriveSamplingVelocityFromTrajectory(trajectory),
        trajectory,
      }
    })
  }

  function insertTrajectoryPointNear(index: number) {
    updateDraft((current) => {
      const sourcePoint = current.trajectory[index]
      if (!sourcePoint) {
        return current
      }

      const sortedTrajectory = sortSamplingTrajectoryByFrame(current.trajectory)
      const sortedIndex = sortedTrajectory.findIndex((point) => point === sourcePoint)
      const previousPoint = sortedIndex > 0 ? sortedTrajectory[sortedIndex - 1] : null
      const nextPoint = sortedIndex >= 0 ? sortedTrajectory[sortedIndex + 1] : null
      const insertedPoint = nextPoint
        ? {
            frameOffset: Math.max(Math.round((sourcePoint.frameOffset + nextPoint.frameOffset) / 2), sourcePoint.frameOffset + 1),
            position: [
              Number((((sourcePoint.position[0] ?? 0) + (nextPoint.position[0] ?? 0)) * 0.5).toFixed(2)),
              0,
              Number((((sourcePoint.position[2] ?? 0) + (nextPoint.position[2] ?? 0)) * 0.5).toFixed(2)),
            ],
            direction: sourcePoint.direction,
          }
        : extrapolateTrajectoryPoint(sourcePoint, previousPoint, current.facing)

      const insertAfterIndex = current.trajectory.findIndex((point) => point === sourcePoint)
      const trajectory = [
        ...current.trajectory.slice(0, insertAfterIndex + 1),
        insertedPoint,
        ...current.trajectory.slice(insertAfterIndex + 1),
      ]

      return {
        ...current,
        velocity: deriveSamplingVelocityFromTrajectory(trajectory),
        trajectory,
      }
    })
  }

  function deleteTrajectoryPoint(index: number) {
    updateDraft((current) => {
      const trajectory = current.trajectory.filter((_, pointIndex) => pointIndex !== index)
      return {
        ...current,
        velocity: deriveSamplingVelocityFromTrajectory(trajectory),
        trajectory,
      }
    })
  }

  function trajectoryOriginSpeed() {
    if (!draft) {
      return 0
    }

    return samplingSpeedAtFrame(draft.trajectory, 0)
  }

  function trajectoryPointSpeed(index: number) {
    if (!draft) {
      return 0
    }

    const point = draft.trajectory[index]
    if (!point) {
      return 0
    }

    return samplingSpeedAtFrame(draft.trajectory, point.frameOffset)
  }

  return (
    <>
      <dl>
        <dt>Character</dt>
        <dd>{character.name}</dd>
        <dt>Sampling</dt>
        <dd>
          <span className="sampling-name-line">
            <span>{draft?.name ?? 'None'}</span>
            {hasChanges ? <strong>Unsaved</strong> : null}
          </span>
        </dd>
        <dt>Capsule</dt>
        <dd>{draft ? `Height ${formatNumber(draft.capsule.height)}, radius ${formatNumber(draft.capsule.radius)}` : '--'}</dd>
        <dt>Facing</dt>
        <dd>{draft ? formatVector(draft.facing) : '--'}</dd>
        <dt>Role</dt>
        <dd>{draft?.roleFilter ?? 'Any role'}</dd>
        <dt>Trajectory</dt>
        <dd>{draft ? draft.trajectory.map((point) => point.frameOffset).join(' / ') : '--'}</dd>
        <dt>Sampling FPS</dt>
        <dd>{`${defaultSamplingFrameRate} fps`}</dd>
        <dt>Scale</dt>
        <dd>{runtimeScale}</dd>
      </dl>
      {draft ? (
        <>
          <div className="sampling-edit-grid">
            <label className="setting-field">
              Target role
              <select value={draft.roleFilter ?? ''} onChange={(event) => updateRoleFilter(event.target.value || null)}>
                <option value="">Any role</option>
                {clipRoles.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.value} - {role.description}
                  </option>
                ))}
              </select>
            </label>
            <label className="setting-field">
              Capsule height
              <input type="number" min={1} value={draft.capsule.height} onChange={(event) => updateCapsule('height', Number(event.target.value) || 1)} />
            </label>
            <label className="setting-field">
              Capsule radius
              <input type="number" min={1} value={draft.capsule.radius} onChange={(event) => updateCapsule('radius', Number(event.target.value) || 1)} />
            </label>
            <label className="setting-field">
              Facing angle
              <input type="number" step={1} value={Math.round(facingAngle)} onChange={(event) => updateFacingAngle(Number(event.target.value) || 0)} />
            </label>
            <label className="setting-field">
              Velocity X
              <input type="number" value={deriveSamplingVelocityFromTrajectory(draft.trajectory)[0] ?? 0} readOnly />
            </label>
            <label className="setting-field">
              Velocity Z
              <input type="number" value={deriveSamplingVelocityFromTrajectory(draft.trajectory)[2] ?? 0} readOnly />
            </label>
          </div>
          <div className="sampling-trajectory-header">
            <span>{`Trajectory @${defaultSamplingFrameRate}fps`}</span>
            <button type="button" className="mini-action" onClick={addTrajectoryPoint}>+ point</button>
          </div>
          <div className="sampling-trajectory-list">
            <div className="sampling-trajectory-row sampling-trajectory-origin">
              <label className="setting-field">
                {`F@${defaultSamplingFrameRate}`}
                <input type="number" value={0} readOnly aria-label="Origin frame" />
              </label>
              <label className="setting-field">
                X
                <input type="number" value={0} readOnly aria-label="Origin X position" />
              </label>
              <label className="setting-field">
                Z
                <input type="number" value={0} readOnly aria-label="Origin Z position" />
              </label>
              <div className="sampling-trajectory-tools">
                <div className="sampling-trajectory-origin-label">{formatSamplingFrameTime(0)}</div>
                <div className="sampling-trajectory-speed">
                  <span>Speed</span>
                  <strong>{`${formatNumber(trajectoryOriginSpeed())} cm/s`}</strong>
                </div>
              </div>
            </div>
            {draft.trajectory.map((point, index) => (
              <div
                key={`${draft.id}-trajectory-${index}`}
                className={`sampling-trajectory-row ${selectedSamplingPointIndex === index ? 'active' : ''}`}
                onClick={() => onSamplingPointSelect(index)}
              >
                <label className="setting-field">
                  {`F@${defaultSamplingFrameRate}`}
                  <input type="number" min={1} value={point.frameOffset} onFocus={() => onSamplingPointSelect(index)} onChange={(event) => updateTrajectory(index, 'frameOffset', Number(event.target.value) || 1)} />
                </label>
                <label className="setting-field">
                  X
                  <input type="number" step={1} value={point.position[0] ?? 0} onFocus={() => onSamplingPointSelect(index)} onChange={(event) => updateTrajectory(index, 'positionX', Number(event.target.value) || 0)} />
                </label>
                <label className="setting-field">
                  Z
                  <input type="number" step={1} value={point.position[2] ?? 0} onFocus={() => onSamplingPointSelect(index)} onChange={(event) => updateTrajectory(index, 'positionZ', Number(event.target.value) || 0)} />
                </label>
                <div className="sampling-trajectory-tools">
                  <div className="sampling-trajectory-actions">
                    <button
                      type="button"
                      className="mini-action mini-action-icon"
                      onClick={() => insertTrajectoryPointNear(index)}
                      title={`Insert trajectory point after ${index + 1}`}
                      aria-label={`Insert trajectory point after ${index + 1}`}
                    >
                      <CirclePlus size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="mini-action mini-action-icon danger"
                      disabled={draft.trajectory.length <= 1}
                      onClick={() => deleteTrajectoryPoint(index)}
                      title={`Delete trajectory point ${index + 1}`}
                      aria-label={`Delete trajectory point ${index + 1}`}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="sampling-trajectory-speed">
                    <span>{formatSamplingFrameTime(point.frameOffset)}</span>
                    <strong>{`${formatNumber(trajectoryPointSpeed(index))} cm/s`}</strong>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="inspector-action" disabled={isBusy || !hasChanges} onClick={saveSampling}>
            <FileText size={14} aria-hidden="true" />
            Save Sampling
          </button>
        </>
      ) : null}
      <section className="sampling-match-section">
        <div className="sampling-match-header">
          <div className="sampling-match-title">
            <h3>Matcher Preview</h3>
            <span>{`@${defaultSamplingFrameRate} fps`}</span>
          </div>
          <div className="sampling-match-actions">
            <button type="button" className="mini-action" disabled={isBusy || !hasRuntimeDraft} onClick={onLoadRuntimeDraft}>
              Load Samples
            </button>
            <button type="button" className="mini-action" disabled={isBusy} onClick={onGenerateRuntimeBuildDraft}>
              Build Runtime
            </button>
          </div>
        </div>
        {runtimeDraft && draft ? (
          <div className="sampling-query-preview">
            <div className="sampling-query-preview-title">
              <span>Query values</span>
              <span>{`${samplingQueryFeatureValues.filter((entry) => entry.value !== null).length}/${samplingQueryFeatureValues.length} ready`}</span>
            </div>
            <div className="sampling-query-preview-list">
              {samplingQueryFeatureValues.slice(0, 10).map((entry) => (
                <span key={entry.name} className={entry.value === null ? 'missing' : ''}>
                  <strong>{entry.name}</strong>
                  {entry.value === null ? 'missing' : formatNumber(entry.value)}
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {runtimeDraft ? (
          matcherPreview.length ? (
            <div className="sampling-match-list">
              {matcherPreview.map((match) => {
                const matchedSample = runtimeSampleLookup.get(runtimeDatabaseSampleKey(match))
                return (
                  <button
                    key={`${match.pointFrame}-${match.clipId}-${match.isMirrored ? 'mirror' : 'source'}-${match.frame}`}
                    type="button"
                    className={`sampling-match-row ${selectedMatchKey === samplingMatcherPreviewKey(match) ? 'active' : ''}`}
                    title={`${match.matchedFeatureCount} feature channels compared. ${formatSamplingScoreBreakdown(match)}. ${formatSamplingContributionSummary(match)}. Double click opens the clip frame.`}
                    onClick={() => onPreviewMatch(match)}
                    onDoubleClick={() => onSelectMatch(match)}
                  >
                    <span>{`+${match.pointFrame}f / ${formatSamplingFrameSeconds(match.pointFrame)}`}</span>
                    <strong>{`${match.clipName}${match.isMirrored ? ' Mirror' : ''}`}</strong>
                    <span>{`F${match.frame + 1}${matchedSample ? ` / ${formatNumber(matchedSample.seconds)}s` : ''}`}</span>
                    <span>{formatNumber(match.score)}</span>
                    <span className="sampling-match-breakdown">{`${formatSamplingScoreBreakdown(match)}  ${formatSamplingContributionSummary(match)}`}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="muted">
              {roleFilteredCandidateCount === 0
                ? `No database samples for role ${draft?.roleFilter ?? 'Any role'}`
                : 'No database samples expose comparable query features'}
            </p>
          )
        ) : (
          <p className="muted">{hasRuntimeDraft ? 'Load Samples to show matcher rows' : 'Build Runtime first to create samples'}</p>
        )}
      </section>
      <button type="button" className="inspector-action" disabled title="Export comes after generated sample recipes">
        <Archive size={14} aria-hidden="true" />
        Export Generated Clip
      </button>
    </>
  )
}

function ImportLogPanel({ entries }: { entries: { level: 'info' | 'warning' | 'error'; message: string }[] }) {
  return (
    <section className="inspector-section">
      <h3>Import Log</h3>
      {entries.length ? (
        <div className="inspector-log-lines">
          {entries.map((entry, index) => (
            <span key={`${entry.level}-${index}-${entry.message}`} className={`log-line ${entry.level}`}>
              {entry.message}
            </span>
          ))}
        </div>
      ) : (
        <p className="muted">No import log entries</p>
      )}
    </section>
  )
}

function validationIcon(character: CharacterResponse) {
  if (!character.validation) {
    return <BoxIcon size={15} aria-hidden="true" />
  }

  if (character.validation.findings.some((finding) => finding.severity === 'error')) {
    return <AlertCircle size={15} aria-hidden="true" className="status-error" />
  }

  if (character.validation.findings.some((finding) => finding.severity === 'warning')) {
    return <TriangleAlert size={15} aria-hidden="true" className="status-warning" />
  }

  return <CheckCircle2 size={15} aria-hidden="true" className="status-ok" />
}

function clipValidationIcon(clip: ClipResponse) {
  if (!clip.validation) {
    return <Film size={15} aria-hidden="true" />
  }

  if (clip.validation.findings.some((finding) => finding.severity === 'error')) {
    return <AlertCircle size={15} aria-hidden="true" className="status-error" />
  }

  if (clip.validation.findings.some((finding) => finding.severity === 'warning')) {
    return <TriangleAlert size={15} aria-hidden="true" className="status-warning" />
  }

  return <CheckCircle2 size={15} aria-hidden="true" className="status-ok" />
}

export default App
