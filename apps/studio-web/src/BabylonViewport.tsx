import { useCallback, useEffect, useRef, useState } from 'react'
import { Scan } from 'lucide-react'
import {
  AnimationGroup,
  ArcRotateCamera,
  Bone,
  Camera,
  Color3,
  Color4,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  Quaternion,
  Scene,
  SceneLoader,
  TransformNode,
  Vector3,
} from '@babylonjs/core'
import '@babylonjs/loaders/glTF'

interface BabylonViewportProps {
  previewUrl: string | null
  clipPreviewUrl: string | null
  clipFrame: number | null
  clipFrameCount: number | null
  clipFrameRate: number | null
  label: string
}

type CameraView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'iso'
type AxisName = 'x' | 'negX' | 'y' | 'negY' | 'z' | 'negZ'
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

const isoViewDirection = new Vector3(-1, 0.8, -1).normalize()

function getPerspectiveHalfHeight(camera: ArcRotateCamera, radius: number) {
  return Math.max(radius * Math.tan(camera.fov * 0.5), 0.01)
}

export function BabylonViewport({ previewUrl, clipPreviewUrl, clipFrame, clipFrameCount, clipFrameRate, label }: BabylonViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sceneRef = useRef<Scene | null>(null)
  const cameraRef = useRef<ArcRotateCamera | null>(null)
  const axisTriadRef = useRef<SVGSVGElement | null>(null)
  const importedMeshesRef = useRef<Mesh[]>([])
  const clipSourceNodesRef = useRef<TransformNode[]>([])
  const clipAnimationRef = useRef<AnimationGroup | null>(null)
  const characterPoseRef = useRef(new Map<PoseTarget, PoseSnapshot>())
  const clipScrubRef = useRef({ frame: clipFrame, frameCount: clipFrameCount, frameRate: clipFrameRate })
  const [cameraMode, setCameraMode] = useState<'perspective' | 'orthographic'>('perspective')
  const [status, setStatus] = useState<ViewportStatus>({ kind: 'empty', message: 'Empty scene' })
  const [animationState, setAnimationState] = useState('none')
  const [modelVersion, setModelVersion] = useState(0)
  const statusText = status.kind === 'ready' ? label : status.message

  useEffect(() => {
    clipScrubRef.current = { frame: clipFrame, frameCount: clipFrameCount, frameRate: clipFrameRate }
  }, [clipFrame, clipFrameCount, clipFrameRate])

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

    window.addEventListener('resize', handleResize)
    window.addEventListener('keydown', handleKeyDown)
    engine.runRenderLoop(() => {
      updateOrthographicBounds()
      updateNavigationWidget()
      scene.render()
    })

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('keydown', handleKeyDown)
      importedMeshesRef.current = []
      clipAnimationRef.current?.dispose()
      clipAnimationRef.current = null
      for (const node of clipSourceNodesRef.current) {
        node.dispose(false, true)
      }
      clipSourceNodesRef.current = []
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
        const retargeted = sourceGroup ? retargetAnimationGroup(sourceGroup, targetMap) : null
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
  }, [applyClipFrame, clipPreviewUrl, modelVersion, restoreCharacterPose])

  useEffect(() => {
    const animationGroup = clipAnimationRef.current
    if (!animationGroup) {
      return
    }

    applyClipFrame(animationGroup)
  }, [applyClipFrame, clipFrame, clipFrameCount, clipFrameRate])

  return (
    <section className="viewport-panel" aria-label="3D viewport" data-animation-state={animationState}>
      <canvas ref={canvasRef} className="viewport-canvas" />
      <div className="viewport-status">{statusText}</div>
      <div className="viewport-toolbar" aria-label="Viewport tools">
        <button type="button" onClick={frameMeshes} title="Frame selection" aria-label="Frame selection">
          <Scan size={15} aria-hidden="true" />
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

function retargetAnimationGroup(sourceGroup: AnimationGroup, targetMap: Map<string, unknown>) {
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

    retargetedGroup.addTargetedAnimation(targetedAnimation.animation.clone(), target)
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
    return sourceName === 'hips' || sourceName === 'root' || sourceName === 'skeleton'
  }

  return true
}

function createGroundGrid(scene: Scene) {
  const extent = 500
  const minorStep = 10
  const majorStep = 50
  const minorLines: Vector3[][] = []
  const majorLines: Vector3[][] = []

  for (let value = -extent; value <= extent; value += minorStep) {
    const target = value % majorStep === 0 ? majorLines : minorLines
    target.push([new Vector3(-extent, 0, value), new Vector3(extent, 0, value)])
    target.push([new Vector3(value, 0, -extent), new Vector3(value, 0, extent)])
  }

  const minorGrid = MeshBuilder.CreateLineSystem('ground-grid-minor', { lines: minorLines }, scene)
  minorGrid.color = new Color3(0.23, 0.25, 0.29)
  minorGrid.alpha = 0.55
  minorGrid.isPickable = false

  const majorGrid = MeshBuilder.CreateLineSystem('ground-grid-major', { lines: majorLines }, scene)
  majorGrid.color = new Color3(0.34, 0.37, 0.43)
  majorGrid.alpha = 0.75
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
