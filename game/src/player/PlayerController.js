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
// and stamina-gated sprint. There is no water anywhere in this game (plain Backrooms),
// so movement/gravity are uniform in every zone.
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

    // -- camera feel state (head bob polish, turn roll, landing dip) --
    this.prevYaw = this.yaw;
    this.turnTilt = 0;        // smoothed roll driven purely by look/turn angular velocity
    this.bobTilt = 0;         // smoothed roll driven by the walk cycle (separate from turnTilt)
    this.landDip = 0;         // transient vertical dip on hard landings, decays like a damped spring
    this.landDipVel = 0;
    this._wasOnGround = true;
    this._prevFallSpeed = 0;

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
    if (this.onGround && input.jumpPressed && !this.crouching) {
      this.velocity.y = JUMP_SPEED;
      this.onGround = false;
    }
    this.velocity.y += GRAVITY * dt;
    if (this.velocity.y < -30) this.velocity.y = -30;

    // capture pre-resolution fall speed so a hard landing can drive an impact dip below
    const fallSpeedBeforeMove = this.velocity.y;
    this._moveWithCollision(dt);

    // landing impact: a small critically-damped spring kicks downward on touchdown, sized by
    // how fast the player was falling, then eases back to neutral over a few frames -- reads as
    // a soft "thud" instead of the camera silently snapping back to eye height.
    if (!this._wasOnGround && this.onGround) {
      const impactSpeed = Math.max(0, -fallSpeedBeforeMove);
      this.landDipVel -= Math.min(2.6, impactSpeed * 0.34);
    }
    this._wasOnGround = this.onGround;
    {
      const springK = 210, springD = 19; // stiff + fairly damped: quick dip, quick recover, no wobble
      const accel = -springK * this.landDip - springD * this.landDipVel;
      this.landDipVel += accel * dt;
      this.landDip += this.landDipVel * dt;
    }

    // eye height smoothing (crouch transitions)
    const targetEye = this.crouching ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, dt * 10);

    // head bob based on horizontal speed
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.currentSpeed = speed;
    if (this.onGround && speed > 0.15) {
      const bobSpeed = wantRun ? 11.5 : 8.0;
      this.bobPhase += dt * bobSpeed * (speed / targetSpeed);
      this.bobAmount = THREE.MathUtils.lerp(this.bobAmount, 1, dt * 7);
    } else {
      this.bobAmount = THREE.MathUtils.lerp(this.bobAmount, 0, dt * 5);
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

    // -- head bob: a two-harmonic Lissajous walk cycle instead of a single sine --
    // The vertical bounce blends the fundamental with a soft second harmonic (a classic
    // view-bob trick borrowed from Source/Quake-style FPS cameras): the extra sin(2*phase)
    // term flattens the very top/bottom of the arc and adds a quicker double-tap right as
    // the foot "lands", which reads far more like an actual footfall than a pure sine ever
    // does. Lateral sway runs at half the vertical frequency (one full left-right cycle per
    // two vertical bounces = one cycle per full stride, matching how a body actually sways
    // between left and right footfalls) and picks up a little extra swing on a run.
    const runSwing = wantRun ? 1.25 : 1.0;
    const bobYTarget = (Math.sin(this.bobPhase) * 0.82 + Math.sin(this.bobPhase * 2.0) * 0.22)
      * 0.05 * this.bobAmount;
    const bobXTarget = Math.cos(this.bobPhase * 0.5) * 0.034 * this.bobAmount * runSwing;
    // Smooth the bob offsets themselves (in addition to bobAmount's attack/release) so that
    // sudden changes in ground/speed state never produce a visible pop in camera position.
    this._bobY = THREE.MathUtils.lerp(this._bobY ?? 0, bobYTarget, Math.min(1, dt * 18));
    this._bobX = THREE.MathUtils.lerp(this._bobX ?? 0, bobXTarget, Math.min(1, dt * 18));

    this.camera.position.set(
      this.position.x + this._bobX,
      this.position.y + this.eyeHeight + this._bobY + this.landDip,
      this.position.z
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    // -- camera roll, two independent contributions --
    // 1) bobTilt: the existing walk-cycle roll (subtle sway synced to footfalls), now smoothed
    //    rather than assigned outright so it blends cleanly with turnTilt below.
    const bobTiltTarget = Math.sin(this.bobPhase) * 0.0075 * this.bobAmount * (wantRun ? 1.4 : 1);
    this.bobTilt = THREE.MathUtils.lerp(this.bobTilt, bobTiltTarget, Math.min(1, dt * 14));

    // 2) turnTilt: a genuine "banking" roll driven purely by how fast the player is turning the
    //    camera (mouse/stick look), independent of movement or footsteps -- turning quickly to
    //    the right banks the camera slightly right, like leaning into a turn, then eases back to
    //    level once the look input stops. Uses the wrap-safe shortest-angle delta between this
    //    frame's yaw and last frame's so it behaves correctly across the +-PI wrap boundary.
    let dyaw = this.yaw - this.prevYaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const yawVel = dt > 1e-5 ? dyaw / dt : 0;
    this.prevYaw = this.yaw;

    const MAX_TURN_TILT = 0.055; // ~3.15 degrees max bank, enough to feel intentional, not seasick
    const turnTiltTarget = THREE.MathUtils.clamp(-yawVel * 0.05, -MAX_TURN_TILT, MAX_TURN_TILT);
    // snap into a turn quickly, ease back out of it more slowly for a natural bank-and-recover feel
    const turnSmoothRate = Math.abs(turnTiltTarget) > Math.abs(this.turnTilt) ? 16 : 6;
    this.turnTilt = THREE.MathUtils.lerp(this.turnTilt, turnTiltTarget, Math.min(1, dt * turnSmoothRate));

    this.camera.rotation.z = this.bobTilt + this.turnTilt;
  }

  drainFootsteps() {
    const events = this.footstepEvents;
    this.footstepEvents = [];
    return events;
  }

  _moveWithCollision(dt) {
    // Integrate X and Z separately against nearby wall segments (capsule vs oriented box),
    // which gives clean sliding along walls: moving into a wall along one axis stops just that
    // axis's velocity while the other axis (e.g. sliding sideways along the wall) is untouched.
    //
    // Each axis pass snaps the player directly to the wall's surface (rather than adding an
    // incremental "push" on top of whatever the previous frame left behind), which is what
    // makes standing at/waiting against a wall feel stable instead of shoved: with a push-based
    // correction the player is nudged out by a small amount every single frame that motion
    // + resolution disagree, which reads as a constant jitter/shove even while stationary.
    let px = this.position.x, pz = this.position.z;
    const dx = this.velocity.x * dt;
    const dz = this.velocity.z * dt;

    const rx = this._resolveAxis('x', px, pz, dx);
    if (rx.hit) this.velocity.x = 0;
    px = rx.value;

    const rz = this._resolveAxis('z', px, pz, dz);
    if (rz.hit) this.velocity.z = 0;
    pz = rz.value;

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

  // Resolves motion along a single named world axis ('x' or 'z') against every nearby wall
  // segment, snapping the position to the exact wall surface on contact instead of accumulating
  // an outward "push". Takes an explicit `axis` rather than inferring it from whether the delta
  // is nonzero -- inferring from delta is unsound whenever velocity on that axis happens to be
  // exactly 0 (e.g. player stationary, or moving purely along the other axis), which previously
  // caused this function to silently return the *other* axis's coordinate and stomp the wrong
  // component of the player's position every such frame (the actual cause of the "walking into
  // a wall / waiting just pushes me" bug -- the corruption, not a real physics push).
  _resolveAxis(axis, px, pz, delta) {
    let nx = axis === 'x' ? px + delta : px;
    let nz = axis === 'z' ? pz + delta : pz;
    const r = PLAYER_RADIUS;
    const segments = this.map.queryWallsNear(nx, nz, r + 1.5);
    const halfT = this.map.wallThickness / 2;
    const EPS = 1e-4; // tiny buffer past the boundary so repeated frames don't re-trigger from fp noise
    let hit = false;

    for (const seg of segments) {
      if (seg.orient === 0) {
        // vertical wall: infinite-ish plane at x=seg.x, spanning z in [z0,z1], thickness halfT
        const closestZ = THREE.MathUtils.clamp(nz, seg.z0, seg.z1);
        const distX = nx - seg.x;
        const withinZ = Math.abs(nz - closestZ) < r;
        if (withinZ && Math.abs(distX) < (halfT + r) && axis === 'x') {
          const side = Math.sign(px - seg.x) || Math.sign(distX) || 1;
          nx = seg.x + side * (halfT + r + EPS);
          hit = true;
        }
      } else {
        const closestX = THREE.MathUtils.clamp(nx, seg.x0, seg.x1);
        const distZ = nz - seg.z;
        const withinX = Math.abs(nx - closestX) < r;
        if (withinX && Math.abs(distZ) < (halfT + r) && axis === 'z') {
          const side = Math.sign(pz - seg.z) || Math.sign(distZ) || 1;
          nz = seg.z + side * (halfT + r + EPS);
          hit = true;
        }
      }
    }
    return { value: axis === 'x' ? nx : nz, hit };
  }
}
