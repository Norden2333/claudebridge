import {ESTABLISHED_CHANNEL_GRACE_MS,INITIAL_CHANNEL_GRACE_MS} from './connection-timing.mjs';
// Supervises channels only: never repeats a file operation or changes a route.
export class RelayRecovery {
  constructor({ now = Date.now, random = Math.random } = {}) {
    this.now = now; this.random = random; this.reset();
  }
  reset() { this.attempt = 0; this.nextAt = 0; this.lostAt = null; this.onlineAt = null; this.state = 'idle'; this.established = false;this.reason='';this.noProxyFailures=0; }
  observe(state,reason) {
    if(reason)this.reason=reason;
    if(state==='reconnecting'&&reason==='no_proxy_found')this.noProxyFailures++;
    const time = this.now(); this.state = state;
    if (state === 'online') {
      this.reason='';this.noProxyFailures=0;this.established = true; this.lostAt = null; this.onlineAt ??= time;
      if (time - this.onlineAt >= 60000) { this.attempt = 0; this.nextAt = 0; }
    } else {
      this.onlineAt = null;
      if (state === 'auth_required' || state === 'blocked') this.lostAt = null;
      else this.lostAt ??= time;
    }
  }
  failed() {
    if(this.reason==='no_proxy_found'&&this.noProxyFailures>=3){this.state='blocked';this.nextAt=this.now()+300000;return this.nextAt;}
    const base = [1000, 2000, 5000, 10000, 30000, 60000, 120000][Math.min(this.attempt, 6)];
    this.attempt++; this.nextAt = this.now() + Math.min(120000, Math.round(base * (0.8 + this.random() * 0.4)));
    this.lostAt = null; this.onlineAt = null;
    return this.nextAt;
  }
  canStart() { return this.state!=='auth_required'&&(this.state!=='blocked'||this.reason==='no_proxy_found')&&this.now()>=this.nextAt; }
  stalled() { return this.lostAt !== null && this.now() - this.lostAt >= (this.established ? ESTABLISHED_CHANNEL_GRACE_MS : INITIAL_CHANNEL_GRACE_MS); }
}
