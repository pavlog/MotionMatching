import { useCallback, useEffect, useRef, useState } from 'react'
import { CirclePlus, Footprints, Move3D, Scan, Trash2 } from 'lucide-react'
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
  Material,
  Matrix,
  Mesh,
  MeshBuilder,
  PointerEventTypes,
  PointerInfo,
  Quaternion,
  Scene,
  SceneLoader,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core'
import '@babylonjs/loaders/glTF'
import type { FootContactDiagnosticsResponse, RuntimePoseSampleResponse, SamplingQueryResponse } from './api'

export type SamplingGhostPosePreview = {
  pose: RuntimePoseSampleResponse
  anchor: number[]
  heading: number[]
  alpha?: number
  scale?: number
}

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
  samplingFrameRate: number
  samplingGhostPoses: SamplingGhostPosePreview[]
  samplingPreviewFrame: number
  samplingQueryVectorFrames: number[]
  showSamplingQueryVectors: boolean
  selectedSamplingPointIndex: number | null
  label: string
  onClipMotionModeChange?: (mode: ClipMotionMode) => void
  onAnimationStateChange?: (state: string) => void
  onSamplingQueryChange?: (query: SamplingQueryResponse) => void
  onSamplingPointSelect?: (index: number | null) => void
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
type SamplingContextClickState = {
  startClientX: number
  startClientY: number
}

type SamplingTrajectoryPoint = SamplingQueryResponse['trajectory'][number]
type SamplingViewportContextMenu = {
  x: number
  y: number
  insertAfterIndex?: number
  insertSegmentIndex?: number
  trajectoryIndex?: number
  pickedPoint?: Vector3
  canDelete?: boolean
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
  samplingFrameRate,
  samplingGhostPoses,
  samplingPreviewFrame,
  samplingQueryVectorFrames,
  showSamplingQueryVectors,
  selectedSamplingPointIndex,
  label,
  onClipMotionModeChange,
  onAnimationStateChange,
  onSamplingQueryChange,
  onSamplingPointSelect,
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
  const samplingContextClickRef = useRef<SamplingContextClickState | null>(null)
  const onSamplingQueryChangeRef = useRef<typeof onSamplingQueryChange>(onSamplingQueryChange)
  const onSamplingPointSelectRef = useRef<typeof onSamplingPointSelect>(onSamplingPointSelect)
  const characterPoseRef = useRef(new Map<PoseTarget, PoseSnapshot>())
  const clipScrubRef = useRef({ frame: clipFrame, frameCount: clipFrameCount, frameRate: clipFrameRate, durationSeconds: clipDurationSeconds })
  const [cameraMode, setCameraMode] = useState<'perspective' | 'orthographic'>('perspective')
  const [status, setStatus] = useState<ViewportStatus>({ kind: 'empty', message: 'Empty scene' })
  const [animationState, setAnimationState] = useState('none')
  const [showFootContacts, setShowFootContacts] = useState(true)
  const [modelVersion, setModelVersion] = useState(0)
  const [samplingViewportMenu, setSamplingViewportMenu] = useState<SamplingViewportContextMenu | null>(null)
  const statusText = status.kind === 'ready' ? label : status.message

  useEffect(() => {
    clipScrubRef.current = { frame: clipFrame, frameCount: clipFrameCount, frameRate: clipFrameRate, durationSeconds: clipDurationSeconds }
  }, [clipFrame, clipFrameCount, clipFrameRate, clipDurationSeconds])

  const applySamplingViewportInsert = (menu: SamplingViewportContextMenu) => {
    const currentQuery = samplingQueryRef.current
    if (!currentQuery) {
      return
    }

    const trajectory = typeof menu.insertSegmentIndex === 'number' && menu.pickedPoint
      ? insertSamplingTrajectoryPointOnSegment(currentQuery.trajectory, menu.insertSegmentIndex, menu.pickedPoint)
      : insertSamplingTrajectoryPoint(currentQuery.trajectory, menu.insertAfterIndex ?? menu.trajectoryIndex ?? 0, currentQuery.facing, samplingFrameRate)
    onSamplingQueryChangeRef.current?.({
      ...currentQuery,
      trajectory,
    })
    setSamplingViewportMenu(null)
  }

  const applySamplingViewportDelete = (menu: SamplingViewportContextMenu) => {
    const currentQuery = samplingQueryRef.current
    if (!currentQuery || typeof menu.trajectoryIndex !== 'number' || currentQuery.trajectory.length <= 1) {
      return
    }

    onSamplingQueryChangeRef.current?.({
      ...currentQuery,
      trajectory: currentQuery.trajectory.filter((_, index) => index !== menu.trajectoryIndex),
    })
    setSamplingViewportMenu(null)
  }

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
    onSamplingPointSelectRef.current = onSamplingPointSelect
  }, [onSamplingPointSelect, onSamplingQueryChange, samplingPreview, samplingQuery])

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
    const suppressCanvasContextMenu = (event: MouseEvent) => {
      if (samplingPreviewRef.current) {
        event.preventDefault()
      }
    }
    canvas.addEventListener('contextmenu', suppressCanvasContextMenu)
    const openSamplingContextMenu = (pointerInfo: PointerInfo, pointerEvent: PointerEvent) => {
      const pickedMesh = pointerInfo.pickInfo?.pickedMesh
      const currentQuery = samplingQueryRef.current
      const groundPoint = pointerInfo.pickInfo?.pickedPoint?.clone() ?? pickSamplingDragPoint(scene)?.clone()
      const trajectoryIndex = typeof pickedMesh?.metadata?.samplingTrajectoryIndex === 'number'
        ? pickedMesh.metadata.samplingTrajectoryIndex as number
        : null
      const nearestTrajectoryIndex = currentQuery
        ? findNearestSamplingTrajectoryPointIndex(currentQuery, scene, camera, pointerEvent)
        : null
      if (nearestTrajectoryIndex !== null) {
        setSamplingViewportMenu({
          x: pointerEvent.clientX,
          y: pointerEvent.clientY,
          insertAfterIndex: nearestTrajectoryIndex,
          trajectoryIndex: nearestTrajectoryIndex,
          canDelete: (currentQuery?.trajectory.length ?? 0) > 1,
        })
        pointerInfo.event.preventDefault()
        return
      }

      if (pickedMesh instanceof Mesh && typeof pickedMesh.metadata?.samplingInsertSegmentIndex === 'number' && pointerInfo.pickInfo?.pickedPoint) {
        setSamplingViewportMenu({
          x: pointerEvent.clientX,
          y: pointerEvent.clientY,
          insertSegmentIndex: pickedMesh.metadata.samplingInsertSegmentIndex as number,
          pickedPoint: pointerInfo.pickInfo.pickedPoint.clone(),
        })
        pointerInfo.event.preventDefault()
        return
      }

      if (pickedMesh instanceof Mesh && typeof pickedMesh.metadata?.samplingInsertAfterIndex === 'number') {
        setSamplingViewportMenu({
          x: pointerEvent.clientX,
          y: pointerEvent.clientY,
          insertAfterIndex: pickedMesh.metadata.samplingInsertAfterIndex as number,
        })
        pointerInfo.event.preventDefault()
        return
      }

      if (pickedMesh instanceof Mesh && trajectoryIndex !== null) {
        setSamplingViewportMenu({
          x: pointerEvent.clientX,
          y: pointerEvent.clientY,
          insertAfterIndex: trajectoryIndex,
          trajectoryIndex,
          canDelete: (currentQuery?.trajectory.length ?? 0) > 1,
        })
        pointerInfo.event.preventDefault()
        return
      }

      if (currentQuery && groundPoint) {
        const nearestSegmentIndex = findNearestSamplingTrajectorySegmentIndex(currentQuery, groundPoint)
        if (nearestSegmentIndex !== null) {
          setSamplingViewportMenu({
            x: pointerEvent.clientX,
            y: pointerEvent.clientY,
            insertSegmentIndex: nearestSegmentIndex,
            pickedPoint: groundPoint,
          })
          pointerInfo.event.preventDefault()
          return
        }
      }

      pointerInfo.event.preventDefault()
    }
    const pointerObserver = scene.onPointerObservable.add((pointerInfo) => {
      if (!samplingPreviewRef.current || !samplingQueryRef.current) {
        return
      }

      if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
        setSamplingViewportMenu(null)
        const pickedMesh = pointerInfo.pickInfo?.pickedMesh
        const pointerEvent = pointerInfo.event as PointerEvent
        const isPrimaryButton = pointerEvent.button === 0
        const isContextButton = pointerEvent.button === 2
        const trajectoryIndex = typeof pickedMesh?.metadata?.samplingTrajectoryIndex === 'number'
          ? pickedMesh.metadata.samplingTrajectoryIndex as number
          : null

        if (isContextButton) {
          samplingContextClickRef.current = {
            startClientX: pointerEvent.clientX,
            startClientY: pointerEvent.clientY,
          }
          return
        }

        if (!(pickedMesh instanceof Mesh)) {
          return
        }

        if (!isPrimaryButton) {
          return
        }

        if (trajectoryIndex !== null) {
          onSamplingPointSelectRef.current?.(trajectoryIndex)
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

      if (pointerInfo.type === PointerEventTypes.POINTERUP && samplingContextClickRef.current) {
        const pointerEvent = pointerInfo.event as PointerEvent
        const click = samplingContextClickRef.current
        samplingContextClickRef.current = null
        const dragDistance = Math.hypot(pointerEvent.clientX - click.startClientX, pointerEvent.clientY - click.startClientY)
        if (dragDistance <= 4) {
          openSamplingContextMenu(pointerInfo, pointerEvent)
        }
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
      canvas.removeEventListener('contextmenu', suppressCanvasContextMenu)
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

    samplingPreviewMeshesRef.current = createSamplingPreview(
      scene,
      samplingQuery,
      samplingFrameRate,
      samplingPreviewFrame,
      showSamplingQueryVectors,
      samplingQueryVectorFrames,
      selectedSamplingPointIndex,
    )
  }, [modelVersion, samplingFrameRate, samplingPreview, samplingPreviewFrame, samplingQuery, samplingQueryVectorFrames, selectedSamplingPointIndex, showSamplingQueryVectors])

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) {
      return
    }

    disposeSamplingPreview(samplingGhostPoseMeshesRef.current)
    samplingGhostPoseMeshesRef.current = []
    if (!samplingPreview || !samplingGhostPoses.length) {
      return
    }

    samplingGhostPoseMeshesRef.current = samplingGhostPoses.flatMap((ghost) =>
      createSamplingGhostPose(scene, ghost.pose, ghost.anchor, ghost.heading, ghost.alpha, ghost.scale),
    )
  }, [modelVersion, samplingGhostPoses, samplingPreview])

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
      {samplingViewportMenu ? (
        <div
          className="context-menu sampling-viewport-menu"
          style={{ left: samplingViewportMenu.x, top: samplingViewportMenu.y }}
          role="menu"
          aria-label="Sampling trajectory actions"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className="context-menu-item"
            role="menuitem"
            onClick={() => applySamplingViewportInsert(samplingViewportMenu)}
          >
            <CirclePlus size={14} aria-hidden="true" />
            Insert point
          </button>
          {typeof samplingViewportMenu.trajectoryIndex === 'number' ? (
            <button
              type="button"
              className="context-menu-item danger"
              role="menuitem"
              disabled={!samplingViewportMenu.canDelete}
              onClick={() => applySamplingViewportDelete(samplingViewportMenu)}
            >
              <Trash2 size={14} aria-hidden="true" />
              Delete point
            </button>
          ) : null}
        </div>
      ) : null}
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

function createSamplingPreview(
  scene: Scene,
  samplingQuery: SamplingQueryResponse | null,
  samplingFrameRate: number,
  samplingPreviewFrame: number,
  showQueryVectors: boolean,
  queryVectorFrames: number[],
  selectedPointIndex: number | null,
) {
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

  const insertMaterial = new StandardMaterial('sampling-insert-material', scene)
  insertMaterial.diffuseColor = new Color3(0.45, 0.92, 0.62)
  insertMaterial.emissiveColor = new Color3(0.1, 0.36, 0.19)

  const insertSegmentMaterial = new StandardMaterial('sampling-insert-segment-material', scene)
  insertSegmentMaterial.diffuseColor = new Color3(0.45, 0.92, 0.62)
  insertSegmentMaterial.emissiveColor = new Color3(0.05, 0.16, 0.08)
  insertSegmentMaterial.alpha = 0.08
  insertSegmentMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND
  insertSegmentMaterial.disableDepthWrite = true

  const selectedPointMaterial = new StandardMaterial('sampling-selected-trajectory-material', scene)
  selectedPointMaterial.diffuseColor = new Color3(0.36, 0.72, 1)
  selectedPointMaterial.emissiveColor = new Color3(0.1, 0.28, 0.5)

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
  const trajectory = samplingQuery?.trajectory ?? []
  const trajectorySpeeds = buildSamplingTrajectoryPointSpeeds(trajectory, samplingFrameRate)
  if (trajectory.length) {
    const originVelocity = trajectorySpeeds.originVelocity
    const originDirection = originVelocity.lengthSquared() > 0.0001 ? originVelocity.clone().normalize() : Vector3.Zero()
    if (originDirection.lengthSquared() > 0.0001) {
      const speedStart = new Vector3(0, 5, 0)
      const speedEnd = speedStart.add(originDirection.scale(Math.min(Math.max(trajectorySpeeds.origin * 0.12, 8), 26)))
      const speedLine = MeshBuilder.CreateLines('sampling-trajectory-origin-speed-arrow', {
        points: [speedStart, speedEnd],
      }, scene)
      speedLine.color = new Color3(0.36, 0.72, 1)
      speedLine.isPickable = false
      meshes.push(speedLine)
    }
    meshes.push(createSamplingLabel(
      scene,
      `${formatSamplingSpeed(trajectorySpeeds.origin)} cm/s`,
      new Vector3(0, 15, 0),
      'sampling-trajectory-origin-speed-label',
    ))
  }

  for (const [index, point] of trajectoryPoints.entries()) {
    const marker = MeshBuilder.CreateSphere(`sampling-trajectory-point-${index + 1}`, {
      diameter: 7,
      segments: 18,
    }, scene)
    marker.position = point
    marker.material = selectedPointIndex === index ? selectedPointMaterial : trajectoryMaterial
    marker.isPickable = true
    marker.metadata = { samplingTrajectoryIndex: index }
    meshes.push(marker)

    const hitMarker = MeshBuilder.CreateSphere(`sampling-trajectory-point-hit-${index + 1}`, {
      diameter: 18,
      segments: 12,
    }, scene)
    hitMarker.position = point
    hitMarker.isPickable = true
    hitMarker.visibility = 0
    hitMarker.metadata = { samplingTrajectoryIndex: index }
    meshes.push(hitMarker)

    const frameOffset = samplingQuery?.trajectory[index]?.frameOffset ?? (index + 1) * 20
    meshes.push(createSamplingLabel(scene, `+${frameOffset}f`, point.add(new Vector3(0, 9, 0)), `sampling-trajectory-label-${index}`))
    if (samplingQuery?.trajectory[index]) {
      const velocity = trajectorySpeeds.byIndexVelocity[index] ?? Vector3.Zero()
      const speedDirection = velocity.lengthSquared() > 0.0001 ? velocity.clone().normalize() : Vector3.Zero()
      if (speedDirection.lengthSquared() > 0.0001) {
        const speedLength = Math.min(Math.max((trajectorySpeeds.byIndex[index] ?? 0) * 0.12, 8), 26)
        const speedStart = point.add(new Vector3(0, 5, 0))
        const speedEnd = speedStart.add(speedDirection.scale(speedLength))
        const speedLine = MeshBuilder.CreateLines(`sampling-trajectory-speed-arrow-${index}`, {
          points: [speedStart, speedEnd],
        }, scene)
        speedLine.color = new Color3(0.36, 0.72, 1)
        speedLine.isPickable = false
        meshes.push(speedLine)
      }
      meshes.push(createSamplingLabel(
        scene,
        `${formatSamplingSpeed(trajectorySpeeds.byIndex[index] ?? 0)} cm/s`,
        point.add(new Vector3(0, 16, 0)),
        `sampling-trajectory-speed-label-${index}`,
      ))
    }
  }

  for (const segment of buildSamplingInsertSegments(trajectory)) {
    const segmentMesh = MeshBuilder.CreateTube(`sampling-trajectory-insert-segment-${segment.segmentIndex}`, {
      path: segment.path,
      radius: 3.2,
      tessellation: 8,
    }, scene)
    segmentMesh.material = insertSegmentMaterial
    segmentMesh.isPickable = true
    segmentMesh.metadata = { samplingInsertSegmentIndex: segment.segmentIndex }
    meshes.push(segmentMesh)
  }

  for (const insertHandle of buildSamplingInsertHandles(trajectory, samplingFrameRate)) {
    const marker = MeshBuilder.CreateSphere(`sampling-trajectory-insert-${insertHandle.afterIndex}`, {
      diameter: 5,
      segments: 12,
    }, scene)
    marker.position = vectorFromSamplingArray(insertHandle.position, Vector3.Zero()).add(new Vector3(0, 4, 0))
    marker.material = insertMaterial
    marker.isPickable = true
    marker.metadata = { samplingInsertAfterIndex: insertHandle.afterIndex }
    meshes.push(marker)
  }

  const trajectoryLine = MeshBuilder.CreateLines('sampling-trajectory-line', {
    points: [Vector3.Zero(), ...trajectoryPoints],
  }, scene)
  trajectoryLine.color = new Color3(1, 0.7, 0.22)
  trajectoryLine.isPickable = false
  meshes.push(trajectoryLine)

  if (samplingQuery && showQueryVectors) {
    meshes.push(...createSamplingQueryVectors(scene, samplingQuery, samplingPreviewFrame, queryVectorFrames))
  }

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

function buildSamplingInsertHandles(trajectory: SamplingTrajectoryPoint[], samplingFrameRate: number) {
  return trajectory.map((point, index) => {
    const nextPoint = trajectory[index + 1]
    const insertedPoint = nextPoint
      ? midpointSamplingTrajectoryPoint(point, nextPoint)
      : extrapolateSamplingTrajectoryPoint(point, trajectory[index - 1], [0, 0, 1], samplingFrameRate)
    return {
      afterIndex: index,
      position: insertedPoint.position,
    }
  })
}

function buildSamplingInsertSegments(trajectory: SamplingTrajectoryPoint[]) {
  if (!trajectory.length) {
    return []
  }

  const points = [
    Vector3.Zero(),
    ...trajectory.map((point) => vectorFromSamplingArray(point.position, Vector3.Zero())),
  ].map((point) => point.add(new Vector3(0, 2, 0)))

  return points.slice(0, -1).map((point, index) => ({
    segmentIndex: index,
    path: [point, points[index + 1]],
  }))
}

function buildSamplingTrajectoryPointSpeeds(trajectory: SamplingTrajectoryPoint[], samplingFrameRate: number) {
  const sortedTrajectory = [...trajectory]
    .map((point, index) => ({ point, index }))
    .sort((left, right) => left.point.frameOffset - right.point.frameOffset)
  const byIndex: number[] = Array.from({ length: trajectory.length }, () => 0)
  const byIndexVelocity: Vector3[] = Array.from({ length: trajectory.length }, () => Vector3.Zero())
  const points = [
    { frameOffset: 0, position: [0, 0, 0], speedMode: 'auto', speed: null, sourceIndex: -1 },
    ...sortedTrajectory.map(({ point, index }) => ({
      frameOffset: point.frameOffset,
      position: point.position,
      speedMode: point.speedMode,
      speed: point.speed,
      sourceIndex: index,
    })),
  ]

  let origin = 0
  let originVelocity = Vector3.Zero()
  for (const [index, point] of points.entries()) {
    const previous = points[index - 1]
    const next = points[index + 1]
    const autoSpeed = previous
      ? calculateSamplingSegmentSpeed(previous.frameOffset, previous.position, point.frameOffset, point.position, samplingFrameRate)
      : next
        ? calculateSamplingSegmentSpeed(point.frameOffset, point.position, next.frameOffset, next.position, samplingFrameRate)
        : 0
    const speed = point.sourceIndex >= 0 ? resolveSamplingPointSpeed(point, autoSpeed) : autoSpeed
    const velocity = calculateSamplingPointVelocityVector(point, previous, next, speed)
    if (point.sourceIndex < 0) {
      origin = speed
      originVelocity = velocity
    } else {
      byIndex[point.sourceIndex] = speed
      byIndexVelocity[point.sourceIndex] = velocity
    }
  }

  return { origin, originVelocity, byIndex, byIndexVelocity }
}

function calculateSamplingPointVelocityVector(
  point: { frameOffset: number; position: number[] },
  previous: { frameOffset: number; position: number[] } | undefined,
  next: { frameOffset: number; position: number[] } | undefined,
  speed: number,
) {
  const fromPoint = previous ?? point
  const toPoint = previous ? point : next ?? point
  const direction = new Vector3(
    (toPoint.position[0] ?? 0) - (fromPoint.position[0] ?? 0),
    0,
    (toPoint.position[2] ?? 0) - (fromPoint.position[2] ?? 0),
  )
  return direction.lengthSquared() > 0.0001 ? direction.normalize().scale(speed) : Vector3.Zero()
}

function resolveSamplingPointSpeed(point: { frameOffset?: number; speedMode?: string; speed?: number | null }, autoSpeed: number) {
  if (point.speedMode === 'manual' && point.speed !== null && point.speed !== undefined && Number.isFinite(point.speed)) {
    return Math.max(point.speed, 0)
  }

  return autoSpeed
}

function createSamplingQueryVectors(
  scene: Scene,
  samplingQuery: SamplingQueryResponse,
  samplingPreviewFrame: number,
  queryVectorFrames: number[],
) {
  const meshes: Mesh[] = []
  const current = getSamplingTimelinePlacement(samplingQuery, samplingPreviewFrame)
  const currentAnchor = current.anchor.add(new Vector3(0, 6, 0))
  const frames = queryVectorFrames.length
    ? queryVectorFrames
    : samplingQuery.trajectory.map((point) => point.frameOffset)

  const anchorMaterial = new StandardMaterial('sampling-query-anchor-material', scene)
  anchorMaterial.diffuseColor = new Color3(0.36, 0.72, 1)
  anchorMaterial.emissiveColor = new Color3(0.08, 0.28, 0.48)

  const directionMaterial = new StandardMaterial('sampling-query-direction-material', scene)
  directionMaterial.diffuseColor = new Color3(0.45, 0.92, 0.62)
  directionMaterial.emissiveColor = new Color3(0.12, 0.36, 0.18)
  directionMaterial.alpha = 0.72
  directionMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND
  directionMaterial.disableDepthWrite = true

  const anchor = MeshBuilder.CreateSphere('sampling-query-anchor', {
    diameter: 6,
    segments: 16,
  }, scene)
  anchor.position = currentAnchor
  anchor.material = anchorMaterial
  anchor.isPickable = false
  meshes.push(anchor)

  for (const frameOffset of frames) {
    const futureFrame = samplingPreviewFrame + frameOffset
    const future = getSamplingTimelinePlacement(samplingQuery, futureFrame)
    const futureAnchor = future.anchor.add(new Vector3(0, 6, 0))
    const positionLine = MeshBuilder.CreateLines(`sampling-query-position-${frameOffset}`, {
      points: [currentAnchor, futureAnchor],
    }, scene)
    positionLine.color = new Color3(0.36, 0.72, 1)
    positionLine.alpha = 0.9
    positionLine.visibility = 0.9
    positionLine.isPickable = false
    meshes.push(positionLine)

    const marker = MeshBuilder.CreateSphere(`sampling-query-position-head-${frameOffset}`, {
      diameter: 4.8,
      segments: 12,
    }, scene)
    marker.position = futureAnchor
    marker.material = anchorMaterial
    marker.isPickable = false
    meshes.push(marker)

    const heading = normalizeSamplingVector(future.heading, vectorFromSamplingArray(samplingQuery.facing, new Vector3(0, 0, 1)))
    const headingEnd = futureAnchor.add(heading.scale(16))
    const headingLine = MeshBuilder.CreateLines(`sampling-query-direction-${frameOffset}`, {
      points: [futureAnchor, headingEnd],
    }, scene)
    headingLine.color = new Color3(0.45, 0.92, 0.62)
    headingLine.alpha = 0.88
    headingLine.visibility = 0.88
    headingLine.isPickable = false
    meshes.push(headingLine)

    const headingHead = MeshBuilder.CreateSphere(`sampling-query-direction-head-${frameOffset}`, {
      diameter: 3.8,
      segments: 10,
    }, scene)
    headingHead.position = headingEnd
    headingHead.material = directionMaterial
    headingHead.isPickable = false
    meshes.push(headingHead)

    meshes.push(createSamplingLabel(
      scene,
      `+${frameOffset}f`,
      futureAnchor.add(new Vector3(0, 7, 0)),
      `sampling-query-label-${frameOffset}`,
    ))
  }

  return meshes
}

function getSamplingTimelinePlacement(query: SamplingQueryResponse, frame: number) {
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
      anchor: vectorFromSamplingArray(nextPoint?.position, Vector3.Zero()),
      heading: getSamplingTimelineHeading(points, Math.max(nextIndex, 0), query.facing),
    }
  }

  const ratio = Math.min(Math.max((clampedFrame - previousPoint.frameOffset) / (nextPoint.frameOffset - previousPoint.frameOffset), 0), 1)
  return {
    anchor: new Vector3(
      lerpNumber(previousPoint.position[0] ?? 0, nextPoint.position[0] ?? 0, ratio),
      0,
      lerpNumber(previousPoint.position[2] ?? 0, nextPoint.position[2] ?? 0, ratio),
    ),
    heading: new Vector3(
      (nextPoint.position[0] ?? 0) - (previousPoint.position[0] ?? 0),
      0,
      (nextPoint.position[2] ?? 0) - (previousPoint.position[2] ?? 0),
    ),
  }
}

function getSamplingTimelineHeading(
  points: Array<{ frameOffset: number; position: number[]; direction: number[] }>,
  index: number,
  fallback: number[],
) {
  const previous = points[index - 1]
  const current = points[index]
  const next = points[index + 1]
  if (current && next) {
    return new Vector3(
      (next.position[0] ?? 0) - (current.position[0] ?? 0),
      0,
      (next.position[2] ?? 0) - (current.position[2] ?? 0),
    )
  }

  if (previous && current) {
    return new Vector3(
      (current.position[0] ?? 0) - (previous.position[0] ?? 0),
      0,
      (current.position[2] ?? 0) - (previous.position[2] ?? 0),
    )
  }

  return vectorFromSamplingArray(fallback, new Vector3(0, 0, 1))
}

function normalizeSamplingVector(value: Vector3, fallback: Vector3) {
  return value.lengthSquared() > 0.0001
    ? value.normalize()
    : fallback.lengthSquared() > 0.0001 ? fallback.normalize() : new Vector3(0, 0, 1)
}

function lerpNumber(start: number, end: number, ratio: number) {
  return start + (end - start) * ratio
}

function findNearestSamplingTrajectoryPointIndex(
  query: SamplingQueryResponse,
  scene: Scene,
  camera: ArcRotateCamera,
  event: PointerEvent,
) {
  const canvas = scene.getEngine().getRenderingCanvas()
  if (!canvas || !query.trajectory.length) {
    return null
  }

  const bounds = canvas.getBoundingClientRect()
  const renderWidth = scene.getEngine().getRenderWidth()
  const renderHeight = scene.getEngine().getRenderHeight()
  const pointerX = (event.clientX - bounds.left) * (renderWidth / Math.max(bounds.width, 1))
  const pointerY = (event.clientY - bounds.top) * (renderHeight / Math.max(bounds.height, 1))
  const viewport = camera.viewport.toGlobal(renderWidth, renderHeight)
  const transform = scene.getTransformMatrix()
  const hitRadiusPixels = 18

  let bestIndex: number | null = null
  let bestDistance = hitRadiusPixels
  for (const [index, point] of query.trajectory.entries()) {
    const worldPosition = vectorFromSamplingArray(point.position, Vector3.Zero()).add(new Vector3(0, 2, 0))
    const projected = Vector3.Project(worldPosition, Matrix.Identity(), transform, viewport)
    const distance = Math.hypot(projected.x - pointerX, projected.y - pointerY)
    if (distance <= bestDistance) {
      bestIndex = index
      bestDistance = distance
    }
  }

  return bestIndex
}

function findNearestSamplingTrajectorySegmentIndex(query: SamplingQueryResponse, pickedPoint: Vector3) {
  if (!query.trajectory.length) {
    return null
  }

  const picked = new Vector3(pickedPoint.x, 0, pickedPoint.z)
  const points = [
    Vector3.Zero(),
    ...query.trajectory.map((point) => new Vector3(point.position[0] ?? 0, 0, point.position[2] ?? 0)),
  ]
  let bestIndex: number | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]
    const end = points[index + 1]
    const segment = end.subtract(start)
    const ratio = segment.lengthSquared() > 0.0001
      ? Math.min(Math.max(Vector3.Dot(picked.subtract(start), segment) / segment.lengthSquared(), 0), 1)
      : 0
    const closestPoint = start.add(segment.scale(ratio))
    const distance = Vector3.DistanceSquared(picked, closestPoint)
    if (distance < bestDistance) {
      bestIndex = index
      bestDistance = distance
    }
  }

  return bestIndex
}

function calculateSamplingSegmentSpeed(
  fromFrame: number,
  fromPosition: number[],
  toFrame: number,
  toPosition: number[],
  samplingFrameRate: number,
) {
  const frameDelta = Math.max(toFrame - fromFrame, 1)
  const seconds = frameDelta / Math.max(samplingFrameRate, 1)
  const dx = (toPosition[0] ?? 0) - (fromPosition[0] ?? 0)
  const dz = (toPosition[2] ?? 0) - (fromPosition[2] ?? 0)
  return Math.hypot(dx, dz) / seconds
}

function formatSamplingSpeed(value: number) {
  if (!Number.isFinite(value)) {
    return '0'
  }

  return Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)
}

function insertSamplingTrajectoryPoint(trajectory: SamplingTrajectoryPoint[], afterIndex: number, facing: number[], samplingFrameRate: number) {
  const sourcePoint = trajectory[afterIndex]
  if (!sourcePoint) {
    return trajectory
  }

  const insertedPoint = trajectory[afterIndex + 1]
    ? midpointSamplingTrajectoryPoint(sourcePoint, trajectory[afterIndex + 1])
    : extrapolateSamplingTrajectoryPoint(sourcePoint, trajectory[afterIndex - 1], facing, samplingFrameRate)

  return [
    ...trajectory.slice(0, afterIndex + 1),
    insertedPoint,
    ...trajectory.slice(afterIndex + 1),
  ]
}

function insertSamplingTrajectoryPointOnSegment(trajectory: SamplingTrajectoryPoint[], segmentIndex: number, pickedPoint: Vector3) {
  if (!trajectory.length) {
    return trajectory
  }

  const previousPoint = segmentIndex === 0 ? null : trajectory[segmentIndex - 1]
  const nextPoint = trajectory[segmentIndex]
  if (!nextPoint) {
    return trajectory
  }

  const startPosition = previousPoint?.position ?? [0, 0, 0]
  const endPosition = nextPoint.position
  const start = new Vector3(startPosition[0] ?? 0, 0, startPosition[2] ?? 0)
  const end = new Vector3(endPosition[0] ?? 0, 0, endPosition[2] ?? 0)
  const picked = new Vector3(pickedPoint.x, 0, pickedPoint.z)
  const segment = end.subtract(start)
  const ratio = segment.lengthSquared() > 0.0001
    ? Math.min(Math.max(Vector3.Dot(picked.subtract(start), segment) / segment.lengthSquared(), 0.05), 0.95)
    : 0.5
  const projected = start.add(segment.scale(ratio))
  const previousFrame = previousPoint?.frameOffset ?? 0
  const frameDelta = nextPoint.frameOffset - previousFrame
  const maxInsertFrame = frameDelta > 1 ? nextPoint.frameOffset - 1 : nextPoint.frameOffset
  const frameOffset = Math.min(Math.max(Math.round(previousFrame + frameDelta * ratio), previousFrame + 1), maxInsertFrame)
  const insertedPoint = {
    frameOffset,
    position: [
      Number(projected.x.toFixed(2)),
      0,
      Number(projected.z.toFixed(2)),
    ],
    direction: previousPoint?.direction ?? nextPoint.direction,
    speedMode: 'auto' as const,
    speed: null,
  }

  return [
    ...trajectory.slice(0, segmentIndex),
    insertedPoint,
    ...trajectory.slice(segmentIndex),
  ]
}

function midpointSamplingTrajectoryPoint(current: SamplingTrajectoryPoint, next: SamplingTrajectoryPoint) {
  return {
    frameOffset: Math.max(Math.round((current.frameOffset + next.frameOffset) / 2), current.frameOffset + 1),
    position: [
      Number((((current.position[0] ?? 0) + (next.position[0] ?? 0)) * 0.5).toFixed(2)),
      0,
      Number((((current.position[2] ?? 0) + (next.position[2] ?? 0)) * 0.5).toFixed(2)),
    ],
    direction: current.direction,
    speedMode: 'auto' as const,
    speed: null,
  }
}

function extrapolateSamplingTrajectoryPoint(
  current: SamplingTrajectoryPoint,
  previous: SamplingTrajectoryPoint | undefined,
  facing: number[],
  samplingFrameRate: number,
) {
  if (previous) {
    const frameDelta = Math.max(current.frameOffset - previous.frameOffset, 1)
    return {
      frameOffset: current.frameOffset + frameDelta,
      position: [
        Number(((current.position[0] ?? 0) + ((current.position[0] ?? 0) - (previous.position[0] ?? 0))).toFixed(2)),
        0,
        Number(((current.position[2] ?? 0) + ((current.position[2] ?? 0) - (previous.position[2] ?? 0))).toFixed(2)),
      ],
      direction: current.direction,
      speedMode: 'auto' as const,
      speed: null,
    }
  }

  const frameDelta = 20
  const seconds = frameDelta / Math.max(samplingFrameRate, 1)
  return {
    frameOffset: current.frameOffset + frameDelta,
    position: [
      Number(((current.position[0] ?? 0) + (facing[0] ?? 0) * 100 * seconds).toFixed(2)),
      0,
      Number(((current.position[2] ?? 0) + (facing[2] ?? 1) * 100 * seconds).toFixed(2)),
    ],
    direction: current.direction,
    speedMode: 'auto' as const,
    speed: null,
  }
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

function createSamplingGhostPose(scene: Scene, pose: RuntimePoseSampleResponse, anchor: number[] | null, heading: number[] | null, alpha = 0.42, markerScale = 1) {
  const meshes: Mesh[] = []
  const material = new StandardMaterial('sampling-ghost-pose-material', scene)
  material.diffuseColor = new Color3(0.76, 0.9, 1)
  material.emissiveColor = new Color3(0.18, 0.38, 0.58)
  material.alpha = alpha
  material.transparencyMode = Material.MATERIAL_ALPHABLEND
  material.disableDepthWrite = true

  const visibleBones = pose.bones
    .filter((bone) => bone.translation.length >= 3)
    .filter((bone) => !bone.boneName.toLowerCase().includes('end'))
    .slice(0, 72)
  const localBones = new Map(visibleBones.map((bone) => [normalizeGhostBoneName(bone.boneName), toGhostLocalBone(bone)]))
  const anchorPosition = vectorFromSamplingArray(anchor ?? undefined, Vector3.Zero())
  const headingDirection = normalizeGhostHeading(vectorFromSamplingArray(heading ?? undefined, new Vector3(0, 0, 1)))
  const bonePositions = orientGhostPoseToHeading(
    anchorGhostPoseToSamplingPosition(buildGhostBoneWorldPositions(localBones), anchorPosition),
    anchorPosition,
    headingDirection,
  )
  const skeletonLines = buildGhostSkeletonLines(bonePositions)
  if (skeletonLines.length) {
    const skeleton = MeshBuilder.CreateLineSystem('sampling-ghost-pose-skeleton', { lines: skeletonLines }, scene)
    skeleton.color = new Color3(0.76, 0.9, 1)
    skeleton.alpha = Math.min(alpha + 0.18, 0.98)
    skeleton.visibility = Math.min(alpha + 0.18, 0.98)
    skeleton.isPickable = false
    meshes.push(skeleton)
  }

  for (const [index, bone] of visibleBones.entries()) {
    const position = findGhostBonePosition(bonePositions, bone.boneName) ??
      gltfPosePositionToViewport(vectorFromSamplingArray(bone.translation, Vector3.Zero()).scale(ghostPoseTranslationScale))
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) {
      continue
    }

    const marker = MeshBuilder.CreateSphere(`sampling-ghost-pose-${index}`, {
      diameter: (isMainGhostBone(bone.boneName) ? 3.2 : 1.8) * markerScale,
      segments: 8,
    }, scene)
    marker.position = position
    marker.material = material
    marker.visibility = alpha
    marker.isPickable = false
    meshes.push(marker)
  }

  return meshes
}

const ghostPoseTranslationScale = 100

type GhostLocalBone = {
  translation: Vector3
  rotation: Quaternion
}

function toGhostLocalBone(bone: RuntimePoseSampleResponse['bones'][number]): GhostLocalBone {
  return {
    translation: vectorFromSamplingArray(bone.translation, Vector3.Zero()).scale(ghostPoseTranslationScale),
    rotation: quaternionFromSamplingArray(bone.rotation),
  }
}

function buildGhostBoneWorldPositions(localBones: Map<string, GhostLocalBone>) {
  const chains = [
    ['hips', 'spine', 'chest', 'upperchest', 'neck', 'head'],
    ['upperchest', 'leftshoulder', 'leftupperarm', 'leftlowerarm', 'lefthand'],
    ['upperchest', 'rightshoulder', 'rightupperarm', 'rightlowerarm', 'righthand'],
    ['hips', 'leftupperleg', 'leftlowerleg', 'leftfoot', 'lefttoebase'],
    ['hips', 'rightupperleg', 'rightlowerleg', 'rightfoot', 'righttoebase'],
  ]
  const worldBones = new Map<string, { position: Vector3; rotation: Quaternion }>()
  const rootBone = findGhostLocalBone(localBones, 'hips')
  const rootPosition = rootBone?.translation.clone() ?? Vector3.Zero()
  const rootRotation = rootBone?.rotation.clone() ?? Quaternion.Identity()
  worldBones.set('hips', { position: rootPosition, rotation: rootRotation })

  for (const chain of chains) {
    let parent = findGhostWorldBone(worldBones, chain[0]) ?? worldBones.get('hips') ?? { position: rootPosition, rotation: rootRotation }
    for (const bone of chain.slice(1)) {
      const localBone = findGhostLocalBone(localBones, bone)
      if (!localBone) {
        continue
      }

      const parentRotation = Matrix.Identity()
      Matrix.FromQuaternionToRef(parent.rotation, parentRotation)
      const rotatedOffset = Vector3.TransformNormal(localBone.translation, parentRotation)
      const position = parent.position.add(rotatedOffset)
      const rotation = parent.rotation.multiply(localBone.rotation).normalize()
      parent = { position, rotation }
      worldBones.set(normalizeGhostBoneName(bone), parent)
    }
  }

  const worldPositions = new Map([...worldBones.entries()].map(([key, bone]) => [key, gltfPosePositionToViewport(bone.position)]))
  return worldPositions.size > 1
    ? worldPositions
    : new Map([...localBones.entries()].map(([key, bone]) => [key, gltfPosePositionToViewport(bone.translation)]))
}

function anchorGhostPoseToSamplingPosition(bonePositions: Map<string, Vector3>, anchor: Vector3) {
  const hipsPosition = findGhostBonePosition(bonePositions, 'hips') ?? [...bonePositions.values()][0] ?? Vector3.Zero()
  const offset = new Vector3(anchor.x - hipsPosition.x, anchor.y, anchor.z - hipsPosition.z)
  return new Map([...bonePositions.entries()].map(([key, position]) => [key, position.add(offset)]))
}

function orientGhostPoseToHeading(bonePositions: Map<string, Vector3>, anchor: Vector3, heading: Vector3) {
  const yaw = Math.atan2(heading.x, heading.z) + Math.PI
  const rotation = Matrix.RotationY(yaw)
  return new Map([...bonePositions.entries()].map(([key, position]) => {
    const relative = position.subtract(anchor)
    const rotated = Vector3.TransformCoordinates(relative, rotation).add(anchor)
    return [key, rotated]
  }))
}

function normalizeGhostHeading(heading: Vector3) {
  const flat = new Vector3(heading.x, 0, heading.z)
  return flat.lengthSquared() > 0.0001 ? flat.normalize() : new Vector3(0, 0, 1)
}

function buildGhostSkeletonLines(bonePositions: Map<string, Vector3>) {
  const chains = [
    ['hips', 'spine', 'chest', 'upperchest', 'neck', 'head'],
    ['upperchest', 'leftshoulder', 'leftupperarm', 'leftlowerarm', 'lefthand'],
    ['upperchest', 'rightshoulder', 'rightupperarm', 'rightlowerarm', 'righthand'],
    ['hips', 'leftupperleg', 'leftlowerleg', 'leftfoot', 'lefttoebase'],
    ['hips', 'rightupperleg', 'rightlowerleg', 'rightfoot', 'righttoebase'],
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

const ghostBoneAliases: Record<string, string[]> = {
  hips: ['hips', 'pelvis'],
  spine: ['spine'],
  chest: ['chest', 'spine1'],
  upperchest: ['upperchest', 'spine2'],
  neck: ['neck'],
  head: ['head'],
  leftshoulder: ['leftshoulder'],
  leftupperarm: ['leftupperarm', 'leftarm'],
  leftlowerarm: ['leftlowerarm', 'leftforearm'],
  lefthand: ['lefthand'],
  rightshoulder: ['rightshoulder'],
  rightupperarm: ['rightupperarm', 'rightarm'],
  rightlowerarm: ['rightlowerarm', 'rightforearm'],
  righthand: ['righthand'],
  leftupperleg: ['leftupperleg', 'leftupleg'],
  leftlowerleg: ['leftlowerleg', 'leftleg'],
  leftfoot: ['leftfoot'],
  lefttoebase: ['lefttoebase', 'lefttoe'],
  rightupperleg: ['rightupperleg', 'rightupleg'],
  rightlowerleg: ['rightlowerleg', 'rightleg'],
  rightfoot: ['rightfoot'],
  righttoebase: ['righttoebase', 'righttoe'],
}

function findGhostWorldBone(bones: Map<string, { position: Vector3; rotation: Quaternion }>, boneKey: string) {
  const position = findGhostBonePosition(new Map([...bones.entries()].map(([key, bone]) => [key, bone.position])), boneKey)
  if (!position) {
    return null
  }

  const matchedKey = findGhostBoneKey(bones, boneKey)
  return matchedKey ? bones.get(matchedKey) ?? null : null
}

function findGhostLocalBone(bones: Map<string, GhostLocalBone>, boneKey: string) {
  const matchedKey = findGhostBoneKey(bones, boneKey)
  return matchedKey ? bones.get(matchedKey) ?? null : null
}

function findGhostBonePosition(bonePositions: Map<string, Vector3>, boneKey: string) {
  const matchedKey = findGhostBoneKey(bonePositions, boneKey)
  return matchedKey ? bonePositions.get(matchedKey) ?? null : null
}

function findGhostBoneKey<T>(bones: Map<string, T>, boneKey: string) {
  const normalizedBoneKey = normalizeGhostBoneName(boneKey)
  const aliases = ghostBoneAliases[normalizedBoneKey] ?? [normalizedBoneKey]
  for (const alias of aliases) {
    for (const name of bones.keys()) {
      if (name.endsWith(alias) || name.includes(alias)) {
        return name
      }
    }
  }

  return null
}

function normalizeGhostBoneName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function quaternionFromSamplingArray(values: number[] | undefined) {
  if (!values || values.length < 4 || values.some((value) => !Number.isFinite(value))) {
    return Quaternion.Identity()
  }

  return new Quaternion(values[0], values[1], values[2], values[3]).normalize()
}

function gltfPosePositionToViewport(position: Vector3) {
  return new Vector3(position.x, position.z, position.y)
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
