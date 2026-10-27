// Same-origin API only. This module never receives a GitHub credential or authentication token.
const stable = value => Array.isArray(value) ? '[' + value.map(stable).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}' : JSON.stringify(value);

export class SharedVersions {
  constructor({ getPlan, applyPlan, confirmLoad, fetchImpl = (url, options) => globalThis.fetch(url, options), storage = sessionStorage, randomId = () => crypto.randomUUID(), changed = () => {} }) {
    Object.assign(this, { getPlan, applyPlan, confirmLoad, fetchImpl, storage, randomId, changed });
    this.currentKey = 'kalline_neon_current_' + globalThis.KALLINE_STORAGE_SCOPE; this.storageKey = 'kalline_neon_pending_' + globalThis.KALLINE_STORAGE_SCOPE; this.baseline = null; this.parentId = null; this.versions = [];
    try { const current=JSON.parse(storage.getItem(this.currentKey)||'null'); if(current&&typeof current.baseline==='string'&&/^(v_[a-f0-9]{32}|base_[a-f0-9]{16})$/.test(current.parentId)){this.baseline=current.baseline;this.parentId=current.parentId;} } catch {}
    try { this.pending = JSON.parse(storage.getItem(this.storageKey) || 'null'); } catch { this.pending = null; }
  }
  rememberCurrent() { try { this.storage.setItem(this.currentKey,JSON.stringify({baseline:this.baseline,parentId:this.parentId})); } catch {} }
  isDirty() { return this.baseline === null || stable(this.getPlan()) !== this.baseline; }
  async request(path, options = {}) {
    let response;
    try { response = await this.fetchImpl('/api/catalog' + path, { credentials: 'same-origin', cache: 'no-store', ...options }); }
    catch { throw new Error('Sem conexão. A gravação não foi confirmada; tente novamente.'); }
    let value; try { value = await response.json(); } catch { throw new Error('O servidor não confirmou a operação.'); }
    if (!response.ok) {
      const error = new Error(value.error?.message || 'O servidor não confirmou a operação.'); error.code = value.error?.code; throw error;
    }
    return value;
  }
  async connect() { this.session = await this.request('/me'); this.engaged = true; return this.session.user; }
  async refresh() {
    const result = await this.request('/versions');
    if (!Array.isArray(result.versions)) throw new Error('Lista de versões inválida.');
    this.versions = result.versions; this.changed(this); return this.versions;
  }
  async save(name) {
    if (this.saving) throw new Error('Aguarde a confirmação da gravação atual.');
    this.saving = true;
    try {
      await this.connect();
      if (this.pending && this.pending.userId !== this.session.user.id) throw new Error('Existe uma tentativa de outra conta nesta aba. Volte à conta anterior para confirmá-la.');
      if (!this.pending) {
        this.pending = { key: this.randomId(), userId: this.session.user.id,
          body: { name, plan: structuredClone(this.getPlan()), parentId: this.parentId } };
        try { this.storage.setItem(this.storageKey, JSON.stringify(this.pending)); }
        catch { this.pending = null; throw new Error('Não foi possível preservar a tentativa nesta aba. Salve um JSON local antes de continuar.'); }
      }
      // A failed request is retried with exactly its old key and payload, even if the editor changed meanwhile.
      const attempt = this.pending;
      let result;
      try {
        result = await this.request('/versions', { method: 'POST', headers: { 'Content-Type': 'application/json',
          'X-CSRF-Token': this.session.csrf, 'Idempotency-Key': attempt.key }, body: JSON.stringify(attempt.body) });
      } catch (error) {
        // These codes explicitly guarantee rejection before any write. Keep uncertain attempts intact.
        if (['INVALID_PLAN', 'INVALID_NAME', 'INVALID_PARENT', 'INVALID_JSON', 'TOO_LARGE', 'JSON_REQUIRED'].includes(error.code)) {
          this.pending = null; try { this.storage.removeItem(this.storageKey); } catch {}
        }
        throw error;
      }
      if (!/^v_[a-f0-9]{32}$/u.test(result.version?.id ?? '')) throw new Error('O servidor não confirmou uma versão válida.');
      this.baseline = stable(attempt.body.plan); this.parentId = result.version.id; this.rememberCurrent();
      this.pending = null; try { this.storage.removeItem(this.storageKey); } catch {} this.changed(this);
      return result.version;
    } finally { this.saving = false; }
  }
  async load(id) {
    if (this.saving || this.pending) throw new Error('Confirme a tentativa de gravação pendente antes de carregar outra versão.');
    const snapshot = await this.request('/versions/' + encodeURIComponent(id));
    if (!Array.isArray(snapshot.plan)) throw new Error('Versão inválida. O plano atual foi preservado.');
    this.engaged = true;
    // Check AFTER the fetch so edits made during the request also receive the warning.
    if (this.isDirty() && !await this.confirmLoad('Há alterações locais ainda não salvas como versão compartilhada. Carregar esta versão?')) return false;
    await this.applyPlan(structuredClone(snapshot.plan));
    this.baseline = stable(this.getPlan()); this.parentId = snapshot.id; this.rememberCurrent(); this.changed(this); return true;
  }
  startPolling(interval = 15000) {
    this.stopPolling();
    this.timer = setInterval(() => this.refresh().catch(() => {}), interval);
  }
  stopPolling() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  beforeUnload(event) {
    // Merely mounting/polling the feature must not add cloud warnings to the legacy local editor.
    if ((this.engaged || this.pending) && (this.isDirty() || this.pending)) { event.preventDefault(); event.returnValue = ''; }
  }
}
