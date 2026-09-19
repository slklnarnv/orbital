import * as THREE from 'three'
import type CameraControls from 'camera-controls'

const position = new THREE.Vector3()
const target = new THREE.Vector3()
const endPosition = new THREE.Vector3()
const endTarget = new THREE.Vector3()
const up = new THREE.Vector3()
const right = new THREE.Vector3()
const horizontal = new THREE.Quaternion()
const vertical = new THREE.Quaternion()

/**
 * setLookAt() clears camera-controls' user-controlling flags, which select
 * between its user-input and programmatic damping. Rotating while a wheel dolly
 * or right-drag truck is still settling would otherwise silently switch that
 * motion to programmatic damping. Snapshot and restore them across the calls.
 */
function preserveUserControlFlags(controls: CameraControls, run: () => void): void {
  const internals = controls as unknown as {
    _isUserControllingRotate?: boolean
    _isUserControllingDolly?: boolean
    _isUserControllingTruck?: boolean
  }
  const rotate = internals._isUserControllingRotate
  const dolly = internals._isUserControllingDolly
  const truck = internals._isUserControllingTruck
  run()
  if (rotate) internals._isUserControllingRotate = true
  if (dolly) internals._isUserControllingDolly = true
  if (truck) internals._isUserControllingTruck = true
}

/** Rotate the eye and its up vector together, without a world-pole singularity. */
export function rotateOrbit(controls: CameraControls, yaw: number, pitch: number): void {
  const camera = controls.camera
  controls.getPosition(position, false)
  controls.getTarget(target, false)
  controls.getPosition(endPosition)
  controls.getTarget(endTarget)
  up.set(0, 1, 0).applyQuaternion(camera.quaternion)
  right.set(1, 0, 0).applyQuaternion(camera.quaternion)
  horizontal.setFromAxisAngle(up, yaw)
  vertical.setFromAxisAngle(right, pitch)
  horizontal.multiply(vertical)
  position.sub(target).applyQuaternion(horizontal).add(target)
  endPosition.sub(endTarget).applyQuaternion(horizontal).add(endTarget)
  camera.up.copy(up).applyQuaternion(horizontal).normalize()
  controls.updateCameraUp()
  preserveUserControlFlags(controls, () => {
    void controls.setLookAt(position.x, position.y, position.z, target.x, target.y, target.z, false)
    // Preserve queued dolly/pan motion instead of cancelling it whenever we rotate.
    void controls.setLookAt(endPosition.x, endPosition.y, endPosition.z, endTarget.x, endTarget.y, endTarget.z, true)
  })
  controls.update(0)
}

/** Owns only rotation; camera-controls continues to own pan, dolly and flights. */
export class FreeOrbitControls {
  private readonly pointers = new Map<number, { x: number; y: number }>()
  private pendingX = 0
  private pendingY = 0
  private enabled = false

  constructor(private readonly element: HTMLElement) {
    element.addEventListener('pointerdown', this.pointerDown)
    element.ownerDocument.addEventListener('pointermove', this.pointerMove)
    element.ownerDocument.addEventListener('pointerup', this.pointerUp)
    element.ownerDocument.addEventListener('pointercancel', this.pointerUp)
  }

  private readonly pointerDown = (event: PointerEvent): void => {
    this.pendingX = 0
    this.pendingY = 0
    if (event.pointerType !== 'touch' && event.button !== 0) return
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (this.enabled) this.element.setPointerCapture(event.pointerId)
  }

  private readonly pointerMove = (event: PointerEvent): void => {
    const previous = this.pointers.get(event.pointerId)
    if (!previous) return
    if (this.enabled && this.pointers.size === 1 && (event.pointerType === 'touch' || (event.buttons & 1))) {
      this.pendingX += event.clientX - previous.x
      this.pendingY += event.clientY - previous.y
    }
    previous.x = event.clientX
    previous.y = event.clientY
  }

  private readonly pointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId)
    if (this.element.hasPointerCapture(event.pointerId)) this.element.releasePointerCapture(event.pointerId)
    if (event.type === 'pointercancel') { this.pendingX = 0; this.pendingY = 0 }
  }

  update(controls: CameraControls, deltaSeconds: number, enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) { this.pendingX = 0; this.pendingY = 0; return }
    if (Math.abs(this.pendingX) + Math.abs(this.pendingY) < 0.001) return
    const blend = 1 - Math.exp(-18 * Math.min(deltaSeconds, 0.05))
    const dx = this.pendingX * blend
    const dy = this.pendingY * blend
    this.pendingX -= dx
    this.pendingY -= dy
    const pixelsToAngle = Math.PI * 2 / Math.max(1, this.element.clientHeight)
    rotateOrbit(controls, -dx * pixelsToAngle * controls.azimuthRotateSpeed, -dy * pixelsToAngle * controls.polarRotateSpeed)
  }

  dispose(): void {
    this.element.removeEventListener('pointerdown', this.pointerDown)
    this.element.ownerDocument.removeEventListener('pointermove', this.pointerMove)
    this.element.ownerDocument.removeEventListener('pointerup', this.pointerUp)
    this.element.ownerDocument.removeEventListener('pointercancel', this.pointerUp)
    for (const id of this.pointers.keys()) {
      if (this.element.hasPointerCapture(id)) this.element.releasePointerCapture(id)
    }
    this.pointers.clear()
  }
}
