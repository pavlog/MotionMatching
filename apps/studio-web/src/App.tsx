import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Box as BoxIcon, CheckCircle2, CirclePlus, FileText, Film, ListTree, Loader2, Pause, Play, StepBack, StepForward, TerminalSquare, Trash2, TriangleAlert } from 'lucide-react'
import {
  type ClipResponse,
  type CharacterResponse,
  type WorkspaceResponse,
  createBrowserWorkspace,
  deleteClip,
  openBrowserWorkspace,
  resolveAssetUrl,
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

const fallbackFrameCount = 120
const fallbackFrameRate = 24
type ClipMotionMode = 'inPlace' | 'rootMotion'

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const clipInputRef = useRef<HTMLInputElement>(null)
  const timelineFrameRef = useRef(0)
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [timelineFrame, setTimelineFrame] = useState(0)
  const [isTimelinePlaying, setIsTimelinePlaying] = useState(false)
  const [animationPreviewState, setAnimationPreviewState] = useState('none')
  const [clipMotionMode, setClipMotionMode] = useState<ClipMotionMode>('inPlace')
  const [clipContextMenu, setClipContextMenu] = useState<ClipContextMenu | null>(null)
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
  const hasClipTimelineMetadata = Boolean(selectedClip?.frameCount && selectedClip.frameRate && selectedClip.durationSeconds)

  useEffect(() => {
    timelineFrameRef.current = visibleTimelineFrame
  }, [visibleTimelineFrame])

  const appendLog = useCallback((message: string, level: LogEntry['level'] = 'info') => {
    setLogs((current) => [
      ...current.slice(-4),
      {
        id: Date.now() + Math.random(),
        level,
        message,
      },
    ])
  }, [])

  const stepTimeline = useCallback((delta: number) => {
    setIsTimelinePlaying(false)
    setTimelineFrame((current) => Math.min(Math.max(current + delta, 0), maxTimelineFrame))
  }, [maxTimelineFrame])

  const resetTimeline = useCallback(() => {
    setTimelineFrame(0)
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
    setClipContextMenu({
      characterId,
      clipId: clip.id,
      clipName: clip.name,
      x: event.clientX,
      y: event.clientY,
    })
  }, [selectClip])

  useEffect(() => {
    if (!isTimelinePlaying || !selectedClip || maxTimelineFrame <= 0) {
      return
    }

    const startFrame = timelineFrameRef.current
    const startTime = window.performance.now()
    const frameSpan = maxTimelineFrame + 1
    let animationFrameId = 0
    let lastFrame = startFrame

    const tick = (now: number) => {
      const elapsedSeconds = (now - startTime) / 1000
      const elapsedFrames = Math.floor(elapsedSeconds * timelineFrameRate)
      const nextFrame = (startFrame + elapsedFrames) % frameSpan

      if (nextFrame !== lastFrame) {
        lastFrame = nextFrame
        setTimelineFrame(nextFrame)
      }

      animationFrameId = window.requestAnimationFrame(tick)
    }

    animationFrameId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(animationFrameId)
  }, [isTimelinePlaying, maxTimelineFrame, selectedClip, timelineFrameRate])

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
    if (!clipContextMenu) {
      return
    }

    const closeMenu = () => setClipContextMenu(null)
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setClipContextMenu(null)
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
  }, [clipContextMenu])

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
    } catch (error) {
      appendLog(error instanceof Error ? error.message : 'Clip import failed', 'error')
    } finally {
      setIsBusy(false)
      if (clipInputRef.current) {
        clipInputRef.current.value = ''
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
          <ClipInspector character={selectedCharacter} clip={selectedClip} animationPreviewState={animationPreviewState} clipMotionMode={clipMotionMode} />
        ) : selectedCharacter ? (
          <CharacterInspector character={selectedCharacter} />
        ) : (
          <div className="inspector-empty">
            Select a character or imported asset.
          </div>
        )}
      </aside>

      <section className="bottom-panel" aria-label="Timeline and logs">
        <TimelinePanel
          clip={selectedClip}
          frame={visibleTimelineFrame}
          frameCount={timelineFrameCount}
          frameRate={timelineFrameRate}
          hasMetadata={hasClipTimelineMetadata}
          isPlaying={isTimelinePlaying}
          onTogglePlay={() => selectedClip && setIsTimelinePlaying((current) => !current)}
          onStep={stepTimeline}
          onSeek={(frame) => {
            setTimelineFrame(frame)
            setIsTimelinePlaying(false)
          }}
        />
        <div className="log-strip">
          <TerminalSquare size={15} aria-hidden="true" />
          <div className="log-lines">
            {logs.map((entry) => (
              <span key={entry.id} className={`log-line ${entry.level}`}>
                {entry.message}
              </span>
            ))}
          </div>
        </div>
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
    </main>
  )
}

function TimelinePanel({
  clip,
  frame,
  frameCount,
  frameRate,
  hasMetadata,
  isPlaying,
  onTogglePlay,
  onStep,
  onSeek,
}: {
  clip: ClipResponse | null
  frame: number
  frameCount: number
  frameRate: number
  hasMetadata: boolean
  isPlaying: boolean
  onTogglePlay: () => void
  onStep: (delta: number) => void
  onSeek: (frame: number) => void
}) {
  const [isDragging, setIsDragging] = useState(false)
  const maxFrame = Math.max(frameCount - 1, 0)
  const progress = `${maxFrame > 0 ? (frame / maxFrame) * 100 : 0}%`
  const displayDurationSeconds = frameCount / Math.max(frameRate, 1)
  const currentSeconds = frame / Math.max(frameRate, 1)
  const metadataSuffix = hasMetadata ? '' : ' estimated'
  const seekFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!clip) {
      return
    }

    const bounds = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - bounds.left) / Math.max(bounds.width, 1)
    onSeek(Math.round(Math.min(Math.max(ratio, 0), 1) * maxFrame))
  }

  return (
    <div className="timeline-strip">
      <div className="timeline-controls" aria-label="Timeline controls">
        <button type="button" disabled={!clip} onClick={() => onStep(-1)} title="Previous frame" aria-label="Previous frame">
          <StepBack size={14} aria-hidden="true" />
        </button>
        <button type="button" disabled={!clip} onClick={onTogglePlay} title={isPlaying ? 'Pause' : 'Play'} aria-label={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
        </button>
        <button type="button" disabled={!clip} onClick={() => onStep(1)} title="Next frame" aria-label="Next frame">
          <StepForward size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="timeline-meta">
        <span className="timeline-clip-name">{clip ? clip.name : 'No clip selected'}</span>
        <span>{clip ? `${formatTimelineTime(currentSeconds)} / ${formatTimelineTime(displayDurationSeconds)}${metadataSuffix}` : '--:--'}</span>
      </div>
      <div
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
        <div className="timeline-fill" style={{ width: progress }} />
        <div className="timeline-playhead" style={{ left: progress }}>
          <span className="timeline-playhead-handle" />
        </div>
      </div>
      <div className="timeline-readout" aria-label="Timeline readout">
        <span>{clip ? `F ${frame + 1}/${frameCount}` : 'F --'}</span>
        <span>{clip ? `${frameRate.toFixed(2)} fps` : '-- fps'}</span>
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
}: {
  character: CharacterResponse
  clip: ClipResponse
  animationPreviewState: string
  clipMotionMode: ClipMotionMode
}) {
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
          <dd>{clip.includeInBuild ? 'Included' : 'Excluded'}</dd>
          <dt>Timeline</dt>
          <dd>{clip.frameCount && clip.frameRate && clip.durationSeconds ? `${clip.frameCount} frames, ${clip.frameRate.toFixed(2)} fps, ${clip.durationSeconds.toFixed(2)}s` : 'Not parsed yet'}</dd>
          <dt>Preview</dt>
          <dd>{clip.previewUrl ? 'Animation cache ready' : 'No animation cache'}</dd>
          <dt>Retarget</dt>
          <dd>{formatAnimationPreviewState(animationPreviewState)}</dd>
          <dt>Motion</dt>
          <dd>{clipMotionMode === 'rootMotion' ? 'Root motion' : 'In-place'}</dd>
        </dl>
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

function formatRootMotionDelta(rootMotion: NonNullable<ClipResponse['rootMotion']>) {
  return `X ${formatNumber(rootMotion.displacementX)}, Y ${formatNumber(rootMotion.displacementY)}, Z ${formatNumber(rootMotion.displacementZ)}`
}

function formatNumber(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : '--'
}

function CharacterInspector({ character }: { character: CharacterResponse }) {
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
        </dl>
      </section>
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
    </div>
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
