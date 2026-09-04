// Drives the found-footage "camcorder" presentation layer: a full consumer-camcorder
// viewfinder overlay (REC dot, running tape timecode, SP/AUTO mode tag, battery gauge,
// viewfinder corner brackets, an occasional auto-focus "hunt" bracket flash) plus a random
// recording date/time between 1972 and 1997 that ticks forward like the OSD clock burned into
// the tape by the camcorder itself, layered on top of the VHSShader image-degradation pass.
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export class VHSController {
  constructor(postFX, domRefs) {
    this.postFX = postFX;
    // domRefs: { tagEl, timestampEl, timecodeEl, batteryPctEl, batteryFillEl, focusEl, hudEl }
    this.dom = domRefs;
    this.enabled = false;
    this.recordSeconds = 0;
    this.currentDate = null;
    this.battery = 1;
    this._focusHuntTimer = this._nextFocusHuntDelay();
  }

  toggle() { this.setEnabled(!this.enabled); }

  setEnabled(on) {
    this.enabled = on;
    this.postFX.setVHS(on);
    if (this.dom.hudEl) this.dom.hudEl.classList.toggle('on', on);
    if (on) {
      this._rollNewDate();
      this.recordSeconds = 0;
      this.battery = 0.7 + Math.random() * 0.25;
      this.postFX.vhsPass.uniforms.uEraYear.value = this.currentDate.year;
      this._render();
    }
  }

  _rollNewDate() {
    const startYear = 1972, endYear = 1997;
    const year = startYear + Math.floor(Math.random() * (endYear - startYear + 1));
    const month = Math.floor(Math.random() * 12);
    const day = 1 + Math.floor(Math.random() * 28);
    const hour = Math.floor(Math.random() * 24);
    const minute = Math.floor(Math.random() * 60);
    this.currentDate = { year, month, day, hour, minute };
  }

  _nextFocusHuntDelay() {
    return 6 + Math.random() * 14; // an autofocus "hunt" flash every 6-20s, like a real camcorder
  }

  update(dt) {
    if (!this.enabled) return;
    this.recordSeconds += dt;

    // advance the displayed clock roughly in real time (this is the tape's burned-in OSD clock)
    this.currentDate.minute += dt / 60;
    while (this.currentDate.minute >= 60) {
      this.currentDate.minute -= 60;
      this.currentDate.hour = (this.currentDate.hour + 1) % 24;
    }

    // battery slowly drains over a recording session, like a real camcorder pack
    this.battery = Math.max(0, this.battery - dt * 0.0025);

    // occasional autofocus hunt: viewfinder brackets flash in in response to "refocusing"
    this._focusHuntTimer -= dt;
    if (this._focusHuntTimer <= 0) {
      this._focusHuntTimer = this._nextFocusHuntDelay();
      this._flashFocusHunt();
    }

    this._render();
  }

  _flashFocusHunt() {
    const el = this.dom.focusEl;
    if (!el) return;
    el.classList.add('show');
    clearTimeout(this._focusHuntClearTimeout);
    this._focusHuntClearTimeout = setTimeout(() => el.classList.remove('show'), 550);
  }

  _render() {
    const d = this.currentDate;
    const hh = String(Math.floor(d.hour)).padStart(2, '0');
    const mm = String(Math.floor(d.minute)).padStart(2, '0');
    const dd = String(d.day).padStart(2, '0');
    if (this.dom.dateLineEl) this.dom.dateLineEl.textContent = `${dd} ${MONTHS[d.month]} ${d.year}`;
    if (this.dom.timeLineEl) this.dom.timeLineEl.textContent = `${hh}:${mm}`;

    // running tape counter, HH:MM:SS:FF (frames, NTSC-style 30fps) since REC was pressed --
    // classic camcorder timecode burned into the corner of the viewfinder.
    if (this.dom.timecodeEl) {
      const total = this.recordSeconds;
      const th = Math.floor(total / 3600);
      const tm = Math.floor((total % 3600) / 60);
      const ts = Math.floor(total % 60);
      const tf = Math.floor((total % 1) * 30);
      const pad = (n) => String(n).padStart(2, '0');
      this.dom.timecodeEl.textContent = `${pad(th)}:${pad(tm)}:${pad(ts)}:${pad(tf)}`;
    }

    if (this.dom.batteryPctEl) this.dom.batteryPctEl.textContent = Math.round(this.battery * 100) + '%';
    if (this.dom.batteryFillEl) this.dom.batteryFillEl.style.width = Math.round(this.battery * 100) + '%';
  }
}
