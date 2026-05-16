import { useCallback, useEffect, useRef, useState } from 'react'
import { Footprints, Move3D, Scan } from 'lucide-react'
import {
  Animation,
  AnimationGroup,
  ArcRotateCamera,
  Bone,
  Camera,
  Color3,
  Color4,
  DynamicTexture,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  PointerEventTypes,
  Quaternion,
  Scene,
  SceneLoader,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core'
import '@babylonjs/loaders/glTF'
import type { FootContactDiagnosticsResponse, RuntimePoseSampleResponse, SamplingQueryResponse } from './api'

interface BabylonViewportProps {
  previewUrl: string | null
  clipPreviewUrl: string | null
  clipFrame: number | null
  clipFrameCount: number | null
  clipFrameRate: number | null
  clipDurationSeconds: number | null
  footContacts: FootContactDiagnosticsResponse | null
  clipMotionMode: ClipMotionMode
  samplingPreview: boolean
  samplingQuery: SamplingQueryResponse | null
  samplingGhostPose: RuntimePoseSampleResponse | null
  label: string
  onClipMotionModeChange?: (mode: ClipMotionMode) => void
  onAnimationStateChange?: (state: string) => void
  onSamplingQueryChange?: (query: SamplingQueryResponse) => void
}

type CameraView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso'
type AxisName = 'x' | 'negX' | 'y' | 'negY' | 'z' | 'negZ'
type FootName = 'left' | 'right'
type ClipMotionMode = 'inPlace' | 'rootMotion'
type PoseTarget = Bone | TransformNode
type PoseSnapshot = {
  position: Vector3
  rotation: Vector3
  rotationQuaternion: Quaternion | null
  scaling: Vector3
}
type ViewportStatus =
  | { kind: 'empty'; message: string }
  | { kind: 'loading'; message: string }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }
type SamplingDragState = {
  kind: 'trajectory'
  index: number
  marker: Mesh
} | {
  kind: 'facing'
  marker: Mesh
} | {
  kind: 'capsuleHeight' | 'capsuleRadius'
  marker: Mesh
  startClientX: number
  startClientY: number
  startHeight: number
  startRadius: number
}

const isoViewDirection = new Vector3(-1, 0.8, -1).normalize()

function getPerspectiveHalfHeight(camera: ArcRotateCamera, radius: number) {
  return Math.max(radius * Math.tan(camera.fov * 0.5), 0.01)
}

export function BabylonViewport({
  previewUrl,
  clipPreviewUrl,
  clipFrame,
  clipFrameCount,
  clipFrameRate,
  clipDurationSeconds,
  footContacts,
  clipMotionMode,
  samplingPreview,
  samplingQuery,
  samplingGhostPose,
  label,
  onClipMotionModeChange,
  onAnimationStateChange,
  onSamplingQueryChange,
}: BabylonViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sceneRef = useRef<Scene | null>(null)
  const cameraRef = useRef<ArcRotateCamera | null>(null)
  const axisTriadRef = useRef<SVGSVGElement | null>(null)
  const importedMeshesRef = useRef<Mesh[]>([])
  const clipSourceNodesRef = useRef<TransformNode[]>([])
  const clipAnimationRef = useRef<AnimationGroup | null>(null)
  const footContactsRef = useRef<FootContactDiagnosticsResponse | null>(null)
  const showFootContactsRef = useRef(true)
  const contactMarkersRef = useRef<Partial<Record<FootName, Mesh>>>({})
  const samplingPreviewMeshesRef = useRef<Mesh[]>([])
  const samplingGhostPoseMeshesRef = useRef<Mesh[]>([])
  const samplingPreviewRef = useRef(samplingPreview)
  const samplingQueryRef = useRef<SamplingQueryResponse | null>(samplingQuery)
  const samplingDragRef = useRef<SamplingDragState | null>(null)
  const onSamplingQueryChangeRef = useRef<typeof onSamplingQueryChange>(onSamplingQueryChange)
  const characterPoseRef = useRef(new Map<PoseTarget, PoseSnapshot>())
  const clipScrubRef = useRef({ frame: clipFrame, frameCount: clipFrameCount, frameRate: clipFrameRate, durationSeconds: clipDurationSeconds })
  const [cameraMode, setCameraMode] = useState<'perspective' | 'orthographic'>('perspective')
  const [status, setStatus] = useState<ViewportStatus>({ kind: 'empty', message: 'Empty scene' })
  const [animationState, setAnimationState] = useState('none')
  const [showFootContacts, setShowFootContacts] = useState(true)
  const [modelVersion, setModelVersion] = useState(0)
  const statusText = status.kind === 'ready' ? label : status.message

  useEffect(() => {
    clipScrubRef.current = { frame: clipFrame, frameCount: clipFrameCount, frameRate: clipFrameRate, durationSeconds: clipDurationSeconds }
  }, [clipFrame, clipFrameCount, clipFrameRate, clipDurationSeconds])

  useEffect(() => {
    footContactsRef.current = footContacts
  }, [footContacts])

  useEffect(() => {
    showFootContactsRef.current = showFootContacts
    if (!showFootContacts) {
      hideContactMarkers(contactMarkersRef.current)
    }
  }, [showFootContacts])

  useEffect(() => {
    onAnimationStateChange?.(animationState)
  }, [animationState, onAnimationStateChange])

  useEffect(() => {
    samplingPreviewRef.current = samplingPreview
    samplingQueryRef.current = samplingQuery
    onSamplingQueryChangeRef.current = onSamplingQueryChange
  }, [onSamplingQueryChange, samplingPreview, samplingQuery])

  const applyClipFrame = useCallback((animationGroup: AnimationGroup) => {
    const { frame, frameCount, frameRate } = clipScrubRef.current
    if (frame === null || !frameCount || frameCount <= 1 || !frameRate || frameRate <= 0) {
      return
    }

    const from = animationGroup.from
    const to = animationGroup.to
    const ratio = Math.min(Math.max(frame / (frameCount - 1), 0), 1)
    const targetFrame = from + (to - from) * ratio
    animationGroup.goToFrame(targetFrame)
    animationGroup.pause()
  }, [])

  const restoreCharacterPose = useCallback(() => {
    for (const [target, pose] of characterPoseRef.current) {
      target.position = pose.position.clone()
      target.rotation = pose.rotation.clone()
      target.rotationQuaternion = pose.rotationQuaternion?.clone() ?? null
      target.scaling = pose.scaling.clone()
      if (target instanceof Bone) {
        target.markAsDirty()
      }
    }
  }, [])

  const updateOrthographicBounds = useCallback((explicitRadius?: number) => {
    const camera = cameraRef.current
    const canvas = canvasRef.current
    if (!camera || !canvas || camera.mode !== Camera.ORTHOGRAPHIC_CAMERA) {
      return
    }

    const radius = explicitRadius ?? camera.radius
    const halfHeight = getPerspectiveHalfHeight(camera, radius)
    const width = Math.max(canvas.clientWidth, 1)
    const height = Math.max(canvas.clientHeight, 1)
    const aspect = width / height
    camera.orthoTop = halfHeight
    camera.orthoBottom = -halfHeight
    camera.orthoLeft = -halfHeight * aspect
    camera.orthoRight = halfHeight * aspect
  }, [])

  const frameMeshes = useCallback(() => {
    const camera = cameraRef.current
    const meshes = importedMeshesRef.current.filter((mesh) => mesh.getTotalVertices() > 0)
    if (!camera || meshes.length === 0) {
      return
    }

    const min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY)
    const max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY)

    for (const mesh of meshes) {
      const bounds = mesh.getHierarchyBoundingVectors(true)
      min.minimizeInPlace(bounds.min)
      max.maximizeInPlace(bounds.max)
    }

    const center = min.add(max).scale(0.5)
    const radius = Math.max(Vector3.Distance(min, max) * 0.7, 10)
    camera.setTarget(center)
    camera.radius = radius
    updateOrthographicBounds(radius)
  }, [updateOrthographicBounds])

  const updateNavigationWidget = useCallback(() => {
    const camera = cameraRef.current
    if (!camera) {
      return
    }

    const axisTriad = axisTriadRef.current
    if (!axisTriad) {
      return
    }

    const viewMatrix = camera.getViewMatrix()
    const origin = 48
    const scale = 22
    const labelDistance = 9
    const axes: Record<AxisName, Vector3> = {
      x: Vector3.Right(),
      negX: Vector3.Left(),
      y: Vector3.Up(),
      negY: Vector3.Down(),
      z: Vector3.Forward(),
      negZ: Vector3.Backward(),
    }

    for (const [axis, vector] of Object.entries(axes) as Array<[AxisName, Vector3]>) {
      const projected = Vector3.TransformNormal(vector, viewMatrix).normalize()
      const endX = origin + projected.x * scale
      const endY = origin - projected.y * scale
      const labelX = origin + projected.x * (scale + labelDistance)
      const labelY = origin - projected.y * (scale + labelDistance)
      const lineOpacity = '1'
      const buttonOpacity = '1'
      const line = axisTriad.querySelector<SVGLineElement>(`[data-axis-line="${axis}"]`)
      const clickLine = axisTriad.querySelector<SVGLineElement>(`[data-axis-hit-line="${axis}"]`)
      const hitTarget = axisTriad.querySelector<SVGCircleElement>(`[data-axis-hit="${axis}"]`)
      const labelElement = axisTriad.querySelector<SVGTextElement>(`[data-axis-label="${axis}"]`)
      const button = axisTriad.querySelector<SVGGElement>(`[data-axis-button="${axis}"]`)

      line?.setAttribute('x2', endX.toFixed(1))
      line?.setAttribute('y2', endY.toFixed(1))
      line?.style.setProperty('opacity', lineOpacity)
      clickLine?.setAttribute('x2', labelX.toFixed(1))
      clickLine?.setAttribute('y2', labelY.toFixed(1))
      hitTarget?.setAttribute('cx', labelX.toFixed(1))
      hitTarget?.setAttribute('cy', labelY.toFixed(1))
      labelElement?.setAttribute('x', labelX.toFixed(1))
      labelElement?.setAttribute('y', labelY.toFixed(1))
      button?.style.setProperty('opacity', buttonOpacity)
    }
  }, [])

  const setCameraView = useCallback((view: CameraView) => {
    const camera = cameraRef.current
    if (!camera) {
      return
    }

    const target = camera.target.clone()
    const radius = camera.radius
    const views: Record<CameraView, Vector3> = {
      front: Vector3.Forward(),
      back: Vector3.Backward(),
      left: Vector3.Left(),
      right: Vector3.Right(),
      top: Vector3.Up(),
      bottom: Vector3.Down(),
      iso: isoViewDirection,
    }

    camera.setPosition(target.add(views[view].scale(radius)))
    updateOrthographicBounds()
    updateNavigationWidget()
  }, [updateNavigationWidget, updateOrthographicBounds])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    const engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
    })
    const scene = new Scene(engine)
    scene.clearColor = new Color4(0.055, 0.06, 0.07, 1)

    const camera = new ArcRotateCamera('viewport-camera', Math.PI * 0.25, Math.PI * 0.35, 240, new Vector3(0, 80, 0), scene)
    camera.setPosition(camera.target.add(isoViewDirection.scale(camera.radius)))
    camera.lowerRadiusLimit = 10
    camera.upperRadiusLimit = 1200
    camera.wheelDeltaPercentage = 0.01
    camera.panningSensibility = 90
    camera.attachControl(canvas, true)

    const light = new HemisphericLight('viewport-light', new Vector3(0.2, 1, 0.4), scene)
    light.intensity = 0.9
    scene.ambientColor = new Color3(0.8, 0.82, 0.86)
    createGroundGrid(scene)

    sceneRef.current = scene
    cameraRef.current = camera

    const handleResize = () => {
      engine.resize()
      updateOrthographicBounds()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      const speed = event.shiftKey ? 14 : 7
      const forward = camera.getForwardRay().direction
      const right = Vector3.Cross(forward, Vector3.Up()).normalize()
      const delta = new Vector3(0, 0, 0)

      if (event.key.toLowerCase() === 'w') delta.addInPlace(forward.scale(speed))
      if (event.key.toLowerCase() === 's') delta.addInPlace(forward.scale(-speed))
      if (event.key.toLowerCase() === 'a') delta.addInPlace(right.scale(-speed))
      if (event.key.toLowerCase() === 'd') delta.addInPlace(right.scale(speed))
      if (event.key.toLowerCase() === 'f') frameMeshes()

      if (event.code === 'Numpad1') {
        setCameraView('front')
        event.preventDefault()
        return
      }
      if (event.code === 'Numpad3') {
        setCameraView('right')
        event.preventDefault()
        return
      }
      if (event.code === 'Numpad7') {
        setCameraView('top')
        event.preventDefault()
        return
      }
      if (event.code === 'Numpad5') {
        setCameraMode((current) => current === 'perspective' ? 'orthographic' : 'perspective')
        event.preventDefault()
        return
      }

      if (!delta.equals(Vector3.Zero())) {
        camera.target.addInPlace(delta)
        camera.position.addInPlace(delta)
        event.preventDefault()
      }
    }
    const pointerObserver = scene.onPointerObservable.add((pointerInfo) => {
      if (!samplingPreviewRef.current || !samplingQueryRef.current) {
        return
      }

      if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
        const pickedMesh = pointerInfo.pickInfo?.pickedMesh
        const pointerEvent = pointerInfo.event as PointerEvent
        const trajectoryIndex = typeof pickedMesh?.metadata?.samplingTrajectoryIndex === 'number'
          ? pickedMesh.metadata.samplingTrajectoryIndex as number
          : null
        if (!(pickedMesh instanceof Mesh)) {
          return
        }

        if (trajectoryIndex !== null) {
          samplingDragRef.current = { kind: 'trajectory', index: trajectoryIndex, marker: pickedMesh }
          camera.detachControl()
          pointerInfo.event.preventDefault()
          return
        }

        const dragKind = pickedMesh.metadata?.samplingDragKind
        const currentQuery = samplingQueryRef.current
        if (dragKind === 'facing') {
          samplingDragRef.current = { kind: 'facing', marker: pickedMesh }
          camera.detachControl()
          pointerInfo.event.preventDefault()
          return
        }

        if ((dragKind === 'capsuleHeight' || dragKind === 'capsuleRadius') && currentQuery) {
          samplingDragRef.current = {
            kind: dragKind,
            marker: pickedMesh,
            startClientX: pointerEvent.clientX,
            startClientY: pointerEvent.clientY,
            startHeight: currentQuery.capsule.height,
            startRadius: currentQuery.capsule.radius,
          }
          camera.detachControl()
          pointerInfo.event.preventDefault()
          return
        }
      }

      if (pointerInfo.type === PointerEventTypes.POINTERMOVE && samplingDragRef.current) {
        const drag = samplingDragRef.current
        const pointerEvent = pointerInfo.event as PointerEvent
        if (drag.kind === 'capsuleHeight') {
          const nextHeight = Math.max(drag.startRadius * 2 + 1, drag.startHeight - (pointerEvent.clientY - drag.startClientY) * 0.35)
          drag.marker.position.y = nextHeight - drag.startRadius
          pointerInfo.event.preventDefault()
          return
        }

        if (drag.kind === 'capsuleRadius') {
          const nextRadius = Math.max(1, Math.min(drag.startHeight * 0.49, drag.startRadius + (pointerEvent.clientX - drag.startClientX) * 0.18))
          drag.marker.position.x = nextRadius
          pointerInfo.event.preventDefault()
          return
        }

        const point = pickSamplingDragPoint(scene)
        if (!point) {
          return
        }

        if (drag.kind === 'facing') {
          const direction = new Vector3(point.x, 0, point.z)
          if (direction.lengthSquared() > 0.0001) {
            const normalized = direction.normalize()
            const radius = Math.max((samplingQueryRef.current?.capsule.radius ?? 14) * 3.5, 24)
            drag.marker.position.x = normalized.x * radius
            drag.marker.position.z = normalized.z * radius
          }
          pointerInfo.event.preventDefault()
          return
        }

        drag.marker.position.x = point.x
        drag.marker.position.z = point.z
        pointerInfo.event.preventDefault()
        return
      }

      if (pointerInfo.type === PointerEventTypes.POINTERUP && samplingDragRef.current) {
        const drag = samplingDragRef.current
        samplingDragRef.current = null
        camera.attachControl(canvas, true)
        const currentQuery = samplingQueryRef.current
        if (!currentQuery) {
          return
        }

        if (drag.kind === 'trajectory') {
          const nextTrajectory = currentQuery.trajectory.map((point, index) =>
            index === drag.index
              ? {
                  ...point,
                  position: [
                    Number(drag.marker.position.x.toFixed(2)),
                    0,
                    Number(drag.marker.position.z.toFixed(2)),
                  ],
                }
              : point,
          )
          onSamplingQueryChangeRef.current?.({
            ...currentQuery,
            trajectory: nextTrajectory,
          })
        } else if (drag.kind === 'facing') {
          const direction = new Vector3(drag.marker.position.x, 0, drag.marker.position.z)
          const normalized = direction.lengthSquared() > 0.0001 ? direction.normalize() : new Vector3(0, 0, 1)
          onSamplingQueryChangeRef.current?.({
            ...currentQuery,
            facing: [
              Number(normalized.x.toFixed(3)),
              0,
              Number(normalized.z.toFixed(3)),
            ],
          })
        } else if (drag.kind === 'capsuleHeight') {
          onSamplingQueryChangeRef.current?.({
            ...currentQuery,
            capsule: {
              ...currentQuery.capsule,
              height: Number(Math.max(currentQuery.capsule.radius * 2 + 1, drag.marker.position.y + currentQuery.capsule.radius).toFixed(2)),
            },
          })
        } else if (drag.kind === 'capsuleRadius') {
          onSamplingQueryChangeRef.current?.({
            ...currentQuery,
            capsule: {
              ...currentQuery.capsule,
              radius: Number(Math.max(1, Math.min(currentQuery.capsule.height * 0.49, drag.marker.position.x)).toFixed(2)),
            },
          })
        }
        pointerInfo.event.preventDefault()
      }
    })

    window.addEventListener('resize', handleResize)
    window.addEventListener('keydown', handleKeyDown)
    engine.runRenderLoop(() => {
      updateOrthographicBounds()
      updateNavigationWidget()
      updateContactMarkers(scene, clipScrubRef.current, footContactsRef.current, contactMarkersRef.current, showFootContactsRef.current)
      scene.render()
    })

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('keydown', handleKeyDown)
      scene.onPointerObservable.remove(pointerObserver)
      importedMeshesRef.current = []
      clipAnimationRef.current?.dispose()
      clipAnimationRef.current = null
      for (const node of clipSourceNodesRef.current) {
        node.dispose(false, true)
      }
      clipSourceNodesRef.current = []
      for (const marker of Object.values(contactMarkersRef.current)) {
        marker?.dispose(false, true)
      }
      contactMarkersRef.current = {}
      disposeSamplingPreview(samplingPreviewMeshesRef.current)
      samplingPreviewMeshesRef.current = []
      disposeSamplingPreview(samplingGhostPoseMeshesRef.current)
      samplingGhostPoseMeshesRef.current = []
      scene.dispose()
      engine.dispose()
      sceneRef.current = null
      cameraRef.current = null
    }
  }, [frameMeshes, setCameraView, updateNavigationWidget, updateOrthographicBounds])

  useEffect(() => {
    const camera = cameraRef.current
    if (!camera) {
      return
    }

    camera.mode = cameraMode === 'orthographic'
      ? Camera.ORTHOGRAPHIC_CAMERA
      : Camera.PERSPECTIVE_CAMERA
    updateOrthographicBounds()
  }, [cameraMode, updateOrthographicBounds])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) {
      return
    }

    const sceneForPreview: Scene = scene
    let cancelled = false
    async function loadPreview() {
      clipAnimationRef.current?.dispose()
      clipAnimationRef.current = null
      for (const node of clipSourceNodesRef.current) {
        node.dispose(false, true)
      }
      clipSourceNodesRef.current = []
      characterPoseRef.current.clear()

      for (const mesh of importedMeshesRef.current) {
        mesh.dispose(false, true)
      }
      importedMeshesRef.current = []

      if (!previewUrl) {
        setStatus({ kind: 'empty', message: 'Empty scene' })
        return
      }

      setStatus({ kind: 'loading', message: 'Loading preview' })
      try {
        const result = await SceneLoader.ImportMeshAsync('', '', previewUrl, sceneForPreview)
        if (cancelled) {
          for (const mesh of result.meshes) {
            mesh.dispose(false, true)
          }
          return
        }

        importedMeshesRef.current = result.meshes.filter((mesh): mesh is Mesh => mesh instanceof Mesh)
        characterPoseRef.current = createCharacterPoseSnapshot(sceneForPreview)
        setStatus({ kind: 'ready' })
        setModelVersion((current) => current + 1)
        frameMeshes()
      } catch (error) {
        setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Preview load failed' })
      }
    }

    loadPreview()
    return () => {
      cancelled = true
    }
  }, [frameMeshes, previewUrl])

  useEffect(() => {
    const scene = sceneRef.current
    const animationUrl = clipPreviewUrl
    if (!scene || !animationUrl || importedMeshesRef.current.length === 0) {
      clipAnimationRef.current?.dispose()
      clipAnimationRef.current = null
      restoreCharacterPose()
      setAnimationState('none')
      return
    }

    const sceneForClip: Scene = scene
    const animationUrlForClip: string = animationUrl
    let cancelled = false
    async function loadClipPreview() {
      clipAnimationRef.current?.dispose()
      clipAnimationRef.current = null
      restoreCharacterPose()
      setAnimationState('loading')
      for (const node of clipSourceNodesRef.current) {
        node.dispose(false, true)
      }
      clipSourceNodesRef.current = []

      const targetMap = buildAnimationTargetMap(sceneForClip)
      try {
        const result = await SceneLoader.ImportMeshAsync('', '', animationUrlForClip, sceneForClip)
        if (cancelled) {
          for (const node of result.transformNodes) {
            node.dispose(false, true)
          }
          for (const mesh of result.meshes) {
            mesh.dispose(false, true)
          }
          for (const group of result.animationGroups) {
            group.dispose()
          }
          return
        }

        clipSourceNodesRef.current = result.transformNodes.filter((node): node is TransformNode => node instanceof TransformNode)
        const sourceGroup = result.animationGroups[0]
        const retargeted = sourceGroup ? retargetAnimationGroup(sourceGroup, targetMap, clipMotionMode) : null
        for (const group of result.animationGroups) {
          group.dispose()
        }
        for (const node of clipSourceNodesRef.current) {
          node.dispose(false, true)
        }
        clipSourceNodesRef.current = []

        if (retargeted) {
          const { group: retargetedGroup, count } = retargeted
          retargetedGroup.stop()
          retargetedGroup.play(false)
          retargetedGroup.pause()
          clipAnimationRef.current = retargetedGroup
          applyClipFrame(retargetedGroup)
          setAnimationState(`applied:${count}`)
        } else {
          setAnimationState('unmatched')
        }
      } catch {
        clipAnimationRef.current = null
        setAnimationState('failed')
      }
    }

    loadClipPreview()
    return () => {
      cancelled = true
    }
  }, [applyClipFrame, clipMotionMode, clipPreviewUrl, modelVersion, restoreCharacterPose])

  useEffect(() => {
    const animationGroup = clipAnimationRef.current
    if (!animationGroup) {
      return
    }

    applyClipFrame(animationGroup)
  }, [applyClipFrame, clipFrame, clipFrameCount, clipFrameRate])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) {
      return
    }

    disposeSamplingPreview(samplingPreviewMeshesRef.current)
    samplingPreviewMeshesRef.current = []
    if (!samplingPreview) {
      return
    }

    samplingPreviewMeshesRef.current = createSamplingPreview(scene, samplingQuery)
  }, [modelVersion, samplingPreview, samplingQuery])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) {
      return
    }

    disposeSamplingPreview(samplingGhostPoseMeshesRef.current)
    samplingGhostPoseMeshesRef.current = []
    if (!samplingPreview || !samplingGhostPose) {
      return
    }

    samplingGhostPoseMeshesRef.current = createSamplingGhostPose(scene, samplingGhostPose)
  }, [modelVersion, samplingGhostPose, samplingPreview])

  return (
    <section className="viewport-panel" aria-label="3D viewport" data-animation-state={animationState}>
      <canvas ref={canvasRef} className="viewport-canvas" />
      <div className="viewport-status">{statusText}</div>
      <div className="viewport-toolbar" aria-label="Viewport tools">
        <button type="button" onClick={frameMeshes} title="Frame selection" aria-label="Frame selection">
          <Scan size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={clipMotionMode === 'rootMotion' ? 'active' : ''}
          disabled={!clipPreviewUrl}
          onClick={() => onClipMotionModeChange?.(clipMotionMode === 'rootMotion' ? 'inPlace' : 'rootMotion')}
          title={clipMotionMode === 'rootMotion' ? 'Root motion' : 'In-place'}
          aria-label="Toggle root motion"
          aria-pressed={clipMotionMode === 'rootMotion'}
        >
          <Move3D size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`foot-contact-toggle ${showFootContacts ? 'active' : ''}`}
          disabled={!footContacts || samplingPreview}
          onClick={() => setShowFootContacts((current) => !current)}
          title={showFootContacts ? 'Hide foot contacts' : 'Show foot contacts'}
          aria-label="Toggle foot contacts"
          aria-pressed={showFootContacts}
        >
          <Footprints size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="navigation-widget" aria-label="Viewport navigation">
        <svg ref={axisTriadRef} className="axis-triad" viewBox="0 0 96 96" role="group" aria-label="Axis view shortcuts">
          <line data-axis-line="negZ" className="axis-line z negative" x1="48" y1="48" x2="48" y2="48" />
          <line data-axis-line="negX" className="axis-line x negative" x1="48" y1="48" x2="48" y2="48" />
          <line data-axis-line="negY" className="axis-line y negative" x1="48" y1="48" x2="48" y2="48" />
          <line data-axis-line="z" className="axis-line z" x1="48" y1="48" x2="48" y2="48" />
          <line data-axis-line="x" className="axis-line x" x1="48" y1="48" x2="48" y2="48" />
          <line data-axis-line="y" className="axis-line y" x1="48" y1="48" x2="48" y2="48" />
          <line data-axis-hit-line="negZ" className="axis-click-line" x1="48" y1="48" x2="48" y2="48" onClick={() => setCameraView('back')} />
          <line data-axis-hit-line="negX" className="axis-click-line" x1="48" y1="48" x2="48" y2="48" onClick={() => setCameraView('left')} />
          <line data-axis-hit-line="negY" className="axis-click-line" x1="48" y1="48" x2="48" y2="48" onClick={() => setCameraView('bottom')} />
          <line data-axis-hit-line="z" className="axis-click-line" x1="48" y1="48" x2="48" y2="48" onClick={() => setCameraView('front')} />
          <line data-axis-hit-line="x" className="axis-click-line" x1="48" y1="48" x2="48" y2="48" onClick={() => setCameraView('right')} />
          <line data-axis-hit-line="y" className="axis-click-line" x1="48" y1="48" x2="48" y2="48" onClick={() => setCameraView('top')} />
          <circle className="axis-origin" cx="48" cy="48" r="2.4" />
          <g data-axis-button="negZ" className="axis-button z negative" onClick={() => setCameraView('back')} aria-label="Back view">
            <circle data-axis-hit="negZ" className="axis-hit axis-hit-negative" cx="48" cy="48" r="5.5" />
            <text data-axis-label="negZ" className="axis-label axis-label-hidden" x="48" y="48">Z</text>
          </g>
          <g data-axis-button="negX" className="axis-button x negative" onClick={() => setCameraView('left')} aria-label="Left view">
            <circle data-axis-hit="negX" className="axis-hit axis-hit-negative" cx="48" cy="48" r="5.5" />
            <text data-axis-label="negX" className="axis-label axis-label-hidden" x="48" y="48">X</text>
          </g>
          <g data-axis-button="negY" className="axis-button y negative" onClick={() => setCameraView('bottom')} aria-label="Bottom view">
            <circle data-axis-hit="negY" className="axis-hit axis-hit-negative" cx="48" cy="48" r="5.5" />
            <text data-axis-label="negY" className="axis-label axis-label-hidden" x="48" y="48">Y</text>
          </g>
          <g data-axis-button="z" className="axis-button z" onClick={() => setCameraView('front')} aria-label="Front view">
            <circle data-axis-hit="z" className="axis-hit" cx="48" cy="48" r="8.5" />
            <text data-axis-label="z" className="axis-label z" x="48" y="48">Z</text>
          </g>
          <g data-axis-button="x" className="axis-button x" onClick={() => setCameraView('right')} aria-label="Right view">
            <circle data-axis-hit="x" className="axis-hit" cx="48" cy="48" r="8.5" />
            <text data-axis-label="x" className="axis-label x" x="48" y="48">X</text>
          </g>
          <g data-axis-button="y" className="axis-button y" onClick={() => setCameraView('top')} aria-label="Top view">
            <circle data-axis-hit="y" className="axis-hit" cx="48" cy="48" r="8.5" />
            <text data-axis-label="y" className="axis-label y" x="48" y="48">Y</text>
          </g>
          <g className="axis-center-button" onClick={() => setCameraView('iso')} aria-label="Isometric view">
            <circle className="axis-center-hit" cx="48" cy="48" r="8" />
          </g>
        </svg>
        <button
          className="nav-camera-mode"
          type="button"
          onClick={() => setCameraMode((current) => current === 'perspective' ? 'orthographic' : 'perspective')}
        >
          {cameraMode === 'perspective' ? 'Persp' : 'Ortho'}
        </button>
      </div>
    </section>
  )
}

function createSamplingPreview(scene: Scene, samplingQuery: SamplingQueryResponse | null) {
  const meshes: Mesh[] = []
  const capsuleMaterial = new StandardMaterial('sampling-capsule-material', scene)
  capsuleMaterial.diffuseColor = new Color3(0.16, 0.62, 1)
  capsuleMaterial.emissiveColor = new Color3(0.05, 0.18, 0.3)
  capsuleMaterial.alpha = 0.26
  capsuleMaterial.disableDepthWrite = true

  const faceMaterial = new StandardMaterial('sampling-face-material', scene)
  faceMaterial.diffuseColor = new Color3(0.45, 0.92, 0.62)
  faceMaterial.emissiveColor = new Color3(0.16, 0.42, 0.24)

  const trajectoryMaterial = new StandardMaterial('sampling-trajectory-material', scene)
  trajectoryMaterial.diffuseColor = new Color3(1, 0.7, 0.22)
  trajectoryMaterial.emissiveColor = new Color3(0.4, 0.22, 0.04)

  const handleMaterial = new StandardMaterial('sampling-handle-material', scene)
  handleMaterial.diffuseColor = new Color3(0.92, 0.96, 1)
  handleMaterial.emissiveColor = new Color3(0.32, 0.44, 0.58)

  const capsuleHeight = Math.max(samplingQuery?.capsule.height ?? 72, 1)
  const capsuleRadius = Math.max(samplingQuery?.capsule.radius ?? 14, 1)
  const capsuleBodyHeight = Math.max(capsuleHeight - capsuleRadius * 2, 1)
  const capsuleBody = MeshBuilder.CreateCylinder('sampling-capsule-body', {
    height: capsuleBodyHeight,
    diameter: capsuleRadius * 2,
    tessellation: 32,
  }, scene)
  capsuleBody.position.y = capsuleBodyHeight * 0.5 + capsuleRadius
  capsuleBody.material = capsuleMaterial
  capsuleBody.isPickable = false
  meshes.push(capsuleBody)

  for (const [name, y] of [['top', capsuleHeight - capsuleRadius], ['bottom', capsuleRadius]] as const) {
    const cap = MeshBuilder.CreateSphere(`sampling-capsule-${name}`, {
      diameter: capsuleRadius * 2,
      segments: 24,
    }, scene)
    cap.position.y = y
    cap.material = capsuleMaterial
    cap.isPickable = name === 'top'
    if (name === 'top') {
      cap.metadata = { samplingDragKind: 'capsuleHeight' }
    }
    meshes.push(cap)
  }

  const radiusHandle = MeshBuilder.CreateSphere('sampling-capsule-radius-handle', {
    diameter: Math.max(capsuleRadius * 0.36, 5),
    segments: 16,
  }, scene)
  radiusHandle.position = new Vector3(capsuleRadius, capsuleRadius, 0)
  radiusHandle.material = handleMaterial
  radiusHandle.isPickable = true
  radiusHandle.metadata = { samplingDragKind: 'capsuleRadius' }
  meshes.push(radiusHandle)

  const facingDirection = vectorFromSamplingArray(samplingQuery?.facing, new Vector3(0, 0, 1))
  const normalizedFacing = facingDirection.lengthSquared() > 0.0001 ? facingDirection.normalize() : new Vector3(0, 0, 1)
  const faceStart = new Vector3(0, capsuleHeight * 0.4, 0)
  const faceEnd = faceStart.add(normalizedFacing.scale(Math.max(capsuleRadius * 3.5, 24)))
  const faceLine = MeshBuilder.CreateLines('sampling-face-direction-line', {
    points: [faceStart, faceEnd],
  }, scene)
  faceLine.color = new Color3(0.45, 0.92, 0.62)
  faceLine.isPickable = false
  meshes.push(faceLine)

  const faceHead = MeshBuilder.CreateSphere('sampling-face-direction-head', {
    diameter: Math.max(capsuleRadius * 0.55, 6),
    segments: 18,
  }, scene)
  faceHead.position = faceEnd
  faceHead.material = faceMaterial
  faceHead.isPickable = true
  faceHead.metadata = { samplingDragKind: 'facing' }
  meshes.push(faceHead)

  const trajectoryPoints = samplingQuery?.trajectory.length
    ? samplingQuery.trajectory.map((point) => vectorFromSamplingArray(point.position, Vector3.Zero()).add(new Vector3(0, 2, 0)))
    : [
        new Vector3(0, 2, 28),
        new Vector3(10, 2, 60),
        new Vector3(18, 2, 96),
      ]
  for (const [index, point] of trajectoryPoints.entries()) {
    const marker = MeshBuilder.CreateSphere(`sampling-trajectory-point-${index + 1}`, {
      diameter: 7,
      segments: 18,
    }, scene)
    marker.position = point
    marker.material = trajectoryMaterial
    marker.isPickable = true
    marker.metadata = { samplingTrajectoryIndex: index }
    meshes.push(marker)

    const frameOffset = samplingQuery?.trajectory[index]?.frameOffset ?? (index + 1) * 20
    meshes.push(createSamplingLabel(scene, `+${frameOffset}f`, point.add(new Vector3(0, 9, 0)), `sampling-trajectory-label-${index}`))
  }

  const trajectoryLine = MeshBuilder.CreateLines('sampling-trajectory-line', {
    points: [Vector3.Zero(), ...trajectoryPoints],
  }, scene)
  trajectoryLine.color = new Color3(1, 0.7, 0.22)
  trajectoryLine.isPickable = false
  meshes.push(trajectoryLine)

  const dragPlane = MeshBuilder.CreateGround('sampling-drag-plane', {
    width: 10000,
    height: 10000,
  }, scene)
  dragPlane.position.y = 2
  dragPlane.isPickable = true
  const dragPlaneMaterial = new StandardMaterial('sampling-drag-plane-material', scene)
  dragPlaneMaterial.alpha = 0.001
  dragPlaneMaterial.disableDepthWrite = true
  dragPlane.material = dragPlaneMaterial
  dragPlane.metadata = { samplingDragPlane: true }
  meshes.push(dragPlane)

  return meshes
}

function pickSamplingDragPoint(scene: Scene) {
  const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => Boolean(mesh.metadata?.samplingDragPlane))
  return pick?.hit && pick.pickedPoint ? pick.pickedPoint : null
}

function createSamplingLabel(scene: Scene, text: string, position: Vector3, name: string) {
  const texture = new DynamicTexture(`${name}-texture`, { width: 128, height: 48 }, scene, true)
  texture.hasAlpha = true
  texture.drawText(text, 10, 32, 'bold 24px Arial', '#f4f8ff', 'transparent', true)

  const material = new StandardMaterial(`${name}-material`, scene)
  material.diffuseTexture = texture
  material.emissiveTexture = texture
  material.opacityTexture = texture
  material.disableLighting = true
  material.disableDepthWrite = true

  const label = MeshBuilder.CreatePlane(name, { width: 18, height: 6.75 }, scene)
  label.position = position
  label.material = material
  label.isPickable = false
  label.billboardMode = Mesh.BILLBOARDMODE_ALL
  return label
}

function createSamplingGhostPose(scene: Scene, pose: RuntimePoseSampleResponse) {
  const meshes: Mesh[] = []
  const material = new StandardMaterial('sampling-ghost-pose-material', scene)
  material.diffuseColor = new Color3(0.76, 0.9, 1)
  material.emissiveColor = new Color3(0.18, 0.38, 0.58)
  material.alpha = 0.42
  material.disableDepthWrite = true

  const visibleBones = pose.bones
    .filter((bone) => bone.translation.length >= 3)
    .filter((bone) => !bone.boneName.toLowerCase().includes('end'))
    .slice(0, 72)
  const localOffsets = new Map(visibleBones.map((bone) => [normalizeGhostBoneName(bone.boneName), vectorFromSamplingArray(bone.translation, Vector3.Zero())]))
  const bonePositions = buildGhostBoneWorldPositions(localOffsets)
  const skeletonLines = buildGhostSkeletonLines(bonePositions)
  if (skeletonLines.length) {
    const skeleton = MeshBuilder.CreateLineSystem('sampling-ghost-pose-skeleton', { lines: skeletonLines }, scene)
    skeleton.color = new Color3(0.76, 0.9, 1)
    skeleton.alpha = 0.52
    skeleton.isPickable = false
    meshes.push(skeleton)
  }

  for (const [index, bone] of visibleBones.entries()) {
    const position = findGhostBonePosition(bonePositions, bone.boneName) ?? vectorFromSamplingArray(bone.translation, Vector3.Zero())
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) {
      continue
    }

    const marker = MeshBuilder.CreateSphere(`sampling-ghost-pose-${index}`, {
      diameter: isMainGhostBone(bone.boneName) ? 4.6 : 2.8,
      segments: 8,
    }, scene)
    marker.position = position
    marker.material = material
    marker.isPickable = false
    meshes.push(marker)
  }

  return meshes
}

function buildGhostBoneWorldPositions(localOffsets: Map<string, Vector3>) {
  const chains = [
    ['hips', 'spine', 'spine1', 'spine2', 'neck', 'head'],
    ['spine2', 'leftshoulder', 'leftarm', 'leftforearm', 'lefthand'],
    ['spine2', 'rightshoulder', 'rightarm', 'rightforearm', 'righthand'],
    ['hips', 'leftupleg', 'leftleg', 'leftfoot', 'lefttoebase'],
    ['hips', 'rightupleg', 'rightleg', 'rightfoot', 'righttoebase'],
  ]
  const worldPositions = new Map<string, Vector3>()
  const rootPosition = findGhostBonePosition(localOffsets, 'hips') ?? Vector3.Zero()
  worldPositions.set('hips', rootPosition.clone())

  for (const chain of chains) {
    let currentPosition = findGhostBonePosition(worldPositions, chain[0]) ?? rootPosition.clone()
    for (const bone of chain.slice(1)) {
      const localOffset = findGhostBonePosition(localOffsets, bone)
      if (!localOffset) {
        continue
      }

      currentPosition = currentPosition.add(localOffset)
      worldPositions.set(normalizeGhostBoneName(bone), currentPosition)
    }
  }

  return worldPositions.size > 1 ? worldPositions : localOffsets
}

function buildGhostSkeletonLines(bonePositions: Map<string, Vector3>) {
  const chains = [
    ['hips', 'spine', 'spine1', 'spine2', 'neck', 'head'],
    ['spine2', 'leftshoulder', 'leftarm', 'leftforearm', 'lefthand'],
    ['spine2', 'rightshoulder', 'rightarm', 'rightforearm', 'righthand'],
    ['hips', 'leftupleg', 'leftleg', 'leftfoot', 'lefttoebase'],
    ['hips', 'rightupleg', 'rightleg', 'rightfoot', 'righttoebase'],
  ]
  const lines: Vector3[][] = []

  for (const chain of chains) {
    let previous = findGhostBonePosition(bonePositions, chain[0])
    for (const bone of chain.slice(1)) {
      const current = findGhostBonePosition(bonePositions, bone)
      if (previous && current && Vector3.Distance(previous, current) > 0.001) {
        lines.push([previous, current])
      }

      previous = current ?? previous
    }
  }

  return lines
}

function findGhostBonePosition(bonePositions: Map<string, Vector3>, boneKey: string) {
  const normalizedBoneKey = normalizeGhostBoneName(boneKey)
  for (const [name, position] of bonePositions.entries()) {
    if (name.endsWith(normalizedBoneKey) || name.includes(normalizedBoneKey)) {
      return position
    }
  }

  return null
}

function normalizeGhostBoneName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isMainGhostBone(boneName: string) {
  const normalized = boneName.toLowerCase()
  return normalized.includes('hips') ||
    normalized.includes('pelvis') ||
    normalized.includes('spine') ||
    normalized.includes('head') ||
    normalized.includes('foot') ||
    normalized.includes('hand')
}

function vectorFromSamplingArray(values: number[] | undefined, fallback: Vector3) {
  if (!values || values.length < 3) {
    return fallback.clone()
  }

  return new Vector3(
    Number.isFinite(values[0]) ? values[0] : fallback.x,
    Number.isFinite(values[1]) ? values[1] : fallback.y,
    Number.isFinite(values[2]) ? values[2] : fallback.z,
  )
}

function disposeSamplingPreview(meshes: Mesh[]) {
  for (const mesh of meshes) {
    mesh.dispose(false, true)
  }
}

function updateContactMarkers(
  scene: Scene,
  scrub: { frame: number | null; frameCount: number | null; frameRate: number | null; durationSeconds: number | null },
  footContacts: FootContactDiagnosticsResponse | null,
  markers: Partial<Record<FootName, Mesh>>,
  showFootContacts: boolean,
) {
  if (!showFootContacts || !footContacts || scrub.frame === null || !scrub.frameRate || scrub.frameRate <= 0) {
    hideContactMarkers(markers)
    return
  }

  const maxFrame = Math.max((scrub.frameCount ?? 1) - 1, 0)
  const durationSeconds = scrub.durationSeconds && scrub.durationSeconds > 0
    ? scrub.durationSeconds
    : (scrub.frameCount ?? 0) / scrub.frameRate
  const currentSeconds = maxFrame > 0
    ? Math.min(Math.max(scrub.frame / maxFrame, 0), 1) * durationSeconds
    : 0
  const currentFrame = Math.round(Math.min(Math.max(scrub.frame, 0), maxFrame))
  const halfFrameSeconds = maxFrame > 0
    ? durationSeconds / maxFrame * 0.5
    : 0.5 / scrub.frameRate
  for (const foot of ['left', 'right'] as FootName[]) {
    const activeTrack = footContacts.tracks.find((track) =>
      track.foot === foot &&
      track.ranges.some((range) =>
        (currentFrame >= range.startFrame && currentFrame <= range.endFrame) ||
        (maxFrame > 0 && range.startFrame === 0 && currentFrame === maxFrame) ||
        (currentSeconds >= range.startSeconds - halfFrameSeconds &&
          currentSeconds <= range.endSeconds + halfFrameSeconds),
      ),
    )
    const marker = ensureContactMarker(scene, foot, markers)
    if (!activeTrack) {
      marker.setEnabled(false)
      continue
    }

    const position = findFootWorldPosition(scene, activeTrack.sourceName, foot)
    if (!position) {
      marker.setEnabled(false)
      continue
    }

    marker.position.copyFrom(position)
    marker.position.y += 5
    marker.setEnabled(true)
  }
}

function hideContactMarkers(markers: Partial<Record<FootName, Mesh>>) {
  for (const marker of Object.values(markers)) {
    marker?.setEnabled(false)
  }
}

function ensureContactMarker(scene: Scene, foot: FootName, markers: Partial<Record<FootName, Mesh>>) {
  const existing = markers[foot]
  if (existing && !existing.isDisposed()) {
    return existing
  }

  const color = foot === 'left'
    ? new Color3(0.2, 0.58, 1)
    : new Color3(1, 0.66, 0.18)
  const marker = MeshBuilder.CreateSphere(`foot-contact-${foot}`, {
    diameter: 8,
    segments: 24,
  }, scene)
  marker.isPickable = false
  marker.renderingGroupId = 2

  const material = new StandardMaterial(`foot-contact-${foot}-material`, scene)
  material.diffuseColor = color
  material.emissiveColor = color.scale(0.8)
  material.alpha = 0.86
  material.disableDepthWrite = true
  marker.material = material
  marker.setEnabled(false)
  markers[foot] = marker
  return marker
}

function findFootWorldPosition(scene: Scene, sourceName: string, foot: FootName) {
  const normalizedSource = normalizeContactTargetName(sourceName)
  for (const node of scene.transformNodes) {
    if (normalizeContactTargetName(node.name) === normalizedSource || normalizeContactTargetName(node.id) === normalizedSource) {
      return node.getAbsolutePosition().clone()
    }
  }

  for (const skeleton of scene.skeletons) {
    for (const bone of skeleton.bones) {
      if (normalizeContactTargetName(bone.name) === normalizedSource || normalizeContactTargetName(bone.id) === normalizedSource) {
        return getBoneWorldPosition(scene, bone)
      }
    }
  }

  const candidates = foot === 'left'
    ? ['lefttoe', 'lefttoes', 'leftfoot', 'ltoe', 'lfoot']
    : ['righttoe', 'righttoes', 'rightfoot', 'rtoe', 'rfoot']
  for (const skeleton of scene.skeletons) {
    for (const bone of skeleton.bones) {
      const normalizedBone = normalizeContactTargetName(bone.name || bone.id)
      if (candidates.some((candidate) => normalizedBone.includes(candidate))) {
        return getBoneWorldPosition(scene, bone)
      }
    }
  }

  for (const node of scene.transformNodes) {
    const normalizedNode = normalizeContactTargetName(node.name || node.id)
    if (candidates.some((candidate) => normalizedNode.includes(candidate))) {
      return node.getAbsolutePosition().clone()
    }
  }

  return null
}

function getBoneWorldPosition(scene: Scene, bone: Bone) {
  const linkedNode = bone.getTransformNode()
  if (linkedNode) {
    return linkedNode.getAbsolutePosition().clone()
  }

  const skeleton = bone.getSkeleton()
  const skinnedMesh = scene.meshes.find((mesh) => mesh.skeleton === skeleton) ?? null
  return bone.getAbsolutePosition(skinnedMesh).clone()
}

function normalizeContactTargetName(name: string | undefined) {
  return normalizeTargetName(name).replace(/[\s_.-]/g, '')
}

function buildAnimationTargetMap(scene: Scene) {
  const targets = new Map<string, unknown>()
  for (const node of scene.getNodes()) {
    addTargetName(targets, node.name, node)
    addTargetName(targets, node.id, node)
  }

  for (const skeleton of scene.skeletons) {
    for (const bone of skeleton.bones) {
      addTargetName(targets, bone.name, bone)
      addTargetName(targets, bone.id, bone)
    }
  }

  return targets
}

function createCharacterPoseSnapshot(scene: Scene) {
  const snapshot = new Map<PoseTarget, PoseSnapshot>()
  for (const node of scene.transformNodes) {
    snapshot.set(node, copyPose(node))
  }

  for (const skeleton of scene.skeletons) {
    for (const bone of skeleton.bones) {
      snapshot.set(bone, copyPose(bone))
    }
  }

  return snapshot
}

function copyPose(target: PoseTarget): PoseSnapshot {
  return {
    position: target.position.clone(),
    rotation: target.rotation.clone(),
    rotationQuaternion: target.rotationQuaternion?.clone() ?? null,
    scaling: target.scaling.clone(),
  }
}

function addTargetName(targets: Map<string, unknown>, name: string | undefined, target: unknown) {
  const normalized = normalizeTargetName(name)
  if (normalized && !targets.has(normalized)) {
    targets.set(normalized, target)
  }
}

function normalizeTargetName(name: string | undefined) {
  return name?.replace(/^mixamorig[:_]/i, '').replace(/^Armature[|/]/i, '').trim().toLowerCase() ?? ''
}

function retargetAnimationGroup(sourceGroup: AnimationGroup, targetMap: Map<string, unknown>, clipMotionMode: ClipMotionMode) {
  const retargetedGroup = new AnimationGroup(`${sourceGroup.name || 'clip'}-retargeted`)
  let retargetedCount = 0

  for (const targetedAnimation of sourceGroup.targetedAnimations) {
    const sourceTarget = targetedAnimation.target as { name?: string; id?: string }
    const sourceName = normalizeTargetName(sourceTarget.name) || normalizeTargetName(sourceTarget.id)
    if (!shouldRetargetAnimationProperty(targetedAnimation.animation.targetProperty, sourceName)) {
      continue
    }

    const target = targetMap.get(sourceName)
    if (!target) {
      continue
    }

    retargetedGroup.addTargetedAnimation(cloneRetargetAnimation(targetedAnimation.animation, sourceName, clipMotionMode), target)
    retargetedCount++
  }

  if (retargetedCount === 0) {
    retargetedGroup.dispose()
    return null
  }

  return { group: retargetedGroup, count: retargetedCount }
}

function shouldRetargetAnimationProperty(targetProperty: string, sourceName: string) {
  const property = targetProperty.toLowerCase()
  if (property.includes('scal')) {
    return false
  }

  if (property.includes('position') || property.includes('translation')) {
    return isRootMotionSource(sourceName)
  }

  return true
}

function cloneRetargetAnimation(animation: Animation, sourceName: string, clipMotionMode: ClipMotionMode) {
  const cloned = animation.clone()
  const property = cloned.targetProperty.toLowerCase()
  const isTranslationTrack = property.includes('position') || property.includes('translation')
  const isRotationTrack = property.includes('rotation') || property.includes('quaternion')
  if (clipMotionMode !== 'inPlace' || !isRootMotionSource(sourceName) || (!isTranslationTrack && !isRotationTrack)) {
    return cloned
  }

  const keys = cloned.getKeys()
  const firstValue = keys.find((key) => key.value !== undefined)?.value
  if (isTopLevelRootMotionSource(sourceName) && isRotationTrack && firstValue !== undefined) {
    cloned.setKeys(keys.map((key) => ({
      ...key,
      value: cloneAnimationKeyValue(firstValue),
    })))
    return cloned
  }

  if (!isTranslationTrack) {
    return cloned
  }

  const firstVector = keys.find((key) => key.value instanceof Vector3)?.value
  if (!(firstVector instanceof Vector3)) {
    return cloned
  }

  cloned.setKeys(keys.map((key) => {
    if (!(key.value instanceof Vector3)) {
      return key
    }

    return {
      ...key,
      value: new Vector3(firstVector.x, key.value.y, firstVector.z),
    }
  }))
  return cloned
}

function isRootMotionSource(sourceName: string) {
  return sourceName === 'hips' || sourceName === 'pelvis' || isTopLevelRootMotionSource(sourceName)
}

function isTopLevelRootMotionSource(sourceName: string) {
  return sourceName === 'root' || sourceName === 'skeleton'
}

function cloneAnimationKeyValue(value: unknown) {
  if (value instanceof Vector3 || value instanceof Quaternion) {
    return value.clone()
  }

  if (Array.isArray(value)) {
    return [...value]
  }

  return value
}

function createGroundGrid(scene: Scene) {
  const extent = 500
  const unitsPerMeter = 100
  const minorStep = 10
  const majorStep = unitsPerMeter
  const majorLineHalfWidth = 0.35
  const minorLines: Vector3[][] = []
  const majorLines: Vector3[][] = []

  for (let value = -extent; value <= extent; value += minorStep) {
    if (value % majorStep === 0) {
      majorLines.push([new Vector3(-extent, 0, value), new Vector3(extent, 0, value)])
      majorLines.push([new Vector3(-extent, 0, value - majorLineHalfWidth), new Vector3(extent, 0, value - majorLineHalfWidth)])
      majorLines.push([new Vector3(-extent, 0, value + majorLineHalfWidth), new Vector3(extent, 0, value + majorLineHalfWidth)])
      majorLines.push([new Vector3(value, 0, -extent), new Vector3(value, 0, extent)])
      majorLines.push([new Vector3(value - majorLineHalfWidth, 0, -extent), new Vector3(value - majorLineHalfWidth, 0, extent)])
      majorLines.push([new Vector3(value + majorLineHalfWidth, 0, -extent), new Vector3(value + majorLineHalfWidth, 0, extent)])
    } else {
      minorLines.push([new Vector3(-extent, 0, value), new Vector3(extent, 0, value)])
      minorLines.push([new Vector3(value, 0, -extent), new Vector3(value, 0, extent)])
    }
  }

  const minorGrid = MeshBuilder.CreateLineSystem('ground-grid-minor', { lines: minorLines }, scene)
  minorGrid.color = new Color3(0.2, 0.22, 0.25)
  minorGrid.alpha = 0.45
  minorGrid.isPickable = false

  const majorGrid = MeshBuilder.CreateLineSystem('ground-grid-major', { lines: majorLines }, scene)
  majorGrid.color = new Color3(0.43, 0.47, 0.54)
  majorGrid.alpha = 0.92
  majorGrid.isPickable = false

  const xAxis = MeshBuilder.CreateLines('ground-grid-x-axis', {
    points: [new Vector3(-extent, 0.02, 0), new Vector3(extent, 0.02, 0)],
  }, scene)
  xAxis.color = new Color3(0.75, 0.25, 0.25)
  xAxis.isPickable = false

  const zAxis = MeshBuilder.CreateLines('ground-grid-z-axis', {
    points: [new Vector3(0, 0.02, -extent), new Vector3(0, 0.02, extent)],
  }, scene)
  zAxis.color = new Color3(0.25, 0.45, 0.85)
  zAxis.isPickable = false
}
