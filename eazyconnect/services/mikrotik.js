/**
 * Client RouterOS API (port 8728) — implémentation pure Node.js TCP.
 * Protocole: mots encodés par longueur, séparés par octet nul (fin de phrase).
 */
const net = require('net');

function encLen(n) {
  if (n < 0x80)     return Buffer.from([n]);
  if (n < 0x4000)   return Buffer.from([0x80 | (n >> 8), n & 0xFF]);
  if (n < 0x200000) return Buffer.from([0xC0 | (n >> 16), (n >> 8) & 0xFF, n & 0xFF]);
  return Buffer.from([0xE0 | (n >> 24), (n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF]);
}

function encWord(w) { const b = Buffer.from(w, 'utf8'); return Buffer.concat([encLen(b.length), b]); }

function encSentence(words) {
  return Buffer.concat([...words.map(encWord), Buffer.from([0])]);
}

function readLen(buf, o) {
  const b = buf[o];
  if ((b & 0xE0) === 0xE0) return { n: ((b & 0x1F) << 24) | (buf[o+1] << 16) | (buf[o+2] << 8) | buf[o+3], s: 4 };
  if ((b & 0xC0) === 0xC0) return { n: ((b & 0x3F) << 16) | (buf[o+1] << 8) | buf[o+2], s: 3 };
  if ((b & 0x80) === 0x80) return { n: ((b & 0x7F) << 8) | buf[o+1], s: 2 };
  return { n: b, s: 1 };
}

class MikroTikClient {
  constructor({ host, port = 8728, username = 'admin', password = '' }) {
    Object.assign(this, { host, port: +port, username, password });
    this.sock = null;
    this._buf = Buffer.alloc(0);
    this._seq = 0;
    this._handlers = new Map();
  }

  connect(ms = 5000) {
    return new Promise((resolve, reject) => {
      const sock = new net.Socket();
      const t = setTimeout(() => { sock.destroy(); reject(new Error('Timeout MikroTik')); }, ms);
      sock.connect(this.port, this.host, async () => {
        clearTimeout(t);
        this.sock = sock;
        sock.on('data', d => this._onData(d));
        sock.on('error', () => {});
        try {
          await this._cmd(['/login', `=name=${this.username}`, `=password=${this.password}`]);
          resolve();
        } catch (e) { reject(e); }
      });
      sock.on('error', e => { clearTimeout(t); reject(e); });
    });
  }

  _cmd(words) {
    return new Promise((resolve, reject) => {
      const tag = ++this._seq;
      const buf = encSentence([...words, `=.tag=${tag}`]);
      const acc = [];
      this._handlers.set(tag, (sent, done) => {
        const type = sent[0];
        if (type === '!trap' || type === '!fatal') {
          if (done) this._handlers.delete(tag);
          return reject(new Error(sent.find(w => w.startsWith('=message='))?.slice(9) || type));
        }
        acc.push(sent);
        if (done) { this._handlers.delete(tag); resolve(acc); }
      });
      this.sock.write(buf);
    });
  }

  _onData(data) {
    this._buf = Buffer.concat([this._buf, data]);
    let o = 0, words = [];
    while (o < this._buf.length) {
      const { n, s } = readLen(this._buf, o);
      o += s;
      if (n === 0) { this._dispatch(words); words = []; }
      else {
        if (o + n > this._buf.length) { o -= s; break; }
        words.push(this._buf.slice(o, o + n).toString('utf8'));
        o += n;
      }
    }
    this._buf = this._buf.slice(o);
  }

  _dispatch(words) {
    const tw = words.find(w => w.startsWith('=.tag='));
    const tag = tw ? +tw.slice(6) : null;
    const done = words[0] === '!done' || words[0] === '!fatal';
    if (tag && this._handlers.has(tag)) this._handlers.get(tag)(words, done);
  }

  _rows(res) {
    return res.filter(s => s[0] === '!re').map(s => {
      const o = {};
      s.slice(1).forEach(w => { if (w[0] === '=') { const i = w.indexOf('=',1); o[w.slice(1,i)] = w.slice(i+1); } });
      return o;
    });
  }

  async addHotspotUser(name, profile, mac) {
    const words = ['/ip/hotspot/user/add', `=name=${name}`, `=password=${name}`, `=profile=${profile}`];
    if (mac) words.push(`=mac-address=${mac}`);
    await this._cmd(words);
  }

  async removeHotspotUser(name) {
    try {
      const rows = this._rows(await this._cmd(['/ip/hotspot/user/print', `?name=${name}`]));
      for (const u of rows) await this._cmd(['/ip/hotspot/user/remove', `=.id=${u['.id']}`]);
    } catch (_) {}
  }

  async getActiveSessions() {
    return this._rows(await this._cmd(['/ip/hotspot/active/print']));
  }

  async disconnectByMac(mac) {
    const sessions = await this.getActiveSessions();
    const s = sessions.find(x => x['mac-address']?.toLowerCase() === mac.toLowerCase());
    if (s) await this._cmd(['/ip/hotspot/active/remove', `=.id=${s['.id']}`]);
  }

  async setupProfiles() {
    const profiles = [
      { name: 'ek-1h',  timeout: '01:00:00',    rate: '2M/1M'    },
      { name: 'ek-3h',  timeout: '03:00:00',    rate: '3M/1500k' },
      { name: 'ek-12h', timeout: '12:00:00',    rate: '5M/2M'    },
      { name: 'ek-24h', timeout: '1d00:00:00',  rate: '5M/2M'    },
      { name: 'ek-7d',  timeout: '7d00:00:00',  rate: '10M/5M'   },
    ];
    for (const p of profiles) {
      try {
        await this._cmd([
          '/ip/hotspot/user/profile/add',
          `=name=${p.name}`,
          `=session-timeout=${p.timeout}`,
          `=rate-limit=${p.rate}`,
          '=shared-users=1',
        ]);
      } catch (_) { /* already exists — ok */ }
    }
  }

  close() { if (this.sock) { this.sock.destroy(); this.sock = null; } }
}

let _client = null;

function getSettings() {
  try {
    const db = require('../db');
    return Object.fromEntries(db.prepare('SELECT key,value FROM settings').all().map(r => [r.key, r.value]));
  } catch (_) { return {}; }
}

async function getMikroTik(settings = null) {
  if (_client && _client.sock) return _client;
  const s = settings || getSettings();
  _client = new MikroTikClient({
    host:     s.mikrotik_host     || process.env.MIKROTIK_HOST     || '192.168.88.1',
    port:     s.mikrotik_port     || process.env.MIKROTIK_PORT     || 8728,
    username: s.mikrotik_user     || process.env.MIKROTIK_USER     || 'admin',
    password: s.mikrotik_password || process.env.MIKROTIK_PASSWORD || '',
  });
  await _client.connect(4000);
  return _client;
}

function resetConnection() { if (_client) { _client.close(); _client = null; } }

module.exports = { getMikroTik, resetConnection, MikroTikClient };
