// One shape, two sources.
//
// Everything the screens render comes back from loadBoard() and loadMoney() in
// exactly the same shape whichever source answered. That is the point: the
// rendering can be exercised today against demo rows, and pointing it at a real
// project is a change to config.js, not to any screen.

(function () {
  'use strict';

  const cfg = window.HOUSEHOLD_CONFIG || {};
  const live = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);

  // ── Helpers ────────────────────────────────────────────────────────────

  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function money(amount, currency) {
    const symbol = currency === 'THB' || !currency ? '฿' : currency + ' ';
    return symbol + Math.round(amount).toLocaleString('en-US');
  }

  // The calendar date an instant falls on in a given timezone, as YYYY-MM-DD
  // (the en-CA format happens to be exactly that).
  function dateIn(instant, timezone) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date(instant));
  }

  // The household's date, not the browser's and not the server's. Whether an
  // occurrence has slipped depends entirely on which day it belongs to.
  function todayIn(timezone) {
    return dateIn(new Date(), timezone);
  }

  function addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function dayName(iso) { return DAYS[new Date(iso + 'T00:00:00Z').getUTCDay()]; }

  function todayIso() { return new Date().toISOString().slice(0, 10); }

  function isoIn(days) { return addDays(todayIso(), days); }

  // How far ahead generation reaches — the same default as the database.
  const HORIZON_DAYS = 60;

  // The demo's stand-in for app.recurrence_dates() in migration 0003: same rules,
  // including the month-end clamp, so demo mode generates the dates the database
  // would. Only the demo calls this. The live source never generates dates in the
  // browser — it inserts a series and lets the database do it.
  function recurrenceDates(freq, byWeekday, byMonthday, startsOn, fromIso, toIso) {
    const out = [];
    let d = fromIso > startsOn ? fromIso : startsOn;
    while (d <= toIso) {
      const date = new Date(d + 'T00:00:00Z');
      const lastOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
      const hit =
        freq === 'daily' ? true :
        freq === 'weekly' ? byWeekday.indexOf(date.getUTCDay()) !== -1 :
        freq === 'monthly' ? date.getUTCDate() === Math.min(byMonthday, lastOfMonth) :
        d === startsOn;
      if (hit) out.push(d);
      d = addDays(d, 1);
    }
    return out;
  }

  // What a series needs to know about its anchor date: which weekday it falls
  // on, and which day of the month.
  function anchor(iso) {
    const date = new Date(iso + 'T00:00:00Z');
    return { dow: date.getUTCDay(), dom: date.getUTCDate() };
  }

  // '14:45' from a time input -> 885 minutes, and back to a readable '2:45p'.
  function toMinutes(hhmm) {
    const parts = String(hhmm).split(':');
    return (Number(parts[0]) * 60) + Number(parts[1] || 0);
  }

  function fromMinutes(mins) {
    let h = Math.floor(mins / 60);
    const m = mins % 60;
    const suffix = h >= 12 ? 'p' : 'a';
    h = h % 12 || 12;
    return h + ':' + String(m).padStart(2, '0') + suffix;
  }

  // 885 -> '14:45', the form a time input wants back when an edit form is filled.
  function toHHMM(mins) {
    if (mins === null || mins === undefined) return '';
    return String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
  }

  function relativeDay(iso, today) {
    if (iso === today) return 'today';
    if (iso === addDays(today, -1)) return 'yesterday';
    if (iso === addDays(today, 1)) return 'tomorrow';

    // A weekday name only picks out one day when it is within the week either
    // side. Past that, a weekly series reads "Friday, Friday, Friday" and the
    // 18th is indistinguishable from the 25th — so say the date.
    const diff = Math.round((Date.parse(iso) - Date.parse(today)) / 86400000);
    if (Math.abs(diff) < 7) return dayName(iso);
    return dayName(iso).slice(0, 3) + ' ' + Number(iso.slice(8, 10)) + ' ' +
      MONTHS[Number(iso.slice(5, 7)) - 1];
  }

  // Slipped occurrences, one group per task and assignee, newest miss first.
  // Listed one by one, a week nobody ticked anything reads as the same seven
  // chores over and over; grouped, it reads as which chores keep slipping and
  // for whom. The occurrences themselves are untouched — this is only a view.
  // An occurrence reassigned to someone else is grouped with them, not the task.
  function groupSlipped(rows) {
    const groups = new Map();
    rows.forEach(o => {
      const key = o.task_id + '|' + (o.effective_assignee_id || '');
      const g = groups.get(key);
      if (!g) { groups.set(key, { first: o, latest: o, rows: [o] }); return; }
      g.rows.push(o);
      if (o.due_on < g.first.due_on) g.first = o;
      if (o.due_on > g.latest.due_on) g.latest = o;
    });
    return Array.from(groups.values()).sort((a, b) =>
      a.latest.due_on === b.latest.due_on
        ? a.latest.title.localeCompare(b.latest.title)
        : (a.latest.due_on < b.latest.due_on ? 1 : -1));
  }

  // The streak card's words and pips. With a streak reward on the task it counts
  // towards that, as the design drew it: "Homework 5 days straight. 2 more →
  // Movie night." Streak rewards repeat (0012), so the pips fill once per lap —
  // 7, then 14 — and stay full while a lap's reward waits to be claimed.
  function streakProgress(length, reward, status) {
    if (!reward) return { target: 7, filled: Math.min(length, 7), note: 'Kept ' + length + ' days straight.' };
    const days = reward.days;
    const ready = Boolean(status) && status.earned - status.claimed > 0;
    const into = ready ? days : length % days;
    const lead = (reward.taskTitle ? reward.taskTitle + ' ' : '') + length + ' days straight. ';
    return {
      target: days,
      filled: into,
      ready: ready,
      note: ready ? lead + reward.label + ' is earned.' : lead + (days - into) + ' more → ' + reward.label + '.'
    };
  }

  // "slipped Wednesday" for one miss; "slipped 9 times since Thu 17 Sep" for a
  // run of them — the first date says how long it has been going on.
  function slippedLabel(g, today) {
    if (g.rows.length === 1) return 'slipped ' + relativeDay(g.latest.due_on, today);
    return 'slipped ' + g.rows.length + ' times since ' + relativeDay(g.first.due_on, today);
  }

  // The wall-clock hour and minute of an instant, read in a given timezone.
  // Without the zone this was the browser's clock — so a phone abroad showed a
  // 5:30pm swim class at whatever 5:30pm Bangkok is where the phone happened to be.
  function clockIn(iso, tz) {
    const d = new Date(iso);
    if (!tz) return { h: d.getHours(), m: d.getMinutes() };
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(d);
    const part = type => Number(parts.find(p => p.type === type).value);
    // Some engines render midnight as 24.
    return { h: part('hour') % 24, m: part('minute') };
  }

  function timeLabel(iso, tz) {
    if (!iso) return '';
    const t = clockIn(iso, tz);
    const suffix = t.h >= 12 ? 'p' : 'a';
    return (t.h % 12 || 12) + ':' + String(t.m).padStart(2, '0') + suffix;
  }

  // What a time input wants back: '17:30'.
  function hhmmIn(iso, tz) {
    const t = clockIn(iso, tz);
    return String(t.h).padStart(2, '0') + ':' + String(t.m).padStart(2, '0');
  }

  // ── Demo source ────────────────────────────────────────────────────────

  // Deliberately the same rows the board was hardcoded with, so demo mode looks
  // like the design and any rendering bug shows up as a visible difference.
  const demo = {
    household: { timezone: 'Asia/Bangkok', currency: 'THB' },

    // Who you are looking at the demo as. `?as=alex` gives a child's board:
    // the receiving end of a nudge, and a member who may not pay bills. The
    // default is the adult the design was drawn for.
    members: {
      jamie: { key: 'jamie', name: 'Jamie', initial: 'J', accent: 'sage', role: 'adult' },
      sam: { key: 'sam', name: 'Sam', initial: 'S', accent: 'clay', role: 'adult' },
      alex: { key: 'alex', name: 'Alex', initial: 'A', accent: 'gold', role: 'child' }
    },
    meKey: (new URLSearchParams(location.search).get('as') || 'jamie').toLowerCase(),
    // Today's occurrences, and the single source of every count derived from
    // them. The design had a header reading "4 of 10 done" above per-person
    // bars reading 1/2, 1/3 and 1/3 — which is 3 of 8. A mockup can hold both
    // numbers at once; a screen that lists every occurrence cannot.
    //
    // `at` is minutes past midnight, used for ordering. The label is for
    // reading; sorting on it would put 10:00a after 2:45p.
    occurrences: [
      { id: 'o-dropoff', title: 'School drop-off', assignee: 'sam', time: '2:45p', at: 885, points: 0, completed: false },
      { id: 'o-dishes', title: 'Dishes after dinner', assignee: 'jamie', time: '7:00p', at: 1140, points: 0, completed: false },
      { id: 'o-dog', title: 'Feed the dog', assignee: 'alex', time: null, at: null, points: 5, completed: false },
      { id: 'o-toys', title: 'Tidy toys', assignee: 'alex', time: null, at: null, points: 10, completed: false },
      { id: 'o-laundry', title: 'Laundry', assignee: 'sam', time: null, at: null, points: 0, completed: false },
      { id: 'o-homework', title: 'Homework', assignee: 'alex', time: null, at: null, points: 10, completed: true },
      { id: 'o-plants', title: 'Water the plants', assignee: 'sam', time: null, at: null, points: 0, completed: true },
      { id: 'o-grocery', title: 'Grocery run', assignee: 'jamie', time: null, at: null, points: 0, completed: true }
    ],
    // Slipped occurrences only. Bills falling due are read from billsDue rather
    // than listed twice — the two copies used to have to be kept in step by hand.
    needsYou: [
      { id: 'demo-trash', kind: 'occurrence', title: 'Trash to the curb', assignee: 'alex', slipped: 'slipped yesterday', urgent: true }
    ],
    // { occurrenceId, from, to, seen }. Seeded with one Sam already sent Alex,
    // so the receiving end is visible at ?as=alex without having to arrange it.
    // It changes nothing for Jamie, who is not the one being nudged.
    nudges: [{ occurrenceId: 'demo-trash', from: 'sam', to: 'alex', seen: false }],
    streak: { member: 'alex', name: 'Alex', days: 5, target: 7, note: 'Homework 5 days straight. 2 more → movie night.' },
    pantryItems: [
      { id: 'p-milk', name: 'Milk', low: true },
      { id: 'p-soap', name: 'Dish soap', low: true },
      { id: 'p-rice', name: 'Rice', low: true },
      { id: 'p-eggs', name: 'Eggs', low: false },
      { id: 'p-coffee', name: 'Coffee', low: false },
      { id: 'p-bread', name: 'Bread', low: false },
      { id: 'p-oil', name: 'Cooking oil', low: false },
      { id: 'p-pasta', name: 'Pasta', low: false },
      { id: 'p-powder', name: 'Washing powder', low: false }
    ],
    // No open list to begin with, so pressing "Add to list" is what opens one.
    list: null,
    week: { spent: 3120, ceiling: 6000, daysLeft: 3 },
    // ADR 0001: events are not tasks. No completed flag, because an event is
    // never ticked off — it arrives and it passes.
    events: [
      { id: 'ev-swim', title: 'Swim class', subject: 'alex', responsible: 'sam', date: isoIn(1), at: 1050 }
    ],
    // Dated, not labelled. The labels used to be written in ("Due Friday"), which
    // was true on the day they were written and wrong the next morning.
    billsDue: [
      { id: 'demo-water', label: 'Water bill', amount: 740, dueOn: isoIn(0) },
      { id: 'demo-net', label: 'Internet', amount: 1200, dueOn: isoIn(1) }
    ],
    expenses: [
      { id: 'e1', label: 'Market', amount: 700, who: 'Sam', initial: 'S', accent: 'clay', when: 'today' },
      { id: 'e2', label: 'Groceries', amount: 880, who: 'Sam', initial: 'S', accent: 'clay', when: 'Tuesday' },
      { id: 'e3', label: 'Pharmacy', amount: 220, who: 'Jamie', initial: 'J', accent: 'sage', when: 'Tuesday' },
      { id: 'e4', label: 'Petrol', amount: 900, who: 'Sam', initial: 'S', accent: 'clay', when: 'Monday' },
      { id: 'e5', label: 'School supplies', amount: 420, who: 'Jamie', initial: 'J', accent: 'sage', when: 'Sunday' }
    ]
  };

  demo.me = demo.members[demo.meKey] || demo.members.jamie;

  // Rewards. Alex's homework streak is the one on the streak card, so Movie
  // night is 2 days away, as the design says. `earned` is Alex's lifetime points.
  demo.rewards = [
    { id: 'r-movie', label: 'Movie night', kind: 'streak', days: 7, taskTitle: 'Homework', holder: 'alex' },
    { id: 'r-icecream', label: 'Ice cream', kind: 'points', cost: 40 },
    { id: 'r-zoo', label: 'Trip to the zoo', kind: 'points', cost: 150 }
  ];
  demo.earned = { alex: 125 };
  demo.redemptions = [
    { id: 'd-1', reward: 'r-icecream', member: 'alex', points: 40, status: 'approved', asked: false, by: 'jamie', when: 'Saturday' }
  ];

  function demoBalance(key) {
    const spent = demo.redemptions.filter(d => d.member === key && d.status === 'approved').reduce((a, d) => a + d.points, 0);
    const held = demo.redemptions.filter(d => d.member === key && d.status === 'requested').reduce((a, d) => a + d.points, 0);
    return { available: (demo.earned[key] || 0) - spent - held, held: held };
  }

  // The same checks 0012 makes: a child, enough points, a streak lap unclaimed.
  function demoRewardCost(r, key) {
    if (!demo.members[key] || demo.members[key].role !== 'child') throw new Error('rewards are for children');
    if (r.kind === 'points') {
      const have = demoBalance(key).available;
      if (have < r.cost) throw new Error('not enough points yet: ' + have + ' of ' + r.cost);
      return r.cost;
    }
    if (!demoStreakReady(r, key)) throw new Error('the streak has not reached it yet');
    return 0;
  }

  function demoStreakReady(r, key) {
    const len = key === demo.streak.member ? demo.streak.days : 0;
    const claimed = demo.redemptions.filter(d => d.reward === r.id && d.member === key && d.status !== 'declined').length;
    return Math.floor(len / r.days) - claimed > 0;
  }

  // Today's occurrences that still count. A skipped one is off the board and out
  // of every total — it was a decision, not a job left undone.
  function demoToday() {
    return demo.occurrences.filter(o => !o.skipped);
  }

  // Timed things first, in time order; the rest are "sometime today" and sort
  // by name so the list does not shuffle between renders.
  function demoOrdered() {
    return demoToday().slice().sort((a, b) => {
      if (a.at !== null && b.at !== null) return a.at - b.at;
      if (a.at !== null) return -1;
      if (b.at !== null) return 1;
      return a.title.localeCompare(b.title);
    });
  }

  function demoLow() {
    return demo.pantryItems.filter(p => p.low);
  }

  // Soonest first, and only what has not happened yet.
  function demoEvents() {
    const today = todayIso();
    return demo.events
      .filter(e => e.date >= today && !e.skipped)
      .sort((a, b) => (a.date === b.date ? a.at - b.at : a.date.localeCompare(b.date)))
      .map(e => {
        const subject = demo.members[e.subject];
        const responsible = demo.members[e.responsible];
        return {
          id: e.id,
          date: e.date,
          dow: dayName(e.date).slice(0, 3),
          day: Number(e.date.slice(8, 10)),
          when: relativeDay(e.date, today),
          title: [subject ? subject.name : null, e.title].filter(Boolean).join(' · '),
          meta: [fromMinutes(e.at), responsible ? responsible.name + ' takes them' : null]
            .filter(Boolean).join(' · '),
          seriesId: e.series || null,
          edit: {
            title: e.title,
            subject: e.subject || '',
            responsible: e.responsible || '',
            date: e.date,
            time: toHHMM(e.at),
            repeats: Boolean(e.series)
          }
        };
      });
  }

  function demoByPerson() {
    return Object.keys(demo.members).map(key => {
      const member = demo.members[key];
      const mine = demoOrdered().filter(o => o.assignee === key);
      return {
        key: key,
        name: member.name,
        initial: member.initial,
        accent: member.accent,
        role: member.role,
        done: mine.filter(o => o.completed).length,
        total: mine.length,
        streak: key === demo.streak.member ? { days: demo.streak.days, target: demo.streak.target } : null,
        occurrences: mine
      };
    }).filter(p => p.total > 0);
  }

  // Turns the stored rows into what this member should see: whether they may
  // act, and whether anyone is waiting on them.
  function demoNeedsYou() {
    const me = demo.me;
    const today = todayIso();

    const bills = demo.billsDue
      .filter(b => b.dueOn <= today)
      .map(b => ({
        id: b.id,
        kind: 'bill',
        title: b.label + ' · ' + money(b.amount, 'THB'),
        meta: b.dueOn === today ? 'Due today' : 'Due ' + relativeDay(b.dueOn, today),
        urgent: true,
        action: me.role === 'adult' ? 'Pay' : null
      }));

    return demo.needsYou.map(item => {
      const assignee = demo.members[item.assignee];
      const mine = assignee.key === me.key;
      const nudges = demo.nudges.filter(n => n.occurrenceId === item.id);
      const fromMe = nudges.find(n => n.from === me.key);
      const toMe = nudges.filter(n => n.to === me.key);

      let meta = assignee.name + ' · ' + item.slipped;
      if (mine && toMe.length) {
        const names = toMe.map(n => demo.members[n.from].name);
        meta = names.join(' and ') + ' nudged you · ' + item.slipped;
      }

      return {
        id: item.id,
        kind: 'occurrence',
        title: item.title,
        meta: meta,
        urgent: item.urgent,
        // Nobody nudges themselves, and nudging twice is not a thing.
        action: (mine || fromMe) ? null : 'Nudge',
        status: fromMe ? (fromMe.seen ? 'Seen' : 'Nudged') : null
      };
    }).concat(bills).concat(me.role !== 'adult' ? [] : demo.redemptions.filter(d => d.status === 'requested').map(d => ({
      id: d.id,
      kind: 'request',
      title: demo.members[d.member].name + ' asked for ' + demo.rewards.find(r => r.id === d.reward).label,
      meta: (d.points ? d.points + ' points · ' : 'Streak reward · ') + d.when,
      action: 'Approve',
      urgent: false
    })));
  }

  const demoSource = {
    live: false,

    async signedIn() { return true; },

    async loadBoard() {
      const now = new Date();
      const ordered = demoOrdered();
      const done = demoToday().filter(o => o.completed).length;
      const open = ordered.filter(o => !o.completed);
      return {
        date: DAYS[now.getDay()] + ', ' + MONTHS[now.getMonth()] + ' ' + now.getDate(),
        greeting: 'Morning, ' + demo.me.name,
        me: demo.me,
        needsYou: demoNeedsYou(),
        today: {
          done: done,
          total: demoToday().length,
          people: demoByPerson().map(p => ({
            initial: p.initial, accent: p.accent, done: p.done, total: p.total
          })),
          // The board shows what is next, not everything; the rest is a tap away.
          occurrences: open.slice(0, 2).map(o => ({
            id: o.id,
            title: o.title,
            meta: [demo.members[o.assignee].name, o.time].filter(Boolean).join(' · '),
            completed: o.completed
          })),
          remaining: demoToday().length
        },
        streak: demo.streak,
        pantry: {
          count: demoLow().length,
          items: demoLow().map(p => p.name).join(', ')
        },
        week: {
          spent: money(demo.week.spent, 'THB'),
          percent: Math.round((demo.week.spent / demo.week.ceiling) * 100)
        },
        nextEvent: demoEvents()[0] || null
      };
    },

    async createEvent(input) {
      const stamp = Date.now();
      const repeats = input.repeats && input.repeats !== 'none';
      const a = anchor(input.onDate);
      const dates = repeats
        ? recurrenceDates(input.repeats, [a.dow], a.dom, input.onDate, todayIso(), isoIn(HORIZON_DAYS))
        : [input.onDate];

      dates.forEach((d, i) => demo.events.push({
        id: 'ev-' + stamp + '-' + i,
        title: input.title,
        subject: input.subject || null,
        responsible: input.responsible || null,
        date: d,
        at: toMinutes(input.atTime),
        series: repeats ? 'es-' + stamp : null
      }));
      return true;
    },

    async editEvent(id, input) {
      if (demo.me.role !== 'adult') throw new Error('only an adult can change an event');
      const e = demo.events.find(x => x.id === id);
      if (!e) throw new Error('no such event');

      const apply = x => {
        x.title = input.title;
        x.subject = input.subject || null;
        x.responsible = input.responsible || null;
        x.at = toMinutes(input.atTime);
      };

      if (input.scope === 'forward' && e.series) {
        // This one and every later one not edited by hand. Dates stay with the
        // series; the time and people move.
        demo.events
          .filter(x => x.series === e.series && x.date >= e.date && (!x.edited || x.id === id))
          .forEach(apply);
      } else {
        apply(e);
        e.date = input.onDate || e.date;
        if (e.series) e.edited = true;
      }
      return true;
    },

    async removeEvent(id) {
      if (demo.me.role !== 'adult') throw new Error('only an adult can remove an event');
      const e = demo.events.find(x => x.id === id);
      if (!e) throw new Error('no such event');
      // As in the database: a one-off goes, an instance of a series is skipped.
      if (e.series) e.skipped = true;
      else demo.events = demo.events.filter(x => x.id !== id);
      return true;
    },

    async stopEventSeries(id) {
      if (demo.me.role !== 'adult') throw new Error('only an adult can stop an event');
      const e = demo.events.find(x => x.id === id);
      if (!e || !e.series) throw new Error('that event does not repeat');
      const today = todayIso();
      demo.events = demo.events.filter(x =>
        !(x.series === e.series && x.date > today && !x.edited && !x.skipped));
      return true;
    },

    async loadTasks() {
      const now = new Date();
      return {
        date: DAYS[now.getDay()] + ', ' + MONTHS[now.getMonth()] + ' ' + now.getDate(),
        events: demoEvents().slice(0, 5),
        slipped: demo.needsYou.filter(n => n.kind === 'occurrence').map(n => ({
          id: n.id,
          title: n.title,
          meta: demo.members[n.assignee].name + ' · ' + n.slipped
        })),
        people: demoByPerson().map(p => ({
          key: p.key, name: p.name, initial: p.initial, accent: p.accent, role: p.role,
          done: p.done, total: p.total, streak: p.streak,
          points: p.role === 'child' ? demoBalance(p.key).available : null,
          occurrences: p.occurrences.map(o => ({
            id: o.id,
            title: o.title,
            time: o.time,
            // Only a child earns points, so only a child is shown them.
            points: p.role === 'child' ? o.points : 0,
            completed: o.completed,
            // What an edit form needs to fill itself in.
            edit: {
              title: o.title,
              assignee: o.assignee,
              time: toHHMM(o.at),
              recurs: o.recurs !== false
            }
          }))
        }))
      };
    },

    // The demo only ever shows today, so "from now on" and "just today" land in
    // the same place here. The difference is real in the live source, where the
    // database regenerates the days ahead.
    async editOccurrence(id, input) {
      const o = demo.occurrences.find(x => x.id === id);
      if (!o) throw new Error('no such task');
      if (demo.me.role !== 'adult') throw new Error('only an adult can change a task');
      if (!demo.members[input.assignee]) throw new Error('that person is not in this household');

      if (input.title) o.title = input.title;
      o.assignee = input.assignee;
      o.at = input.time ? toMinutes(input.time) : null;
      o.time = o.at === null ? null : fromMinutes(o.at);
      return true;
    },

    async skipOccurrence(id) {
      const o = demo.occurrences.find(x => x.id === id);
      if (!o) throw new Error('no such task');
      if (demo.me.role !== 'adult') throw new Error('only an adult can skip a task');
      if (o.completed) throw new Error('that one is already done');
      o.skipped = true;
      return true;
    },

    // Retiring skips today's if it is not done, as the database does. Past
    // occurrences would stay; the demo simply has none to show.
    async retireTask(id) {
      const o = demo.occurrences.find(x => x.id === id);
      if (!o) throw new Error('no such task');
      if (demo.me.role !== 'adult') throw new Error('only an adult can stop a task');
      if (!o.completed) o.skipped = true;
      o.retired = true;
      return true;
    },

    // Whoever the demo is being viewed as signs in; nobody else does yet.
    async loadMembers() {
      return {
        me: demo.me,
        members: Object.keys(demo.members).map(k => Object.assign({}, demo.members[k], {
          signsIn: k === demo.me.key,
          invite: demo.members[k].invite || null
        }))
      };
    },

    async inviteMember(key, email) {
      const addr = String(email || '').trim().toLowerCase();
      if (addr && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) throw new Error('that does not look like an email address');
      if (addr && Object.keys(demo.members).some(k => k !== key && demo.members[k].invite === addr)) {
        throw new Error('that address is already invited');
      }
      demo.members[key].invite = addr || null;
      return true;
    },

    async addMember(input) {
      const name = String(input.name || '').trim();
      if (!name) throw new Error('give them a name');
      const used = c => Object.keys(demo.members).filter(k => demo.members[k].accent === c).length;
      const accent = ['sage', 'clay', 'gold'].sort((a, b) => used(a) - used(b))[0];
      const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();
      demo.members[key] = { key: key, name: name, initial: name.charAt(0).toUpperCase(), accent: accent, role: input.role };
      if (input.email) await this.inviteMember(key, input.email);
      return key;
    },

    async loadRewards() {
      const kids = Object.keys(demo.members).map(k => demo.members[k]).filter(m => m.role === 'child');
      const person = m => ({ key: m.key, name: m.name, initial: m.initial, accent: m.accent });
      return {
        me: { key: demo.me.key, role: demo.me.role },
        children: kids.map(m => Object.assign(person(m), demoBalance(m.key))),
        rewards: demo.rewards.filter(r => !r.retired).map(r => {
          if (r.kind === 'points') {
            return Object.assign({}, r, {
              progress: kids.map(m => Object.assign(person(m), {
                have: demoBalance(m.key).available, need: r.cost, ready: demoBalance(m.key).available >= r.cost
              }))
            });
          }
          return Object.assign({}, r, {
            progress: kids.filter(m => m.key === r.holder).map(m => {
              const len = m.key === demo.streak.member ? demo.streak.days : 0;
              const ready = demoStreakReady(r, m.key);
              return Object.assign(person(m), { have: ready ? r.days : len % r.days, need: r.days, ready: ready, length: len });
            })
          });
        }),
        requests: demo.redemptions.filter(d => d.status === 'requested').map(d => Object.assign(person(demo.members[d.member]), {
          id: d.id, label: demo.rewards.find(r => r.id === d.reward).label, points: d.points, when: d.when,
          mine: d.member === demo.me.key
        })),
        history: demo.redemptions.filter(d => d.status === 'approved').slice().reverse().map(d => Object.assign(person(demo.members[d.member]), {
          id: d.id, label: demo.rewards.find(r => r.id === d.reward).label, points: d.points,
          meta: (d.asked ? 'Asked, approved by ' : 'Given by ') + demo.members[d.by].name + ' · ' + d.when
        }))
      };
    },

    async loadTaskChoices() {
      return [{ value: 'Homework', label: 'Homework' }, { value: 'Feed the dog', label: 'Feed the dog' }, { value: 'Tidy toys', label: 'Tidy toys' }];
    },

    async createReward(input) {
      if (demo.me.role !== 'adult') throw new Error('only an adult can add a reward');
      demo.rewards.push(input.kind === 'points'
        ? { id: 'r-' + Date.now(), label: input.label, kind: 'points', cost: input.cost }
        : { id: 'r-' + Date.now(), label: input.label, kind: 'streak', days: input.days, taskTitle: input.taskId, holder: 'alex' });
      return true;
    },

    async updateReward(id, input) {
      const r = demo.rewards.find(x => x.id === id);
      r.label = input.label;
      if (r.kind === 'points') r.cost = input.cost; else r.days = input.days;
      return true;
    },

    async retireReward(id) {
      demo.rewards.find(x => x.id === id).retired = true;
      return true;
    },

    async requestReward(id) {
      const r = demo.rewards.find(x => x.id === id);
      const points = demoRewardCost(r, demo.me.key);
      demo.redemptions.push({ id: 'd-' + Date.now(), reward: id, member: demo.me.key, points: points, status: 'requested', asked: true, when: 'today' });
      return true;
    },

    async giveReward(id, key) {
      if (demo.me.role !== 'adult') throw new Error('only an adult can give a reward');
      const r = demo.rewards.find(x => x.id === id);
      const points = demoRewardCost(r, key);
      demo.redemptions.push({ id: 'd-' + Date.now(), reward: id, member: key, points: points, status: 'approved', asked: false, by: demo.me.key, when: 'today' });
      return true;
    },

    async decideRedemption(id, approve) {
      if (demo.me.role !== 'adult') throw new Error('only an adult can decide that');
      const d = demo.redemptions.find(x => x.id === id);
      d.status = approve ? 'approved' : 'declined';
      d.by = demo.me.key;
      d.when = 'today';
      return true;
    },

    async createTask(input) {
      const at = input.time ? toMinutes(input.time) : null;
      demo.occurrences.push({
        id: 'o-' + Date.now(),
        title: input.title,
        assignee: input.assignee,
        time: at === null ? null : fromMinutes(at),
        at: at,
        points: input.points || 0,
        completed: false,
        recurs: input.recurrence !== 'once'
      });
      return true;
    },

    async createExpense(input) {
      const who = demo.members[input.spentBy] || demo.me;
      demo.expenses.unshift({
        id: 'e-' + Date.now(), label: input.label, amount: input.amount,
        who: who.name, initial: who.initial, accent: who.accent, when: 'today'
      });
      demo.week.spent += input.amount;
      return true;
    },

    async createPantryItem(input) {
      if (demo.pantryItems.some(p => p.name.toLowerCase() === input.name.toLowerCase())) {
        throw new Error('that is already in the pantry');
      }
      demo.pantryItems.push({ id: 'p-' + Date.now(), name: input.name, low: Boolean(input.low) });
      return true;
    },

    async createBill(input) {
      const stamp = Date.now();
      const repeats = input.repeats && input.repeats !== 'none';
      const a = anchor(input.dueOn);
      const dates = repeats
        ? recurrenceDates(input.repeats, [a.dow], a.dom, input.dueOn, todayIso(), isoIn(HORIZON_DAYS))
        : [input.dueOn];

      // Instances of one series share `series`, so "from now on" and "stop
      // repeating" can find their siblings — what series_id does in the database.
      dates.forEach((d, i) => demo.billsDue.push({
        id: 'b-' + stamp + '-' + i, label: input.label, amount: input.amount, dueOn: d,
        series: repeats ? 'bs-' + stamp : null
      }));
      return true;
    },

    async loadKitchen() {
      return {
        low: demoLow().map(p => ({ id: p.id, name: p.name })),
        stocked: demo.pantryItems.filter(p => !p.low).map(p => ({ id: p.id, name: p.name })),
        list: demo.list ? {
          id: demo.list.id,
          items: demo.list.items.slice(),
          got: demo.list.items.filter(i => i.got).length
        } : null
      };
    },

    async setPantryLow(id, low) {
      const item = demo.pantryItems.find(p => p.id === id);
      if (!item) throw new Error('no such item');
      item.low = low;
      return true;
    },

    async addLowToList() {
      const low = demoLow();
      if (!low.length) throw new Error('nothing is running low');
      if (!demo.list) demo.list = { id: 'list-1', items: [] };
      low.forEach(p => {
        if (!demo.list.items.some(i => i.pantryItemId === p.id)) {
          demo.list.items.push({ id: 'i-' + p.id, pantryItemId: p.id, label: p.name, got: false });
        }
      });
      return demo.list.id;
    },

    async setListItemGot(id, got) {
      const item = demo.list && demo.list.items.find(i => i.id === id);
      if (!item) throw new Error('not on the list');
      item.got = got;
      return true;
    },

    async completeShoppingList() {
      if (!demo.list) throw new Error('no open list');
      let restocked = 0;
      demo.list.items.filter(i => i.got).forEach(i => {
        const p = demo.pantryItems.find(x => x.id === i.pantryItemId);
        if (p) { p.low = false; restocked++; }
      });
      demo.list = null;
      return restocked;
    },

    // Any member, as the pantry_touch policy allows — the pantry is shared.
    async editPantryItem(id, input) {
      const p = demo.pantryItems.find(x => x.id === id);
      if (!p) throw new Error('no such item');
      const clash = demo.pantryItems.some(x =>
        x.id !== id && x.name.toLowerCase() === input.name.toLowerCase());
      if (clash) throw new Error('that is already in the pantry');
      p.name = input.name;
      p.low = Boolean(input.low);
      return true;
    },

    // A deleted item that was on the shopping list stays there as plain text,
    // as the foreign key's "on delete set null" leaves it in the database.
    async deletePantryItem(id) {
      if (!demo.pantryItems.some(x => x.id === id)) throw new Error('no such item');
      demo.pantryItems = demo.pantryItems.filter(x => x.id !== id);
      if (demo.list) {
        demo.list.items.forEach(i => { if (i.pantryItemId === id) i.pantryItemId = null; });
      }
      return true;
    },

    async loadMoney() {
      const w = demo.week;
      const today = todayIso();
      const weekStart = addDays(today, -6);

      // "Due soon" means the coming week, as it does for the live source. A
      // monthly series generates two months ahead; only the next one belongs here.
      const soon = demo.billsDue
        .filter(b => b.dueOn <= addDays(today, 7))
        .sort((a, b) => a.dueOn.localeCompare(b.dueOn));

      return {
        periodLabel: MONTHS[Number(weekStart.slice(5, 7)) - 1] + ' ' + Number(weekStart.slice(8, 10)) +
          ' – ' + Number(today.slice(8, 10)),
        budget: {
          spent: money(w.spent, 'THB'),
          ceiling: 'of ' + money(w.ceiling, 'THB'),
          percent: Math.round((w.spent / w.ceiling) * 100),
          left: money(w.ceiling - w.spent, 'THB') + ' left · ' + w.daysLeft + ' days to go'
        },
        billsDue: soon.map(b => ({
          id: b.id,
          urgent: b.dueOn <= today,
          dueLabel: b.dueOn === today ? 'Due today' : 'Due ' + relativeDay(b.dueOn, today),
          title: b.label + ' · ' + money(b.amount, 'THB'),
          edit: { label: b.label, amount: b.amount, dueOn: b.dueOn, repeats: Boolean(b.series) }
        })),
        billsTotal: money(soon.reduce((a, b) => a + b.amount, 0), 'THB'),
        expenses: demo.expenses.map(e => ({
          id: e.id, label: e.label, initial: e.initial, accent: e.accent,
          meta: e.who + ' · ' + e.when, amount: money(e.amount, 'THB'),
          edit: { label: e.label, amount: e.amount, paidBill: e.paidBill ? e.paidBill.label : null }
        }))
      };
    },

    async setOccurrenceDone(id, done) {
      const row = demo.occurrences.find(o => o.id === id);
      if (row) row.completed = done;
      return true;
    },

    async payBill(id) {
      const bill = demo.billsDue.find(b => b.id === id);
      if (!bill) throw new Error('no such bill');
      if (demo.me.role !== 'adult') throw new Error('only an adult can pay a bill');

      demo.billsDue = demo.billsDue.filter(b => b.id !== id);
      demo.expenses.unshift({
        id: 'e-' + id, label: bill.label, amount: bill.amount,
        who: demo.me.name, initial: demo.me.initial, accent: demo.me.accent, when: 'today',
        // Kept so deleting the expense can un-pay the bill, as the trigger in
        // 0008 does.
        paidBill: bill
      });
      demo.week.spent += bill.amount;
      return true;
    },

    async editBill(id, input) {
      if (demo.me.role !== 'adult') throw new Error('only an adult can change a bill');
      const bill = demo.billsDue.find(b => b.id === id);
      if (!bill) throw new Error('no such bill');

      if (input.scope === 'forward' && bill.series) {
        // Every unpaid one in the series from this one on. Dates stay where the
        // series put them; only the name and amount move.
        demo.billsDue
          .filter(b => b.series === bill.series && b.dueOn >= bill.dueOn && !b.edited)
          .forEach(b => { b.label = input.label; b.amount = input.amount; });
      } else {
        bill.label = input.label;
        bill.amount = input.amount;
        bill.dueOn = input.dueOn || bill.dueOn;
        if (bill.series) bill.edited = true;
      }
      return true;
    },

    async removeBill(id) {
      if (demo.me.role !== 'adult') throw new Error('only an adult can remove a bill');
      if (!demo.billsDue.some(b => b.id === id)) throw new Error('no such bill');
      demo.billsDue = demo.billsDue.filter(b => b.id !== id);
      return true;
    },

    // Mirrors the database: future unpaid instances go, today's stays, and any
    // someone edited are left alone.
    async stopBillSeries(billId) {
      if (demo.me.role !== 'adult') throw new Error('only an adult can stop a bill');
      const bill = demo.billsDue.find(b => b.id === billId);
      if (!bill || !bill.series) throw new Error('that bill does not repeat');
      const today = todayIso();
      demo.billsDue = demo.billsDue.filter(b =>
        !(b.series === bill.series && b.dueOn > today && !b.edited));
      return true;
    },

    async editExpense(id, input) {
      if (demo.me.role !== 'adult') throw new Error('only an adult can change an expense');
      const e = demo.expenses.find(x => x.id === id);
      if (!e) throw new Error('no such expense');
      demo.week.spent += input.amount - e.amount;
      e.label = input.label;
      e.amount = input.amount;
      return true;
    },

    async deleteExpense(id) {
      if (demo.me.role !== 'adult') throw new Error('only an adult can remove an expense');
      const e = demo.expenses.find(x => x.id === id);
      if (!e) throw new Error('no such expense');
      demo.expenses = demo.expenses.filter(x => x.id !== id);
      demo.week.spent -= e.amount;
      if (e.paidBill) demo.billsDue.push(e.paidBill);
      return true;
    },

    async sendNudge(id) {
      const item = demo.needsYou.find(n => n.id === id);
      if (!item || item.kind !== 'occurrence') throw new Error('no such occurrence');
      if (item.assignee === demo.me.key) throw new Error('that one is yours');
      if (demo.nudges.some(n => n.occurrenceId === id && n.from === demo.me.key)) {
        throw new Error('already nudged about that today');
      }
      demo.nudges.push({ occurrenceId: id, from: demo.me.key, to: item.assignee, seen: false });
      return true;
    },

    async markNudgesSeen() {
      let touched = 0;
      demo.nudges.forEach(n => {
        if (n.to === demo.me.key && !n.seen) { n.seen = true; touched++; }
      });
      return touched;
    }
  };

  // ── Supabase source ────────────────────────────────────────────────────

  function supabaseSource() {
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    let ctx = null; // { member, household, members }

    async function context() {
      if (ctx) return ctx;
      const { data: auth } = await sb.auth.getUser();
      if (!auth || !auth.user) throw new Error('not signed in');

      // maybeSingle, not single: no row is the expected state on first sign-in,
      // before seed.sql has put this account in a household, and it deserves a
      // sentence rather than PostgREST's "JSON object requested, multiple (or no)
      // rows returned".
      const findMe = () => sb
        .from('member')
        .select('id, display_name, role, accent, household_id, household:household_id (id, name, timezone, currency)')
        .eq('user_id', auth.user.id)
        .maybeSingle();

      let { data: me, error } = await findMe();
      if (error) throw new Error(error.message);

      // No household yet: if an adult invited this address, signing in is what
      // links it to that member (0011). Otherwise there is nothing to show.
      if (!me) {
        const { data: joined, error: claimError } = await sb.rpc('claim_invite');
        if (claimError) throw new Error(claimError.message);
        if (joined) ({ data: me, error } = await findMe());
        if (error) throw new Error(error.message);
      }
      if (!me) {
        throw new Error('you are signed in as ' + auth.user.email +
          ', which is not in a household yet. Ask an adult to invite that address from the Household sheet — their initial, top right of Home — then reload.');
      }

      const { data: members } = await sb
        .from('member')
        .select('id, display_name, role, accent, user_id, invite_email')
        .eq('household_id', me.household_id);

      ctx = { me: me, household: me.household, members: members || [] };
      return ctx;
    }

    const initial = m => (m && m.display_name ? m.display_name.charAt(0).toUpperCase() : '?');
    const byId = (list, id) => list.find(m => m.id === id) || null;

    return {
      live: true,

      async signedIn() {
        const { data } = await sb.auth.getSession();
        return Boolean(data && data.session);
      },

      async signIn(email) {
        // Back to this page, not to the project's default Site URL. Supabase
        // only honours it if the address is in the project's redirect list —
        // see supabase/SETUP.md.
        const { error } = await sb.auth.signInWithOtp({
          email: email,
          options: { emailRedirectTo: location.origin + location.pathname }
        });
        if (error) throw new Error(error.message);
      },

      // The same email carries a code. Typing it signs in whichever browser
      // the app is open in — including a home-screen app, which the link
      // cannot reach.
      async verifyCode(email, code) {
        const { error } = await sb.auth.verifyOtp({ email: email, token: code, type: 'email' });
        if (error) throw new Error(error.message);
      },

      async signOut() { ctx = null; await sb.auth.signOut(); },

      async loadBoard() {
        const c = await context();
        const tz = c.household.timezone;
        const cur = c.household.currency;
        const today = todayIn(tz);

        const [openToday, slipped, bills, streaks, low, spend, budget, ev, nudges] = await Promise.all([
          sb.from('occurrence_current').select('*').eq('household_id', c.household.id).eq('due_on', today).eq('skipped', false),
          sb.from('occurrence_current').select('*').eq('household_id', c.household.id).eq('slipped', true).lt('due_on', today).order('due_on'),
          sb.from('bill').select('*').eq('household_id', c.household.id).is('paid_at', null).is('skipped_at', null).lte('due_on', today).order('due_on'),
          sb.from('streak_current').select('*').eq('household_id', c.household.id).order('length', { ascending: false }).limit(1),
          sb.from('pantry_item').select('name').eq('household_id', c.household.id).eq('is_low', true),
          sb.from('expense').select('amount').eq('household_id', c.household.id).gte('spent_on', addDays(today, -6)),
          sb.from('budget').select('amount').eq('household_id', c.household.id).eq('period', 'weekly').lte('effective_from', today).order('effective_from', { ascending: false }).limit(1),
          sb.from('event').select('*').eq('household_id', c.household.id).is('skipped_at', null).gte('starts_at', new Date().toISOString()).order('starts_at').limit(1),
          sb.from('nudge').select('occurrence_id, from_member_id, to_member_id, seen_at').eq('household_id', c.household.id).gte('nudged_on', addDays(today, -30))
        ]);

        // Rewards (0012): what children have asked for, for an adult to decide,
        // and the streak rewards the streak card counts towards.
        const [asked, streakRewards, streakStatus] = await Promise.all([
          sb.from('redemption').select('id, member_id, points_spent, redeemed_at, reward:reward_id (label)').eq('household_id', c.household.id).eq('status', 'requested').order('redeemed_at'),
          sb.from('reward').select('id, label, streak_task_id, streak_days, task:streak_task_id (title)').eq('household_id', c.household.id).eq('active', true).not('streak_task_id', 'is', null),
          sb.from('streak_reward_status').select('*').eq('household_id', c.household.id)
        ]);

        const rows = openToday.data || [];
        const done = rows.filter(r => r.completed_at).length;

        const people = c.members.map(m => {
          const mine = rows.filter(r => r.effective_assignee_id === m.id);
          return {
            initial: initial(m),
            accent: m.accent,
            done: mine.filter(r => r.completed_at).length,
            total: mine.length
          };
        }).filter(p => p.total > 0);

        const allNudges = nudges.data || [];

        const needsYou = groupSlipped(slipped.data || []).map(g => {
          const o = g.latest;
          const ids = g.rows.map(r => r.id);
          const mine = o.effective_assignee_id === c.me.id;
          // Whoever nudged about any miss in the run is still waiting on you.
          const toMe = allNudges.filter(n => ids.includes(n.occurrence_id) && n.to_member_id === c.me.id);
          // But a nudge is about one miss, and the row stands for the latest:
          // once a newer one slips, you may nudge about that one.
          const fromMe = allNudges.find(n => n.occurrence_id === o.id && n.from_member_id === c.me.id);
          const label = slippedLabel(g, today);

          // If people are waiting on you, say who — that is the whole point of
          // a nudge, and it belongs where you already look.
          let meta;
          if (mine && toMe.length) {
            const names = Array.from(new Set(toMe.map(n => initialName(c, n.from_member_id)).filter(Boolean)));
            meta = names.join(' and ') + ' nudged you · ' + label;
          } else {
            meta = (initialName(c, o.effective_assignee_id) || 'Unassigned') + ' · ' + label;
          }

          return {
            id: o.id,
            kind: 'occurrence',
            title: o.title,
            meta: meta,
            urgent: true,
            // Nothing to nudge if it is already yours, nobody holds it, or you
            // have nudged about it already.
            action: (!mine && o.effective_assignee_id && !fromMe) ? 'Nudge' : null,
            status: fromMe ? (fromMe.seen_at ? 'Seen' : 'Nudged') : null
          };
        }).concat((bills.data || []).map(b => ({
          id: b.id,
          kind: 'bill',
          title: b.label + ' · ' + money(b.amount, cur),
          meta: b.due_on === today ? 'Due today' : 'Due ' + relativeDay(b.due_on, today),
          action: c.me.role === 'adult' ? 'Pay' : null,
          urgent: true
        }))).concat(c.me.role !== 'adult' ? [] : (asked.data || []).map(d => ({
          id: d.id,
          kind: 'request',
          title: (initialName(c, d.member_id) || 'Someone') + ' asked for ' + (d.reward ? d.reward.label : 'a reward'),
          meta: (d.points_spent ? d.points_spent + ' points · ' : 'Streak reward · ') +
            relativeDay(dateIn(d.redeemed_at, c.household.timezone), today),
          action: 'Approve',
          urgent: false
        })));

        const spent = (spend.data || []).reduce((a, r) => a + Number(r.amount), 0);
        const ceiling = budget.data && budget.data[0] ? Number(budget.data[0].amount) : 0;

        const streak = streaks.data && streaks.data[0] ? streaks.data[0] : null;
        const streakMember = streak ? byId(c.members, streak.member_id) : null;
        const event = ev.data && ev.data[0] ? ev.data[0] : null;

        // Only the two soonest incomplete rows go on the board; the rest are
        // behind "See all".
        const shown = rows.filter(r => !r.completed_at).slice(0, 2);

        return {
          date: dayName(today) + ', ' + MONTHS[Number(today.slice(5, 7)) - 1] + ' ' + Number(today.slice(8, 10)),
          greeting: 'Morning, ' + c.me.display_name,
          me: { name: c.me.display_name, initial: initial(c.me), accent: c.me.accent },
          needsYou: needsYou,
          today: {
            done: done,
            total: rows.length,
            people: people,
            occurrences: shown.map(o => ({
              id: o.id,
              title: o.title,
              meta: [initialName(c, o.effective_assignee_id), o.due_time ? timeLabel(o.due_at, c.household.timezone) : null].filter(Boolean).join(' · '),
              completed: Boolean(o.completed_at),
              points: o.points_on_offer,
              assignee: o.effective_assignee_id
            })),
            remaining: rows.length
          },
          streak: streak ? (() => {
            const r = (streakRewards.data || []).find(x => x.streak_task_id === streak.task_id);
            const status = r && (streakStatus.data || []).find(s => s.reward_id === r.id && s.member_id === streak.member_id);
            const p = streakProgress(streak.length,
              r ? { days: r.streak_days, label: r.label, taskTitle: r.task ? r.task.title : '' } : null, status);
            return Object.assign({ name: streakMember ? streakMember.display_name : '', days: streak.length }, p);
          })() : null,
          pantry: {
            count: (low.data || []).length,
            items: (low.data || []).map(p => p.name).join(', ')
          },
          week: {
            spent: money(spent, cur),
            percent: ceiling ? Math.round((spent / ceiling) * 100) : 0
          },
          // Worded exactly as Coming up words it on the Tasks screen: who it is
          // about in the title, who takes them in the meta. The same event read
          // two ways on two screens is a bug, however small.
          nextEvent: event ? {
            dow: dayName(event.occurs_on || event.starts_at.slice(0, 10)).slice(0, 3),
            day: Number((event.occurs_on || event.starts_at.slice(0, 10)).slice(8, 10)),
            title: [initialName(c, event.subject_id), event.title].filter(Boolean).join(' · '),
            meta: [timeLabel(event.starts_at, c.household.timezone),
              event.responsible_id ? initialName(c, event.responsible_id) + ' takes them' : null]
              .filter(Boolean).join(' · ')
          } : null
        };
      },

      async loadTasks() {
        const c = await context();
        const today = todayIn(c.household.timezone);

        const [todayRes, slippedRes, streakRes, eventRes, balanceRes] = await Promise.all([
          sb.from('occurrence_current').select('*').eq('household_id', c.household.id).eq('due_on', today).eq('skipped', false),
          sb.from('occurrence_current').select('*').eq('household_id', c.household.id).eq('slipped', true).lt('due_on', today).order('due_on'),
          sb.from('streak_current').select('*').eq('household_id', c.household.id),
          sb.from('event').select('*').eq('household_id', c.household.id).is('skipped_at', null).gte('starts_at', new Date().toISOString()).order('starts_at').limit(5),
          sb.from('points_balance').select('member_id, available').eq('household_id', c.household.id)
        ]);

        const rows = todayRes.data || [];
        const streaks = streakRes.data || [];
        const balances = balanceRes.data || [];

        // Timed first in time order, then the rest by name so the list is
        // stable between renders.
        const order = (a, b) => {
          if (a.due_time && b.due_time) return a.due_time.localeCompare(b.due_time);
          if (a.due_time) return -1;
          if (b.due_time) return 1;
          return (a.title || '').localeCompare(b.title || '');
        };

        const people = c.members.map(m => {
          const mine = rows.filter(r => r.effective_assignee_id === m.id).sort(order);
          const best = streaks
            .filter(s => s.member_id === m.id)
            .sort((a, b) => b.length - a.length)[0];

          return {
            key: m.id,
            name: m.display_name,
            initial: initial(m),
            accent: m.accent,
            role: m.role,
            done: mine.filter(r => r.completed_at).length,
            total: mine.length,
            streak: best ? { days: best.length, target: 7 } : null,
            // A child's points to spend, shown on their card and linked to Rewards.
            points: m.role === 'child'
              ? Number((balances.find(b => b.member_id === m.id) || {}).available || 0)
              : null,
            occurrences: mine.map(o => ({
              id: o.id,
              title: o.title,
              time: o.due_time ? timeLabel(o.due_at, c.household.timezone) : null,
              points: m.role === 'child' ? (o.points_on_offer || 0) : 0,
              completed: Boolean(o.completed_at),
              assignee: o.effective_assignee_id,
              taskId: o.task_id,
              edit: {
                title: o.title,
                assignee: o.effective_assignee_id,
                // due_time comes back as 'HH:MM:SS'; a time input wants 'HH:MM'.
                time: o.due_time ? o.due_time.slice(0, 5) : '',
                // occurrence_current does not carry the task's recurrence, so the
                // scope choice is always offered; for a one-off it is harmless.
                recurs: true
              }
            }))
          };
        }).filter(p => p.total > 0);

        return {
          date: dayName(today) + ', ' + MONTHS[Number(today.slice(5, 7)) - 1] + ' ' + Number(today.slice(8, 10)),
          slipped: groupSlipped(slippedRes.data || []).map(g => ({
            id: g.latest.id,
            title: g.latest.title,
            meta: (initialName(c, g.latest.effective_assignee_id) || 'Unassigned') +
              ' · ' + slippedLabel(g, today)
          })),
          people: people,
          events: (eventRes.data || []).map(e => {
            const on = e.occurs_on || e.starts_at.slice(0, 10);
            return {
              id: e.id,
              date: on,
              dow: dayName(on).slice(0, 3),
              day: Number(on.slice(8, 10)),
              when: relativeDay(on, today),
              title: [initialName(c, e.subject_id), e.title].filter(Boolean).join(' · '),
              meta: [timeLabel(e.starts_at, c.household.timezone),
                e.responsible_id ? initialName(c, e.responsible_id) + ' takes them' : null]
                .filter(Boolean).join(' · '),
              seriesId: e.series_id,
              edit: {
                title: e.title,
                subject: e.subject_id || '',
                responsible: e.responsible_id || '',
                // The household's date and clock, not the browser's.
                date: dateIn(e.starts_at, c.household.timezone),
                time: hhmmIn(e.starts_at, c.household.timezone),
                repeats: Boolean(e.series_id)
              }
            };
          })
        };
      },

      // `signsIn` and `invite` are for the Household sheet: whether a member
      // has a login yet, and if not, which address they were invited under.
      async loadMembers() {
        const c = await context();
        return {
          me: { key: c.me.id, name: c.me.display_name, initial: initial(c.me), accent: c.me.accent, role: c.me.role },
          members: c.members.map(m => ({
            key: m.id, name: m.display_name, initial: initial(m), accent: m.accent, role: m.role,
            signsIn: Boolean(m.user_id), invite: m.invite_email || null
          }))
        };
      },

      // Both change the member list, so the cached context is dropped and the
      // next read fetches it again.
      async inviteMember(key, email) {
        const { error } = await sb.rpc('invite_member', { target_member: key, email: email || '' });
        ctx = null;
        if (error) throw new Error(error.message);
        return true;
      },

      async addMember(input) {
        const { data: id, error } = await sb.rpc('add_member', {
          member_name: input.name, member_role: input.role, email: input.email || null
        });
        ctx = null;
        if (error) throw new Error(error.message);
        return id;
      },

      // ── Rewards (0012) ─────────────────────────────────────────────────

      async loadRewards() {
        const c = await context();
        const tz = c.household.timezone;
        const today = todayIn(tz);
        const hh = c.household.id;

        const [rewardRes, balanceRes, statusRes, askedRes, givenRes] = await Promise.all([
          sb.from('reward').select('id, label, cost_points, streak_task_id, streak_days, task:streak_task_id (title, default_assignee_id)').eq('household_id', hh).eq('active', true).order('created_at'),
          sb.from('points_balance').select('*').eq('household_id', hh),
          sb.from('streak_reward_status').select('*').eq('household_id', hh),
          sb.from('redemption').select('id, member_id, points_spent, redeemed_at, reward:reward_id (label)').eq('household_id', hh).eq('status', 'requested').order('redeemed_at'),
          sb.from('redemption').select('id, member_id, points_spent, redeemed_at, decided_at, requested_by, decided_by, reward:reward_id (label)').eq('household_id', hh).eq('status', 'approved').order('decided_at', { ascending: false }).limit(10)
        ]);
        const failed = [rewardRes, balanceRes, statusRes, askedRes, givenRes].find(r => r.error);
        if (failed) throw new Error(failed.error.message);

        const person = m => ({ key: m.id, name: m.display_name, initial: initial(m), accent: m.accent });
        const kids = c.members.filter(m => m.role === 'child');
        const balance = id => balanceRes.data.find(b => b.member_id === id) || { available: 0, held: 0 };
        const day = instant => relativeDay(dateIn(instant, tz), today);

        return {
          me: { key: c.me.id, role: c.me.role },
          children: kids.map(m => Object.assign(person(m), {
            available: Number(balance(m.id).available), held: Number(balance(m.id).held)
          })),
          rewards: rewardRes.data.map(r => {
            if (r.cost_points) {
              return {
                id: r.id, label: r.label, kind: 'points', cost: r.cost_points,
                progress: kids.map(m => Object.assign(person(m), {
                  have: Number(balance(m.id).available), need: r.cost_points,
                  ready: Number(balance(m.id).available) >= r.cost_points
                }))
              };
            }
            // A streak reward counts for whoever keeps the task's streak: its
            // usual child, and any child with a run on it.
            const rows = statusRes.data.filter(s => s.reward_id === r.id);
            const holder = r.task && r.task.default_assignee_id;
            const who = kids.filter(m => m.id === holder || rows.some(s => s.member_id === m.id));
            return {
              id: r.id, label: r.label, kind: 'streak', days: r.streak_days,
              taskId: r.streak_task_id, taskTitle: r.task ? r.task.title : '',
              progress: who.map(m => {
                const s = rows.find(x => x.member_id === m.id);
                const p = streakProgress(s ? s.length : 0, { days: r.streak_days, label: r.label }, s);
                return Object.assign(person(m), { have: p.filled, need: r.streak_days, ready: p.ready, length: s ? s.length : 0 });
              })
            };
          }),
          requests: askedRes.data.map(d => Object.assign(person(byId(c.members, d.member_id) || { id: d.member_id, display_name: '?', accent: 'sage' }), {
            id: d.id, label: d.reward ? d.reward.label : 'A reward', points: d.points_spent,
            when: day(d.redeemed_at), mine: d.member_id === c.me.id
          })),
          history: givenRes.data.map(d => Object.assign(person(byId(c.members, d.member_id) || { id: d.member_id, display_name: '?', accent: 'sage' }), {
            id: d.id, label: d.reward ? d.reward.label : 'A reward', points: d.points_spent,
            meta: (d.requested_by === d.member_id ? 'Asked, approved by ' : 'Given by ') +
              (initialName(c, d.decided_by) || 'an adult') + ' · ' + day(d.decided_at || d.redeemed_at)
          }))
        };
      },

      // Repeating tasks only: a streak needs something that comes back.
      async loadTaskChoices() {
        const c = await context();
        const { data, error } = await sb.from('task').select('id, title').eq('household_id', c.household.id)
          .eq('active', true).neq('recurrence_freq', 'once').order('title');
        if (error) throw new Error(error.message);
        return data.map(t => ({ value: t.id, label: t.title }));
      },

      async createReward(input) {
        const c = await context();
        const row = { household_id: c.household.id, label: input.label };
        if (input.kind === 'points') row.cost_points = input.cost;
        else { row.streak_task_id = input.taskId; row.streak_days = input.days; }
        const { error } = await sb.from('reward').insert(row);
        if (error) throw new Error(error.message);
        return true;
      },

      async updateReward(id, input) {
        const patch = { label: input.label };
        if (input.kind === 'points') patch.cost_points = input.cost;
        else patch.streak_days = input.days;
        const { error } = await sb.from('reward').update(patch).eq('id', id);
        if (error) throw new Error(error.message);
        return true;
      },

      // Retired, not deleted: what was already given stays in the history and
      // the points spent on it stay spent.
      async retireReward(id) {
        const { error } = await sb.from('reward').update({ active: false }).eq('id', id);
        if (error) throw new Error(error.message);
        return true;
      },

      async requestReward(id) {
        const { error } = await sb.rpc('request_reward', { target_reward: id });
        if (error) throw new Error(error.message);
        return true;
      },

      async giveReward(id, memberKey) {
        const { error } = await sb.rpc('give_reward', { target_reward: id, target_member: memberKey });
        if (error) throw new Error(error.message);
        return true;
      },

      async decideRedemption(id, approve) {
        const { error } = await sb.rpc('decide_redemption', { target_redemption: id, approve: approve });
        if (error) throw new Error(error.message);
        return true;
      },

      // Inserting the task is enough: the trigger from 0002 materialises its
      // occurrences, so it appears on today's board without a second call.
      async createTask(input) {
        const c = await context();
        const today = todayIn(c.household.timezone);

        const row = {
          household_id: c.household.id,
          title: input.title,
          default_assignee_id: input.assignee || null,
          recurrence_freq: input.recurrence,
          due_time: input.time || null,
          starts_on: today,
          points: input.points || 0
        };
        if (input.recurrence === 'weekly') row.by_weekday = [1, 2, 3, 4, 5];

        const { error } = await sb.from('task').insert(row);
        if (error) throw new Error(error.message);
        return true;
      },

      async createExpense(input) {
        const c = await context();
        const { error } = await sb.from('expense').insert({
          household_id: c.household.id,
          label: input.label,
          amount: input.amount,
          spent_on: todayIn(c.household.timezone),
          spent_by: input.spentBy || c.me.id
        });
        if (error) throw new Error(error.message);
        return true;
      },

      async createPantryItem(input) {
        const c = await context();
        const { error } = await sb.from('pantry_item').insert({
          household_id: c.household.id,
          name: input.name,
          is_low: Boolean(input.low),
          marked_low_at: input.low ? new Date().toISOString() : null
        });
        if (error) throw new Error(error.message);
        return true;
      },

      // The date and time go over as they were typed; the function reads them in
      // the household's timezone. See 0007.
      async createEvent(input) {
        // A repeating event is a series. The trigger from 0003 generates its
        // instances out to the horizon, in the household's timezone, so there is
        // nothing more to do here — and at_time stays a wall-clock time, which is
        // exactly what a series should hold.
        if (input.repeats && input.repeats !== 'none') {
          const c = await context();
          const a = anchor(input.onDate);
          const row = {
            household_id: c.household.id,
            title: input.title,
            subject_id: input.subject || null,
            responsible_id: input.responsible || null,
            at_time: input.atTime,
            recurrence_freq: input.repeats,
            starts_on: input.onDate
          };
          if (input.repeats === 'weekly') row.by_weekday = [a.dow];
          if (input.repeats === 'monthly') row.by_monthday = a.dom;

          const { error } = await sb.from('event_series').insert(row);
          if (error) throw new Error(error.message);
          return true;
        }

        const { error } = await sb.rpc('add_event', {
          p_title: input.title,
          p_on_date: input.onDate,
          p_at_time: input.atTime,
          p_subject: input.subject || null,
          p_responsible: input.responsible || null
        });
        if (error) throw new Error(error.message);
        return true;
      },

      async createBill(input) {
        const c = await context();

        // Same as events: a repeating bill is a series, and 0003 does the rest.
        // The amount is snapshotted onto each generated bill, so changing the
        // series later does not restate bills already issued.
        if (input.repeats && input.repeats !== 'none') {
          const a = anchor(input.dueOn);
          const row = {
            household_id: c.household.id,
            label: input.label,
            amount: input.amount,
            recurrence_freq: input.repeats,
            starts_on: input.dueOn
          };
          if (input.repeats === 'weekly') row.by_weekday = [a.dow];
          if (input.repeats === 'monthly') row.by_monthday = a.dom;

          const { error } = await sb.from('bill_series').insert(row);
          if (error) throw new Error(error.message);
          return true;
        }

        const { error } = await sb.from('bill').insert({
          household_id: c.household.id,
          label: input.label,
          amount: input.amount,
          due_on: input.dueOn
        });
        if (error) throw new Error(error.message);
        return true;
      },

      async loadKitchen() {
        const c = await context();

        const [pantryRes, listRes] = await Promise.all([
          sb.from('pantry_item').select('id, name, is_low').eq('household_id', c.household.id).order('name'),
          sb.from('shopping_list').select('id').eq('household_id', c.household.id).is('completed_at', null).order('created_at', { ascending: false }).limit(1)
        ]);

        const pantry = pantryRes.data || [];
        const open = listRes.data && listRes.data[0] ? listRes.data[0] : null;

        let list = null;
        if (open) {
          const { data: items } = await sb
            .from('shopping_list_item')
            .select('id, label, got, pantry_item_id')
            .eq('shopping_list_id', open.id)
            .order('label');
          const rows = items || [];
          list = {
            id: open.id,
            items: rows.map(i => ({ id: i.id, label: i.label, got: i.got, pantryItemId: i.pantry_item_id })),
            got: rows.filter(i => i.got).length
          };
        }

        return {
          low: pantry.filter(p => p.is_low).map(p => ({ id: p.id, name: p.name })),
          stocked: pantry.filter(p => !p.is_low).map(p => ({ id: p.id, name: p.name })),
          list: list
        };
      },

      async setPantryLow(id, low) {
        const { error } = await sb.from('pantry_item').update({
          is_low: low,
          marked_low_at: low ? new Date().toISOString() : null
        }).eq('id', id);
        if (error) throw new Error(error.message);
        return true;
      },

      async setListItemGot(id, got) {
        const { error } = await sb.from('shopping_list_item').update({ got: got }).eq('id', id);
        if (error) throw new Error(error.message);
        return true;
      },

      // Plain writes under pantry_touch, which any member holds.
      async editPantryItem(id, input) {
        const row = { name: input.name };
        // Only a change of state touches marked_low_at; a rename leaves the
        // record of when it ran low alone.
        if (Boolean(input.low) !== Boolean(input.wasLow)) {
          row.is_low = Boolean(input.low);
          row.marked_low_at = input.low ? new Date().toISOString() : null;
        }
        const { error } = await sb.from('pantry_item').update(row).eq('id', id);
        // The unique (household_id, name) constraint says it better than 23505.
        if (error) throw new Error(error.code === '23505' ? 'that is already in the pantry' : error.message);
        return true;
      },

      // A list entry pointing at it keeps its label: the foreign key nulls the
      // link rather than deleting the line from somebody's shopping list.
      async deletePantryItem(id) {
        const { error } = await sb.from('pantry_item').delete().eq('id', id);
        if (error) throw new Error(error.message);
        return true;
      },

      // Both of these move more than one row, so both are functions.
      async addLowToList() {
        const { data, error } = await sb.rpc('add_low_to_list');
        if (error) throw new Error(error.message);
        return data;
      },

      async completeShoppingList(listId) {
        const { data, error } = await sb.rpc('complete_shopping_list', { target_list: listId });
        if (error) throw new Error(error.message);
        return data || 0;
      },

      async loadMoney() {
        const c = await context();
        const tz = c.household.timezone;
        const cur = c.household.currency;
        const today = todayIn(tz);
        const weekStart = addDays(today, -6);

        const [budget, bills, expenses] = await Promise.all([
          sb.from('budget').select('amount').eq('household_id', c.household.id).eq('period', 'weekly').lte('effective_from', today).order('effective_from', { ascending: false }).limit(1),
          sb.from('bill').select('*').eq('household_id', c.household.id).is('paid_at', null).is('skipped_at', null).lte('due_on', addDays(today, 7)).order('due_on'),
          sb.from('expense').select('*, bill(label)').eq('household_id', c.household.id).gte('spent_on', weekStart).order('spent_on', { ascending: false })
        ]);

        const rows = expenses.data || [];
        const spent = rows.reduce((a, r) => a + Number(r.amount), 0);
        const ceiling = budget.data && budget.data[0] ? Number(budget.data[0].amount) : 0;
        const dueRows = bills.data || [];

        return {
          periodLabel: MONTHS[Number(weekStart.slice(5, 7)) - 1] + ' ' + Number(weekStart.slice(8, 10)) +
            ' – ' + Number(today.slice(8, 10)),
          budget: {
            spent: money(spent, cur),
            ceiling: ceiling ? 'of ' + money(ceiling, cur) : '',
            percent: ceiling ? Math.round((spent / ceiling) * 100) : 0,
            left: ceiling ? money(Math.max(ceiling - spent, 0), cur) + ' left' : ''
          },
          billsDue: dueRows.map(b => ({
            id: b.id,
            urgent: b.due_on <= today,
            title: b.label + ' · ' + money(b.amount, cur),
            dueLabel: b.due_on === today ? 'Due today' : 'Due ' + relativeDay(b.due_on, today),
            seriesId: b.series_id,
            edit: { label: b.label, amount: Number(b.amount), dueOn: b.due_on, repeats: Boolean(b.series_id) }
          })),
          billsTotal: money(dueRows.reduce((a, b) => a + Number(b.amount), 0), cur),
          expenses: rows.map(e => {
            const who = byId(c.members, e.spent_by);
            // bill.expense_id is unique, so PostgREST may hand back one row or
            // a list of one depending on how it reads the relationship.
            const paid = Array.isArray(e.bill) ? e.bill[0] : e.bill;
            return {
              id: e.id,
              label: e.label,
              initial: initial(who),
              accent: who ? who.accent : 'sage',
              meta: [who ? who.display_name : 'Someone', relativeDay(e.spent_on, today)].join(' · '),
              amount: money(e.amount, cur),
              edit: { label: e.label, amount: Number(e.amount), paidBill: paid ? paid.label : null }
            };
          })
        };
      },

      // Editing goes through functions because a member may write only
      // completed_at directly (ADR 0005). Each checks for itself that the
      // caller is an adult.
      async editOccurrence(id, input) {
        const { error } = await sb.rpc('edit_occurrence', {
          p_occurrence: id,
          p_title: input.title,
          p_assignee: input.assignee || null,
          p_due_time: input.time || null,
          p_scope: input.scope === 'forward' ? 'forward' : 'this'
        });
        if (error) throw new Error(error.message);
        return true;
      },

      async skipOccurrence(id) {
        const { error } = await sb.rpc('skip_occurrence', { p_occurrence: id });
        if (error) throw new Error(error.message);
        return true;
      },

      async retireTask(occurrenceId, taskId) {
        const { error } = await sb.rpc('retire_task', { p_task: taskId });
        if (error) throw new Error(error.message);
        return true;
      },

      // Only completed_at is sent — it is the only column a member may write
      // (0008). Who ticked it and what it earned are worked out by the
      // database, so a browser cannot award points it was never offered.
      async setOccurrenceDone(id, done) {
        const { error } = await sb.from('occurrence').update({
          completed_at: done ? new Date().toISOString() : null
        }).eq('id', id);

        if (error) throw new Error(error.message);
        return true;
      },

      // Both of these are database functions rather than client-side writes.
      // Paying is two writes that must not half-happen, and nudging has rules
      // about who and how often that the client should not be trusted with.
      async payBill(id) {
        const { error } = await sb.rpc('pay_bill', { target_bill: id });
        if (error) throw new Error(error.message);
        return true;
      },

      // Bills and expenses have no column privileges in the way, so these are
      // ordinary writes under bill_admin and expense_amend (ADR 0005).
      async editBill(id, input, meta) {
        const c = await context();
        if (input.scope === 'forward' && meta && meta.seriesId) {
          // The series first: its trigger regenerates the untouched bills ahead
          // with the new name and amount. Then this one, which may be today's
          // and so not regenerated. Its date belongs to the series; not moved.
          const { error: se } = await sb.from('bill_series')
            .update({ label: input.label, amount: input.amount })
            .eq('id', meta.seriesId);
          if (se) throw new Error(se.message);

          const { error } = await sb.from('bill')
            .update({ label: input.label, amount: input.amount })
            .eq('id', id);
          if (error) throw new Error(error.message);
          return true;
        }

        const row = { label: input.label, amount: input.amount, due_on: input.dueOn };
        // Marked, so the next change to its series leaves this one's amount be.
        if (meta && meta.seriesId) row.edited_at = new Date().toISOString();

        const { error } = await sb.from('bill').update(row).eq('id', id).eq('household_id', c.household.id);
        if (error) throw new Error(error.message);
        return true;
      },

      async editEvent(id, input, meta) {
        const params = {
          p_event: id,
          p_title: input.title,
          p_on_date: input.onDate,
          p_at_time: input.atTime,
          p_subject: input.subject || null,
          p_responsible: input.responsible || null
        };

        if (input.scope === 'forward' && meta && meta.seriesId) {
          // This one first, which marks it edited — so the series change below,
          // whose trigger regenerates the untouched events ahead, leaves it be.
          // The other order would have regenerated this very event out from
          // under the second call.
          const { error: ee } = await sb.rpc('edit_event', params);
          if (ee) throw new Error(ee.message);

          const { error } = await sb.from('event_series').update({
            title: input.title,
            subject_id: input.subject || null,
            responsible_id: input.responsible || null,
            at_time: input.atTime
          }).eq('id', meta.seriesId);
          if (error) throw new Error(error.message);
          return true;
        }

        const { error } = await sb.rpc('edit_event', params);
        if (error) throw new Error(error.message);
        return true;
      },

      async removeEvent(id) {
        const { error } = await sb.rpc('remove_event', { p_event: id });
        if (error) throw new Error(error.message);
        return true;
      },

      async stopEventSeries(id, meta) {
        if (!meta || !meta.seriesId) throw new Error('that event does not repeat');
        const { error } = await sb.from('event_series').update({ active: false }).eq('id', meta.seriesId);
        if (error) throw new Error(error.message);
        return true;
      },

      async removeBill(id) {
        const { error } = await sb.rpc('remove_bill', { p_bill: id });
        if (error) throw new Error(error.message);
        return true;
      },

      async stopBillSeries(billId, meta) {
        if (!meta || !meta.seriesId) throw new Error('that bill does not repeat');
        const { error } = await sb.from('bill_series').update({ active: false }).eq('id', meta.seriesId);
        if (error) throw new Error(error.message);
        return true;
      },

      async editExpense(id, input) {
        const { error } = await sb.from('expense')
          .update({ label: input.label, amount: input.amount })
          .eq('id', id);
        if (error) throw new Error(error.message);
        return true;
      },

      // Deleting an expense that paid a bill un-pays the bill (trigger, 0008).
      async deleteExpense(id) {
        const { error } = await sb.from('expense').delete().eq('id', id);
        if (error) throw new Error(error.message);
        return true;
      },

      async sendNudge(occurrenceId) {
        const { error } = await sb.rpc('send_nudge', { target_occurrence: occurrenceId });
        if (error) throw new Error(error.message);
        return true;
      },

      // Opening the board is what "seen" means. It does not hide anything — it
      // just lets whoever nudged stop wondering.
      async markNudgesSeen() {
        const { data, error } = await sb.rpc('mark_nudges_seen');
        if (error) throw new Error(error.message);
        return data || 0;
      }
    };

    function initialName(c, id) {
      const m = byId(c.members, id);
      return m ? m.display_name : null;
    }
  }

  window.HouseholdData = live ? supabaseSource() : demoSource;
  window.HouseholdData.isLive = live;
})();
