// DemoBridge: a fake Slack workspace with the same interface as SlackBridge.
// `npm run demo` uses it so you can try AIM (or take screenshots) without touching a real Slack.
const { EventEmitter } = require('events');

const now = Date.now() / 1000;
const ts = (minsAgo, i) => (now - minsAgo * 60 + i).toFixed(6);

const SELF = { id: 'U000ME', name: 'jordan.mitchell', display: 'Jordan Mitchell' };
const PEOPLE = [
  ['U001', 'priya.n', 'Priya Natarajan', 'active'],
  ['U002', 'marcus.b', 'Marcus Bell', 'active'],
  ['U003', 'sk8rgrl', 'Tess Alvarez', 'active'],
  ['U004', 'dave.k', 'Dave Kowalski', 'active'],
  ['U005', 'lin.h', 'Lin Huang', 'active'],
  ['U006', 'oscar.r', 'Oscar Reyes', 'away'],
  ['U007', 'becca.t', 'Becca Thornton', 'away'],
  ['U008', 'sam.o', 'Sam Okafor', 'away'],
  ['U009', 'gwen.p', 'Gwen Park', 'away'],
];
const BOTS = [['B001', 'smartybot', 'SmartyBot'], ['B002', 'standup', 'Standup Bot']];
const CHANNELS = [
  ['C001', 'general', false], ['C002', 'design', false], ['C003', 'launch-war-room', true],
  ['C004', 'random', false], ['C005', 'lunch-crew', false], ['C006', 'eng', false],
];

const HISTORY = {
  DU001: [
    ['U001', 14, 'omg did u see the Q3 deck'],
    ['U000ME', 13, 'yeah lol slide 12 is just a stock photo of a handshake'],
    ['U001', 13, 'classic'],
    ['U001', 12, 'ok real question. lunch? :burrito:'],
    ['U000ME', 11, 'brb grabbing my coat'],
    ['U001', 11, ':-D meet u by the elevators'],
  ],
  DU003: [
    ['U003', 30, 'r u going to the launch party friday??'],
    ['U000ME', 29, 'only if there is a dance floor'],
    ['U003', 28, 'there is a KARAOKE MACHINE'],
    ['U000ME', 27, 'oh no. i am bringing my A game. mr brightside'],
    ['U003', 2, 'just saw ur away msg. "listening to the garden state soundtrack" lmaooo'],
  ],
  DU002: [
    ['U002', 60, 'can u look at my PR when u get a sec'],
    ['U000ME', 58, 'on it :+1:'],
  ],
  G001: [
    ['U004', 20, 'who took the last la croix'],
    ['U005', 19, 'not me'],
    ['U000ME', 19, 'definitely not me'],
    ['U004', 18, 'the fridge cam does not lie jordan'],
  ],
  C003: [
    ['U002', 9, 'staging is green :white_check_mark:'],
    ['U005', 7, '<@U000ME> can you do the final click on the release?'],
  ],
};

class DemoBridge extends EventEmitter {
  constructor() { super(); this.connected = false; this.team = 'T000DEMO'; this.self = null; }

  async connect() {
    this.self = { id: SELF.id, name: SELF.name, team: 'Cobalt Coffee Co.' };
    this.connected = true;
    this.emit('connected', this.self);
    // a new IM arrives a few seconds after sign-on, to show off the pop-up
    setTimeout(() => {
      (HISTORY.DU004 = HISTORY.DU004 || []).push(['U004', 0, 'hey u there? :-)']);
      this.emit('event', { type: 'message', channel: 'DU004', user: 'U004', text: 'hey u there? :-)', ts: (Date.now() / 1000).toFixed(6) });
    }, 9000);
  }

  user(id, handle, real, bot = false) {
    return { id, name: handle, real_name: real, deleted: false, is_bot: bot, profile: { display_name: real } };
  }

  async api(method, p = {}) {
    switch (method) {
      case 'auth.test': return { ok: true, user_id: SELF.id, user: SELF.name, team: 'Cobalt Coffee Co.' };
      case 'users.list': return { ok: true, members: [this.user(SELF.id, SELF.name, SELF.display), ...PEOPLE.map(([id, h, r]) => this.user(id, h, r)), ...BOTS.map(([id, h, r]) => this.user(id, h, r, true))] };
      case 'users.info': return { ok: false, error: 'user_not_found' };
      case 'client.counts': return {
        ok: true,
        ims: [...PEOPLE, ...BOTS].map(([id]) => ({ id: 'D' + id, has_unreads: id === 'U003', mention_count: 0 })),
        mpims: [{ id: 'G001', has_unreads: false, mention_count: 0 }, { id: 'G002', has_unreads: false, mention_count: 0 }],
        channels: CHANNELS.map(([id]) => ({ id, has_unreads: id === 'C003' || id === 'C004', mention_count: id === 'C003' ? 1 : 0 })),
      };
      case 'users.conversations': return {
        ok: true,
        channels: [
          ...[...PEOPLE, ...BOTS].map(([id]) => ({ id: 'D' + id, is_im: true, user: id })),
          { id: 'G001', is_mpim: true, name: 'mpdm-dave.k--lin.h--jordan.mitchell-1' },
          { id: 'G002', is_mpim: true, name: 'mpdm-priya.n--marcus.b--sk8rgrl--jordan.mitchell-1' },
          ...CHANNELS.map(([id, name, priv]) => ({ id, name, is_private: priv })),
        ],
      };
      case 'users.getPresence': return { ok: true, presence: (PEOPLE.find(x => x[0] === p.user) || [])[3] || 'away' };
      case 'conversations.history': return {
        ok: true,
        messages: (HISTORY[p.channel] || []).map(([user, mins, text], i) => ({ type: 'message', user, text, ts: ts(mins, i) })).reverse(),
      };
      case 'chat.postMessage': {
        const ev = { type: 'message', channel: p.channel, user: SELF.id, text: p.text, ts: (Date.now() / 1000).toFixed(6) };
        (HISTORY[p.channel] = HISTORY[p.channel] || []).push([SELF.id, 0, p.text]);
        setTimeout(() => this.emit('event', ev), 150);
        return { ok: true, ts: ev.ts };
      }
      case 'conversations.open': return { ok: true, channel: { id: 'D' + p.users, is_im: true, user: p.users } };
      default: return { ok: true };
    }
  }
}

module.exports = { DemoBridge };
