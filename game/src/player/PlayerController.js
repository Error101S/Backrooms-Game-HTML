import * as THREE from 'three';

const GRAVITY = -18.0;
const JUMP_SPEED = 6.0;
const WALK_SPEED = 2.6;
const RUN_SPEED = 5.0;
const CROUCH_SPEED = 1.4;
const ACCEL = 22.0;
const AIR_ACCEL = 6.0;
const FRICTION = 14.0;
const EYE_HEIGHT = 1.68;
const CROUCH_EYE_HEIGHT = 1.05;
const PLAYER_RADIUS = 0.32;

// First-person controller: acceleration-based ground movement, gravity + jump,
// capsule-vs-wall-segment collision resolved via the map's spatial hash, head bob,
// stamina-gated sprint, and simple wading behaviour inside flooded (water) zones.
export class PlayerController {
  constructor(camera, mapData, input) {
    this.camera = camera;
    this.map = mapData;
    this.input = input;

    this.position = new THREE.Vector3(mapData.spawn.x, EYE_HEIGHT, mapData.spawn.z);
    this.velocity = new THREE.Vector3();
    this.yaw = Math.PI; // face into the mapped interior by default
    this.pitch = 0;
    this.onGround = true;
    this.eyeHeight = EYE_HEIGHT;
    this.crouching = false;
    this.inWater = false;

    this.stamina = 1;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.currentSpeed = 0;
    this.footstepAccum = 0;
    this.footstepEvents = [];
    this.sensitivity = 1.0;

    this._tmpVec = new THREE.Vector3();
  }

  handleLook(dx, dy) {
    const s = 0.0022 * this.sensitivity;
    this.yaw -= dx * s;
    this.pitch -= dy * s;
    // wrap yaw to (-PI, PI] so it never loses float precision over a long play session
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
    const lim = Math.PI / 2 - 0.02;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -lim, lim);
  }

  update(dt) {
    const input = this.input;
    const move = input.moveVector;
    const wantRun = input.running && !this.crouching && this.stamina > 0.02;
    const wantCrouch = input.isDown('ControlLeft') || input.isDown('KeyC');
    this.crouching = wantCrouch && this.onGround;

    // stamina drains while sprinting & actually moving, regens otherwise
    const moving = (move.x !== 0 || move.z !== 0);
    if (wantRun && moving) this.stamina = Math.max(0, this.stamina - dt * 0.28);
    else this.stamina = Math.min(1, this.stamina + dt * 0.16);

    const targetSpeed = this.crouching ? CROUCH_SPEED : (wantRun ? RUN_SPEED : WALK_SPEED);

    // build desired horizontal direction in world space from camera yaw
    // Camera looks down local -Z; rotating that by yaw around Y gives the forward vector below.
    // "right" = cross(forward, worldUp) so that pressing D (move.x > 0) strafes to the camera's right.
    const forward = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(-1);
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const wishDir = new THREE.Vector3();
    wishDir.addScaledVector(forward, -move.z);
    wishDir.addScaledVector(right, move.x);
    if (wishDir.lengthSq() > 1e-6) wishDir.normalize();

    const accel = this.onGround ? ACCEL : AIR_ACCEL;
    const wishVel = wishDir.multiplyScalar(targetSpeed);

    // Accelerate the horizontal velocity toward the wish velocity, then apply ground friction
    // when there is no input -- a simple, stable, Quake-style movement model.
    const curH = new THREE.Vector2(this.velocity.x, this.velocity.z);
    if (moving) {
      const towards = new THREE.Vector2(wishVel.x, wishVel.z).sub(curH);
      const maxDelta = accel * dt;
      if (towards.length() > maxDelta) towards.setLength(maxDelta);
      curH.add(towards);
    } else if (this.onGround) {
      const speed = curH.length();
      const drop = FRICTION * dt;
      const newSpeed = Math.max(0, speed - drop);
      if (speed > 1e-5) curH.multiplyScalar(newSpeed / speed);
    }
    this.velocity.x = curH.x;
    this.velocity.z = curH.y;

    // gravity + jump
    const inWater = this.map.zoneAt(this.position.x, this.position.z) === this.map.waterZone;
    this.inWater = inWater;
    const gravity = inWater ? GRAVITY * 0.35 : GRAVITY;
    if (this.onGround && input.jumpPressed && !this.crouching) {
      this.velocity.y = inWater ? JUMP_SPEED * 0.6 : JUMP_SPEED;
      this.onGround = false;
    }
    this.velocity.y += gravity * dt;
    if (this.velocity.y < -30) this.velocity.y = -30;

    this._moveWithCollision(dt);

    // eye height smoothing (crouch transitions)
    const targetEye = this.crouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 10);

    // head bob based on horizontal speed
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.currentSpeed = speed;
    if (this.onGround && speed > 0.15) {
      const bobSpeed = wantRun ? 11.5 : 8.0;
      this.bobPhase += dt * bobSpeed * (speed / targetSpeed);
      this.bobAmount = THREE.MathUtils.lerp(this.bobAmount, 1, dt * 6);
    } else {
      this.bobAmount = THREE.MathUtils.lerp(this.bobAmount, 0, dt * 6);
    }

    // footstep event timing
    if (this.onGround && speed > 0.2) {
      const interval = wantRun ? 0.32 : 0.48;
      this.footstepAccum += dt * (speed / targetSpeed);
      if (this.footstepAccum >= interval) {
        this.footstepAccum = 0;
        this.footstepEvents.push({ running: wantRun });
      }
    } else {
      this.footstepAccum = Math.min(this.footstepAccum, 0.1);
    }

    // apply to camera
    const bobY = Math.sin(this.bobPhase) * 0.045 * this.bobAmount;
    const bobX = Math.cos(this.bobPhase * 0.5) * 0.03 * this.bobAmount;
    this.camera.position.set(this.position.x + bobX, this.position.y + this.eyeHeight + bobY, this.position.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    const tilt = Math.sin(this.bobPhase) * 0.008 * this.bobAmount * (wantRun ? 1.4 : 1);
    this.camera.rotation.z = tilt;
  }

  drainFootsteps() {
    const events = this.footstepEvents;
    this.footstepEvents = [];
    return events;
  }

  _moveWithCollision(dt) {
    // Integrate X and Z separately against nearby wall segments (AABB-ish capsule vs oriented box),
    // which gives smooth sliding along walls without complex penetration solving.
    let px = this.position.x, pz = this.position.z;
    const dx = this.velocity.x * dt;
    const dz = this.velocity.z * dt;

    px = this._resolveAxis(px, pz, dx, 0);
    pz = this._resolveAxis(px, pz, 0, dz);

    this.position.x = px;
    this.position.z = pz;

    // vertical (single flat story, matching the reference blueprint's mapped level)
    this.position.y += this.velocity.y * dt;
    if (this.position.y <= 0) {
      this.position.y = 0;
      this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }
  }

  _resolveAxis(px, pz, dx, dz) {
    let nx = px + dx;
    let nz = pz + dz;
    const r = PLAYER_RADIUS;
    const segments = this.map.queryWallsNear(nx, nz, r + 1.5);
    const halfT = this.map.wallThickness / 2;

    for (const seg of segments) {
      if (seg.orient === 0) {
        // vertical wall: infinite-ish plane at x=seg.x, spanning z in [z0,z1], thickness halfT
        const closestZ = THREE.MathUtils.clamp(nz, seg.z0, seg.z1);
        const distX = nx - seg.x;
        const withinZ = Math.abs(nz - closestZ) < r;
        if (withinZ && Math.abs(distX) < (halfT + r)) {
          const push = (halfT + r) - Math.abs(distX);
          nx += Math.sign(distX || 1) * push;
        }
      } else {
        const closestX = THREE.MathUtils.clamp(nx, seg.x0, seg.x1);
        const distZ = nz - seg.z;
        const withinX = Math.abs(nx - closestX) < r;
        if (withinX && Math.abs(distZ) < (halfT + r)) {
          const push = (halfT + r) - Math.abs(distZ);
          nz += Math.sign(distZ || 1) * push;
        }
      }
    }
    return dx !== 0 ? nx : nz;
  }
}
