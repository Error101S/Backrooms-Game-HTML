// Drives the found-footage "camcorder" presentation layer: picks a random recording
// date/time between 1972 and 1997 each time the mode is switched on, ticks an on-screen
// timestamp overlay like a consumer VCR/camcorder OSD, and toggles the VHS post FX pass.
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export class VHSController {
  constructor(postFX, domRefs) {
    this.postFX = postFX;
    this.dom = domRefs; // { tagEl, timestampEl }
    this.enabled = false;
    this.recordSeconds = 0;
    this.currentDate = null;
  }

  toggle() { this.setEnabled(!this.enabled); }

  setEnabled(on) {
    this.enabled = on;
    this.postFX.setVHS(on);
    this.dom.tagEl.classList.toggle('on', on);
    this.dom.timestampEl.classList.toggle('on', on);
    if (on) {
      this._rollNewDate();
      this.recordSeconds = 0;
      this.postFX.vhsPass.uniforms.uEraYear.value = this.currentDate.year;
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

  update(dt) {
    if (!this.enabled) return;
    this.recordSeconds += dt;
    // advance the displayed clock roughly in real time
    this.currentDate.minute += dt / 60;
    while (this.currentDate.minute >= 60) {
      this.currentDate.minute -= 60;
      this.currentDate.hour = (this.currentDate.hour + 1) % 24;
    }
    this._render();
  }

  _render() {
    const d = this.currentDate;
    const hh = String(Math.floor(d.hour)).padStart(2, '0');
    const mm = String(Math.floor(d.minute)).padStart(2, '0');
    const dd = String(d.day).padStart(2, '0');
    this.dom.timestampEl.textContent = `${dd} ${MONTHS[d.month]} ${d.year}  ${hh}:${mm}`;
  }
}
