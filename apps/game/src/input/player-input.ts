import type { Camera } from 'three';
import type { SimClient } from '../sim/sim-client.js';
import type { CommandStamper } from '../sim/sim-client.js';
import { worldToSimFloor } from '../sim/coords.js';
import { clientToNdc, ndcToFloor } from './aim.js';
import { trackMoveKeys } from './keyboard.js';
import { moveDirection, sameMove, type MoveVector } from './move-direction.js';

/** Minimum gap between aim commands (one per 20 Hz tick is plenty). */
const AIM_INTERVAL_MS = 50;
const AIM_EPS = 0.01;

/**
 * Turns WASD + mouse into sim commands. Call update() every frame: move is sent only when
 * the direction changes (including after a camera rotation), aim at most every AIM_INTERVAL_MS.
 */
export class PlayerInput {
  private readonly keyboard = trackMoveKeys();
  private lastMove: MoveVector = { dx: 0, dy: 0 };
  private pointer: { x: number; y: number } | undefined;
  private lastAim: { x: number; y: number } | undefined;
  private lastAimMs = -Infinity;
  private readonly onPointer = (e: PointerEvent): void => {
    this.pointer = clientToNdc(e.clientX, e.clientY, this.element.getBoundingClientRect());
  };

  constructor(
    private readonly element: HTMLElement,
    private readonly sim: SimClient,
    private readonly stamper: CommandStamper,
  ) {
    element.addEventListener('pointermove', this.onPointer);
  }

  update(nowMs: number, cameraYaw: number, camera: Camera): void {
    const move = moveDirection(this.keyboard.keys, cameraYaw);
    if (!sameMove(move, this.lastMove)) {
      this.lastMove = move;
      this.sim.send(this.stamper.stamp({ type: 'move', ...move }));
    }
    if (!this.pointer || nowMs - this.lastAimMs < AIM_INTERVAL_MS) return;
    const hit = ndcToFloor(camera, this.pointer.x, this.pointer.y);
    if (!hit) return;
    const aim = worldToSimFloor(hit.x, hit.z);
    const last = this.lastAim;
    if (last && Math.hypot(aim.x - last.x, aim.y - last.y) < AIM_EPS) return;
    this.lastAim = aim;
    this.lastAimMs = nowMs;
    this.sim.send(this.stamper.stamp({ type: 'aim', ...aim }));
  }

  dispose(): void {
    this.keyboard.dispose();
    this.element.removeEventListener('pointermove', this.onPointer);
  }
}
