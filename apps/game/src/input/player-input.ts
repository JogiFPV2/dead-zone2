import type { Camera } from 'three';
import type { Gait } from '@deadzone/protocol';
import type { SimClient } from '../sim/sim-client.js';
import type { CommandStamper } from '../sim/sim-client.js';
import { worldToSimFloor } from '../sim/coords.js';
import { clientToNdc, ndcToFloor } from './aim.js';
import type { InputMap } from './input-map.js';
import { IDLE_STICK, stickMove, type StickVector } from './touch/virtual-stick.js';
import { moveDirection, sameMove, type MoveKeys, type MoveVector } from './move-direction.js';

/** Minimum gap between aim commands (one per 20 Hz tick is plenty). */
const AIM_INTERVAL_MS = 50;
const AIM_EPS = 0.01;

/** Held move actions (bindings decide which keys). */
export const moveKeys = (input: InputMap): MoveKeys => ({
  up: input.isDown('moveUp'),
  down: input.isDown('moveDown'),
  left: input.isDown('moveLeft'),
  right: input.isDown('moveRight'),
});

/**
 * Gait of `move`: hold sprint = sprint (sim #126: endurance checks may drop it to run), else walk.
 * Sneaking is the `setSneak` toggle (`C`, input/sneak-toggle.ts): the sim turns walk into sneak
 * while it is on and switches it off on run / sprint (sim #205).
 */
export const moveGait = (input: Pick<InputMap, 'isDown'>): Gait =>
  input.isDown('sprint') ? 'sprint' : 'walk';

/**
 * Turns move actions + mouse into sim commands. Call update() every frame: move is sent only when
 * the direction changes (including after a camera rotation), aim at most every AIM_INTERVAL_MS.
 */
export class PlayerInput {
  private lastMove: MoveVector = { dx: 0, dy: 0 };
  private lastGait: Gait = 'walk';
  private pointer: { x: number; y: number } | undefined;
  private lastAim: { x: number; y: number } | undefined;
  private lastAimMs = -Infinity;
  /** Touch joystick (`TouchControls`); idle = keys decide. */
  private stick: () => StickVector = () => IDLE_STICK;
  private readonly onPointer = (e: PointerEvent): void => {
    // Touch aims only from the aim zone (`setTouchAim`), never from a tap or a drag elsewhere.
    if (e.pointerType === 'touch') return;
    this.pointer = clientToNdc(e.clientX, e.clientY, this.element.getBoundingClientRect());
  };

  constructor(
    private readonly element: HTMLElement,
    private readonly input: InputMap,
    private readonly sim: SimClient,
    private readonly stamper: CommandStamper,
  ) {
    element.addEventListener('pointermove', this.onPointer);
  }

  /** Touch aim zone: aim at this client point (CSS px); `undefined` = no touch aim. */
  setTouchAim(p: { x: number; y: number } | undefined): void {
    this.pointer = p ? clientToNdc(p.x, p.y, this.element.getBoundingClientRect()) : undefined;
  }

  /** Joystick source (touch): while deflected it replaces WASD (`stickMove`, full = run). */
  setStick(stick: () => StickVector): void {
    this.stick = stick;
  }

  update(nowMs: number, cameraYaw: number, camera: Camera): void {
    const v = this.stick();
    const fromStick = v.mag > 0 ? stickMove(v, cameraYaw) : undefined;
    const move = fromStick ?? moveDirection(moveKeys(this.input), cameraYaw);
    const gait = fromStick?.gait ?? moveGait(this.input);
    if (!sameMove(move, this.lastMove) || gait !== this.lastGait) {
      this.lastMove = { dx: move.dx, dy: move.dy };
      this.lastGait = gait;
      this.sim.send(this.stamper.stamp({ type: 'move', dx: move.dx, dy: move.dy, gait }));
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
    this.element.removeEventListener('pointermove', this.onPointer);
  }
}
