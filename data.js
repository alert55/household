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

  // The household's date, not the browser's and not the server's. Whether an
  // occurrence has slipped depends entirely on which day it belongs to.
  function todayIn(timezone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    return parts; // YYYY-MM-DD
  }

  function addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function dayName(iso) { return DAYS[new Date(iso + 'T00:00:00Z').getUTCDay()]; }

  function todayIso() { return new Date().toISOString().slice(0, 10); }

  function isoIn(days) { return addDays(todayIso(), days); }

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

  function relativeDay(iso, today) {
    if (iso === today) return 'today';
    if (iso === addDays(today, -1)) return 'yesterday';
    if (iso === addDays(today, 1)) return 'tomorrow';
    return dayName(iso);
  }

  function timeLabel(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    let h = d.getHours();
    const m = d.getMinutes();
    const suffix = h >= 12 ? 'p' : 'a';
    h = h % 12 || 12;
    return h + (m ? ':' + String(m).padStart(2, '0') : ':00') + suffix;
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
    needsYou: [
      { id: 'demo-trash', kind: 'occurrence', title: 'Trash to the curb', assignee: 'alex', slipped: 'slipped yesterday', urgent: true },
      { id: 'demo-water', kind: 'bill', title: 'Water bill · ฿740', meta: 'Due today', urgent: true }
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
    billsDue: [
      { id: 'demo-water', label: 'Water bill', amount: 740, dueLabel: 'Due today', urgent: true },
      { id: 'demo-net', label: 'Internet', amount: 1200, dueLabel: 'Due Friday', urgent: false }
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

  // Timed things first, in time order; the rest are "sometime today" and sort
  // by name so the list does not shuffle between renders.
  function demoOrdered() {
    return demo.occurrences.slice().sort((a, b) => {
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
      .filter(e => e.date >= today)
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
            .filter(Boolean).join(' · ')
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
    return demo.needsYou.map(item => {
      if (item.kind === 'bill') {
        return {
          id: item.id, kind: 'bill', title: item.title, meta: item.meta,
          urgent: item.urgent,
          action: me.role === 'adult' ? 'Pay' : null
        };
      }

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
    });
  }

  const demoSource = {
    live: false,

    async signedIn() { return true; },

    async loadBoard() {
      const now = new Date();
      const ordered = demoOrdered();
      const done = demo.occurrences.filter(o => o.completed).length;
      const open = ordered.filter(o => !o.completed);
      return {
        date: DAYS[now.getDay()] + ', ' + MONTHS[now.getMonth()] + ' ' + now.getDate(),
        greeting: 'Morning, ' + demo.me.name,
        me: demo.me,
        needsYou: demoNeedsYou(),
        today: {
          done: done,
          total: demo.occurrences.length,
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
          remaining: demo.occurrences.length
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
      demo.events.push({
        id: 'ev-' + Date.now(),
        title: input.title,
        subject: input.subject || null,
        responsible: input.responsible || null,
        date: input.onDate,
        at: toMinutes(input.atTime)
      });
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
          occurrences: p.occurrences.map(o => ({
            id: o.id,
            title: o.title,
            time: o.time,
            // Only a child earns points, so only a child is shown them.
            points: p.role === 'child' ? o.points : 0,
            completed: o.completed
          }))
        }))
      };
    },

    async loadMembers() {
      return {
        me: demo.me,
        members: Object.keys(demo.members).map(k => demo.members[k])
      };
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
        completed: false
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
      const id = 'b-' + Date.now();
      demo.billsDue.push({
        id: id, label: input.label, amount: input.amount,
        dueLabel: input.dueOn === todayIso() ? 'Due today' : 'Due ' + dayName(input.dueOn),
        urgent: input.dueOn <= todayIso()
      });
      if (input.dueOn <= todayIso()) {
        demo.needsYou.push({
          id: id, kind: 'bill',
          title: input.label + ' · ' + money(input.amount, 'THB'),
          meta: 'Due today', urgent: true
        });
      }
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

    async loadMoney() {
      const w = demo.week;
      return {
        periodLabel: 'Sep 8 – 14',
        budget: {
          spent: money(w.spent, 'THB'),
          ceiling: 'of ' + money(w.ceiling, 'THB'),
          percent: Math.round((w.spent / w.ceiling) * 100),
          left: money(w.ceiling - w.spent, 'THB') + ' left · ' + w.daysLeft + ' days to go'
        },
        billsDue: demo.billsDue.map(b => ({
          id: b.id, urgent: b.urgent, dueLabel: b.dueLabel,
          title: b.label + ' · ' + money(b.amount, 'THB')
        })),
        billsTotal: money(demo.billsDue.reduce((a, b) => a + b.amount, 0), 'THB'),
        expenses: demo.expenses.map(e => ({
          id: e.id, label: e.label, initial: e.initial, accent: e.accent,
          meta: e.who + ' · ' + e.when, amount: money(e.amount, 'THB')
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
      demo.needsYou = demo.needsYou.filter(n => !(n.kind === 'bill' && n.id === id));
      demo.expenses.unshift({
        id: 'e-' + id, label: bill.label, amount: bill.amount,
        who: demo.me.name, initial: demo.me.initial, accent: demo.me.accent, when: 'today'
      });
      demo.week.spent += bill.amount;
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

      const { data: me, error } = await sb
        .from('member')
        .select('id, display_name, role, accent, household_id, household:household_id (id, name, timezone, currency)')
        .eq('user_id', auth.user.id)
        .single();
      if (error) throw error;

      const { data: members } = await sb
        .from('member')
        .select('id, display_name, role, accent')
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
        const { error } = await sb.auth.signInWithOtp({ email: email });
        if (error) throw error;
      },

      async signOut() { ctx = null; await sb.auth.signOut(); },

      async loadBoard() {
        const c = await context();
        const tz = c.household.timezone;
        const cur = c.household.currency;
        const today = todayIn(tz);

        const [openToday, slipped, bills, streaks, low, spend, budget, ev, nudges] = await Promise.all([
          sb.from('occurrence_current').select('*').eq('household_id', c.household.id).eq('due_on', today),
          sb.from('occurrence_current').select('*').eq('household_id', c.household.id).eq('slipped', true).lt('due_on', today).order('due_on'),
          sb.from('bill').select('*').eq('household_id', c.household.id).is('paid_at', null).lte('due_on', today).order('due_on'),
          sb.from('streak_current').select('*').eq('household_id', c.household.id).order('length', { ascending: false }).limit(1),
          sb.from('pantry_item').select('name').eq('household_id', c.household.id).eq('is_low', true),
          sb.from('expense').select('amount').eq('household_id', c.household.id).gte('spent_on', addDays(today, -6)),
          sb.from('budget').select('amount').eq('household_id', c.household.id).eq('period', 'weekly').lte('effective_from', today).order('effective_from', { ascending: false }).limit(1),
          sb.from('event').select('*').eq('household_id', c.household.id).gte('starts_at', new Date().toISOString()).order('starts_at').limit(1),
          sb.from('nudge').select('occurrence_id, from_member_id, to_member_id, seen_at').eq('household_id', c.household.id).gte('nudged_on', addDays(today, -30))
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

        const needsYou = (slipped.data || []).map(o => {
          const mine = o.effective_assignee_id === c.me.id;
          const on = allNudges.filter(n => n.occurrence_id === o.id);
          const fromMe = on.find(n => n.from_member_id === c.me.id);
          const toMe = on.filter(n => n.to_member_id === c.me.id);
          const slippedLabel = 'slipped ' + relativeDay(o.due_on, today);

          // If people are waiting on you, say who — that is the whole point of
          // a nudge, and it belongs where you already look.
          let meta;
          if (mine && toMe.length) {
            const names = toMe.map(n => initialName(c, n.from_member_id)).filter(Boolean);
            meta = names.join(' and ') + ' nudged you · ' + slippedLabel;
          } else {
            meta = (initialName(c, o.effective_assignee_id) || 'Unassigned') + ' · ' + slippedLabel;
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
              meta: [initialName(c, o.effective_assignee_id), o.due_time ? timeLabel(o.due_at) : null].filter(Boolean).join(' · '),
              completed: Boolean(o.completed_at),
              points: o.points_on_offer,
              assignee: o.effective_assignee_id
            })),
            remaining: rows.length
          },
          streak: streak ? {
            name: streakMember ? streakMember.display_name : '',
            days: streak.length,
            target: 7,
            note: 'Kept ' + streak.length + ' days straight.'
          } : null,
          pantry: {
            count: (low.data || []).length,
            items: (low.data || []).map(p => p.name).join(', ')
          },
          week: {
            spent: money(spent, cur),
            percent: ceiling ? Math.round((spent / ceiling) * 100) : 0
          },
          nextEvent: event ? {
            dow: dayName(event.occurs_on || event.starts_at.slice(0, 10)).slice(0, 3),
            day: Number((event.occurs_on || event.starts_at.slice(0, 10)).slice(8, 10)),
            title: event.title,
            meta: [timeLabel(event.starts_at), initialName(c, event.responsible_id)].filter(Boolean).join(' · ')
          } : null
        };
      },

      async loadTasks() {
        const c = await context();
        const today = todayIn(c.household.timezone);

        const [todayRes, slippedRes, streakRes, eventRes] = await Promise.all([
          sb.from('occurrence_current').select('*').eq('household_id', c.household.id).eq('due_on', today),
          sb.from('occurrence_current').select('*').eq('household_id', c.household.id).eq('slipped', true).lt('due_on', today).order('due_on'),
          sb.from('streak_current').select('*').eq('household_id', c.household.id),
          sb.from('event').select('*').eq('household_id', c.household.id).gte('starts_at', new Date().toISOString()).order('starts_at').limit(5)
        ]);

        const rows = todayRes.data || [];
        const streaks = streakRes.data || [];

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
            occurrences: mine.map(o => ({
              id: o.id,
              title: o.title,
              time: o.due_time ? timeLabel(o.due_at) : null,
              points: m.role === 'child' ? (o.points_on_offer || 0) : 0,
              completed: Boolean(o.completed_at),
              assignee: o.effective_assignee_id
            }))
          };
        }).filter(p => p.total > 0);

        return {
          date: dayName(today) + ', ' + MONTHS[Number(today.slice(5, 7)) - 1] + ' ' + Number(today.slice(8, 10)),
          slipped: (slippedRes.data || []).map(o => ({
            id: o.id,
            title: o.title,
            meta: (initialName(c, o.effective_assignee_id) || 'Unassigned') +
              ' · slipped ' + relativeDay(o.due_on, today)
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
              meta: [timeLabel(e.starts_at),
                e.responsible_id ? initialName(c, e.responsible_id) + ' takes them' : null]
                .filter(Boolean).join(' · ')
            };
          })
        };
      },

      async loadMembers() {
        const c = await context();
        return {
          me: { key: c.me.id, name: c.me.display_name, initial: initial(c.me), accent: c.me.accent, role: c.me.role },
          members: c.members.map(m => ({
            key: m.id, name: m.display_name, initial: initial(m), accent: m.accent, role: m.role
          }))
        };
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
          sb.from('bill').select('*').eq('household_id', c.household.id).is('paid_at', null).lte('due_on', addDays(today, 7)).order('due_on'),
          sb.from('expense').select('*').eq('household_id', c.household.id).gte('spent_on', weekStart).order('spent_on', { ascending: false })
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
            dueLabel: b.due_on === today ? 'Due today' : 'Due ' + relativeDay(b.due_on, today)
          })),
          billsTotal: money(dueRows.reduce((a, b) => a + Number(b.amount), 0), cur),
          expenses: rows.map(e => {
            const who = byId(c.members, e.spent_by);
            return {
              id: e.id,
              label: e.label,
              initial: initial(who),
              accent: who ? who.accent : 'sage',
              meta: [who ? who.display_name : 'Someone', relativeDay(e.spent_on, today)].join(' · '),
              amount: money(e.amount, cur)
            };
          })
        };
      },

      async setOccurrenceDone(id, done, occurrence) {
        const c = await context();
        // The trigger in 0001 rejects points for anyone but a child, so award
        // them only when the person completing it is one.
        const earner = occurrence && occurrence.assignee ? byId(c.members, occurrence.assignee) : c.me;
        const points = done && earner && earner.role === 'child' ? (occurrence.points || 0) : 0;

        const { error } = await sb.from('occurrence').update({
          completed_at: done ? new Date().toISOString() : null,
          completed_by: done ? (earner ? earner.id : c.me.id) : null,
          points_awarded: points
        }).eq('id', id);

        if (error) throw error;
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
