import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Box as BoxIcon, CheckCircle2, CirclePlus, FileText, Film, ListTree, Loader2, Pause, Play, RefreshCw, StepBack, StepForward, TerminalSquare, Trash2, TriangleAlert, X } from 'lucide-react'
import {
  type ClipResponse,
  type BuildReportResponse,
  type CharacterResponse,
  type ContactDetectionPreset,
  type WorkspaceResponse,
  createBrowserWorkspace,
  deleteCharacter,
  deleteClip,
  generateBuildReport,
  getBuildReport,
  openBrowserWorkspace,
  refreshFootContacts,
  replaceClipSource,
  resolveAssetUrl,
  updateClipSettings,
  uploadClip,
  uploadVisualCharacter,
} from './api'
import { BabylonViewport } from './BabylonViewport'
import './App.css'

interface LogEntry {
  id: number
  level: 'info' | 'warning' | 'error'
  message: string
}

type Selection =
  | { type: 'character'; characterId: string }
  | { type: 'clip'; characterId: string; clipId: string }

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

type TextViewer = {
  heading: string
  title: string
  text?: string
  report?: BuildReportResponse
  currentReadiness?: CharacterResponse['buildReadiness']
}

const fallbackFrameCount = 120
const fallbackFrameRate = 24
type ClipMotionMode = 'inPlace' | 'rootMotion'

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

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const clipInputRef = useRef<HTMLInputElement>(null)
  const replaceClipInputRef = useRef<HTMLInputElement>(null)
  const timelineFrameRef = useRef(0)
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [timelineFrame, setTimelineFrame] = useState(0)
  const [loopStartFrame, setLoopStartFrame] = useState(0)
  const [loopEndFrame, setLoopEndFrame] = useState(-1)
  const [isTimelinePlaying, setIsTimelinePlaying] = useState(false)
  const [animationPreviewState, setAnimationPreviewState] = useState('none')
  const [clipMotionMode, setClipMotionMode] = useState<ClipMotionMode>('inPlace')
  const [clipContextMenu, setClipContextMenu] = useState<ClipContextMenu | null>(null)
  const [characterContextMenu, setCharacterContextMenu] = useState<CharacterContextMenu | null>(null)
  const [lastBuildReport, setLastBuildReport] = useState<BuildReportResponse | null>(null)
  const [textViewer, setTextViewer] = useState<TextViewer | null>(null)
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

  const stepTimeline = useCallback((delta: number) => {
    setIsTimelinePlaying(false)
    setTimelineFrame((current) => Math.min(Math.max(current + delta, 0), maxTimelineFrame))
  }, [maxTimelineFrame])

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
  }, [resetTimeline])

  const openClipContextMenu = useCallback((event: React.MouseEvent, characterId: string, clip: ClipResponse) => {
    event.preventDefault()
    selectClip(characterId, clip.id)
    setCharacterContextMenu(null)
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
    setCharacterContextMenu({
      characterId: character.id,
      characterName: character.name,
      x: event.clientX,
      y: event.clientY,
    })
  }, [selectCharacter])

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
    const handleTimelineKeys = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || !selectedClip) {
        return
      }

      if (event.code === 'Space') {
        setIsTimelinePlaying((current) => !current)
        event.preventDefault()
      }
      if (event.key.toLowerCase() === 'q' || event.key === 'ArrowLeft') {
        stepTimeline(event.shiftKey ? -10 : -1)
        event.preventDefault()
      }
      if (event.key.toLowerCase() === 'e' || event.key === 'ArrowRight') {
        stepTimeline(event.shiftKey ? 10 : 1)
        event.preventDefault()
      }
      if (event.key === 'Home') {
        setTimelineFrame(0)
        event.preventDefault()
      }
      if (event.key === 'End') {
        setTimelineFrame(maxTimelineFrame)
        event.preventDefault()
      }
    }

    window.addEventListener('keydown', handleTimelineKeys)
    return () => window.removeEventListener('keydown', handleTimelineKeys)
  }, [maxTimelineFrame, selectedClip, stepTimeline])

  useEffect(() => {
    if (!clipContextMenu && !characterContextMenu) {
      return
    }

    const closeMenu = () => {
      setClipContextMenu(null)
      setCharacterContextMenu(null)
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
  }, [characterContextMenu, clipContextMenu])

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

  function openBuildReportViewer(report: BuildReportResponse, currentReadiness: CharacterResponse['buildReadiness']) {
    setTextViewer({
      heading: 'Build Report',
      title: report.reportPath,
      report,
      currentReadiness,
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
                {(character.clips ?? []).map((clip) => (
                  <button
                    key={clip.id}
                    type="button"
                    className={`tree-item tree-item-clip ${selection?.type === 'clip' && clip.id === selection.clipId ? 'selected' : ''}`}
                    onClick={() => selectClip(character.id, clip.id)}
                    onContextMenu={(event) => openClipContextMenu(event, character.id, clip)}
                  >
                    {clipValidationIcon(clip)}
                    <span>{clip.name}</span>
                  </button>
                ))}
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
          label={selectedClip ? `${selectedCharacter?.name ?? 'Character'} / ${selectedClip.name}` : selectedCharacter?.name ?? 'Empty scene'}
          onClipMotionModeChange={setClipMotionMode}
          onAnimationStateChange={setAnimationPreviewState}
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
            hasBuildReport={Boolean((lastBuildReport?.characterId === selectedCharacter.id && lastBuildReport) || selectedCharacter.buildReportPath)}
            onGenerateBuildReport={() => handleGenerateBuildReport(selectedCharacter)}
            onViewBuildReport={() => handleViewBuildReport(selectedCharacter)}
            onSelectClip={(clipId) => selectClip(selectedCharacter.id, clipId)}
          />
        ) : (
          <div className="inspector-empty">
            Select a character or imported asset.
          </div>
        )}
      </aside>

      <section className={`bottom-panel ${selectedClip ? 'has-timeline' : 'log-only'}`} aria-label="Timeline and logs">
        {selectedClip ? (
          <TimelinePanel
            clip={selectedClip}
            frame={visibleTimelineFrame}
            frameCount={timelineFrameCount}
            frameRate={timelineFrameRate}
            durationSeconds={selectedClip.durationSeconds}
            hasMetadata={hasClipTimelineMetadata}
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
      {textViewer ? (
        <TextModal
          heading={textViewer.heading}
          title={textViewer.title}
          text={textViewer.text}
          report={textViewer.report}
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
  currentReadiness,
  onClose,
}: {
  heading: string
  title: string
  text?: string
  report?: BuildReportResponse
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
        {report ? <BuildReportView report={report} currentReadiness={currentReadiness} /> : <pre className="report-modal-text">{text}</pre>}
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

function TimelinePanel({
  clip,
  frame,
  frameCount,
  frameRate,
  durationSeconds,
  hasMetadata,
  isPlaying,
  footContacts,
  onTogglePlay,
  onStep,
  onSeek,
  loopStartFrame,
  loopEndFrame,
  onSetLoopStart,
  onSetLoopEnd,
}: {
  clip: ClipResponse | null
  frame: number
  frameCount: number
  frameRate: number
  durationSeconds: number | null
  hasMetadata: boolean
  isPlaying: boolean
  footContacts: ClipResponse['footContacts']
  onTogglePlay: () => void
  onStep: (delta: number) => void
  onSeek: (frame: number) => void
  loopStartFrame: number
  loopEndFrame: number
  onSetLoopStart: (frame: number) => void
  onSetLoopEnd: (frame: number) => void
}) {
  const rulerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const maxFrame = Math.max(frameCount - 1, 0)
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
  const frameLabelStep = frameCount <= 40 ? 5 : Math.max(10, Math.ceil(frameCount / 8))
  const frameTicks = Array.from({ length: maxFrame + 1 }, (_, index) => index)
    .filter((index) => index === 0 || index === maxFrame || index % frameTickStep === 0)
    .map((index) => ({
      frame: index,
      label: index === 0 || index === maxFrame || index % frameLabelStep === 0 ? `${index + 1}` : null,
      left: `${maxFrame > 0 ? (index / maxFrame) * 100 : 0}%`,
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
    if (!clip) {
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
    <div className="timeline-strip">
      <div className="timeline-controls" aria-label="Timeline controls">
        <button type="button" disabled={!clip} onClick={() => onSeek(0)} title="First frame" aria-label="First frame">
          <StepBack size={14} aria-hidden="true" />
        </button>
        <button type="button" disabled={!clip} onClick={() => onStep(-1)} title="Previous frame" aria-label="Previous frame">
          <StepBack size={14} aria-hidden="true" />
        </button>
        <button type="button" disabled={!clip} onClick={onTogglePlay} title={isPlaying ? 'Pause' : 'Play'} aria-label={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
        </button>
        <button type="button" disabled={!clip} onClick={() => onStep(1)} title="Next frame" aria-label="Next frame">
          <StepForward size={14} aria-hidden="true" />
        </button>
        <button type="button" disabled={!clip} onClick={() => onSeek(maxFrame)} title="Last frame" aria-label="Last frame">
          <StepForward size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="timeline-meta">
        <span className="timeline-clip-name">{clip ? clip.name : 'No clip selected'}</span>
        <span>{clip ? `${formatTimelineTime(currentSeconds)} / ${formatTimelineTime(displayDurationSeconds)}${metadataSuffix}` : '--:--'}</span>
      </div>
      <div
        ref={rulerRef}
        className={`timeline-ruler ${isDragging ? 'dragging' : ''}`}
        role="slider"
        aria-label="Timeline scrubber"
        aria-valuemin={clip ? 1 : 0}
        aria-valuemax={clip ? frameCount : 0}
        aria-valuenow={clip ? frame + 1 : 0}
        aria-valuetext={clip ? `Frame ${frame + 1} of ${frameCount}` : undefined}
        tabIndex={clip ? 0 : -1}
        onPointerDown={(event) => {
          if (!clip) {
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
          if (!clip) {
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
        <div className="timeline-loop-range" style={{ left: loopStartProgress, right: `calc(100% - ${loopEndProgress})` }} />
        <div className="timeline-loop-marker start" style={{ left: loopStartProgress }} />
        <div className="timeline-loop-marker end" style={{ left: loopEndProgress }} />
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
            if (!clip) {
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
          <span className="timeline-playhead-frame">{frame + 1}</span>
        </div>
      </div>
      <div className="timeline-readout" aria-label="Timeline readout">
        <label className="frame-input-label">
          F
          <input
            type="number"
            min={1}
            max={frameCount}
            disabled={!clip}
            value={clip ? frame + 1 : ''}
            onChange={(event) => {
              const nextFrame = Number.parseInt(event.target.value, 10)
              if (Number.isFinite(nextFrame)) {
                onSeek(nextFrame - 1)
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.currentTarget.blur()
              }
            }}
          />
          /{clip ? frameCount : '--'}
        </label>
        <span>{clip ? `${frameRate.toFixed(2)} fps` : '-- fps'}</span>
        <span>{clip ? `L ${loopStartFrame + 1}-${loopEndFrame + 1}` : 'L --'}</span>
        <span className="timeline-range-actions">
          <button type="button" disabled={!clip} onClick={() => onSetLoopStart(frame)}>In</button>
          <button type="button" disabled={!clip} onClick={() => onSetLoopEnd(frame)}>Out</button>
        </span>
      </div>
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

function formatBuildReportStatus(status: CharacterResponse['buildReportStatus']) {
  if (status === 'current') {
    return 'Report current'
  }

  if (status === 'outdated') {
    return 'Report outdated'
  }

  return 'No report'
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
  lastBuildReport,
  onGenerateBuildReport,
  onViewBuildReport,
  onSelectClip,
}: {
  character: CharacterResponse
  isBusy: boolean
  hasBuildReport: boolean
  lastBuildReport: BuildReportResponse | null
  onGenerateBuildReport: () => void
  onViewBuildReport: () => void
  onSelectClip: (clipId: string) => void
}) {
  return (
    <div className="inspector-content">
      <section className="inspector-section">
        <h2>{character.name}</h2>
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
      </dl>
        <button
          type="button"
          className="inspector-action"
          disabled={isBusy}
          onClick={onGenerateBuildReport}
        >
          {isBusy ? <Loader2 size={14} aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}
          Generate Build Report
        </button>
        <button
          type="button"
          className={`inspector-action report-status-${character.buildReportStatus}`}
          disabled={isBusy || !hasBuildReport}
          onClick={onViewBuildReport}
          title={formatBuildReportStatus(character.buildReportStatus)}
        >
          <FileText size={14} aria-hidden="true" />
          {lastBuildReport ? 'View Report' : character.buildReportPath ? 'Load Report' : 'View Report'}
        </button>
      </section>
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
    </div>
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
