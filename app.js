(function () {
  'use strict';

  const data = window.HouseholdData;
  const $ = id => document.getElementById(id);

  // Switching tabs should land at the top of the new screen. The browser's own
  // scroll restoration fires after render and would undo that on every reload.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  const TITLES = { home: 'Home', tasks: 'Tasks', kitchen: 'Kitchen', money: 'Money' };
  const DEFAULT_VIEW = 'home';

  const views = document.querySelectorAll('.view');
  const tabs = document.querySelectorAll('.tab');

  let signedIn = false;

  // ── Small DOM helpers ──────────────────────────────────────────────────

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function fill(node, children) {
    node.textContent = '';
    children.forEach(c => node.appendChild(c));
  }

  function setBar(trackId, barId, percent) {
    const pct = Math.max(0, Math.min(100, percent || 0));
    $(barId).style.width = pct + '%';
    $(trackId).setAttribute('aria-valuenow', String(pct));
  }

  // The standing message (the demo notice), which transient ones return to.
  let baseMessage = null;
  let bannerTimer = null;

  function banner(message, tone) {
    const b = $('banner');
    if (!message) { b.hidden = true; return; }
    b.textContent = message;
    b.className = 'banner' + (tone ? ' banner--' + tone : '');
    b.hidden = false;
  }

  function flash(message, tone) {
    clearTimeout(bannerTimer);
    banner(message, tone);
    bannerTimer = setTimeout(() => banner(baseMessage), 2600);
  }

  // ── Rendering: home ────────────────────────────────────────────────────

  function renderNeeds(items) {
    const card = $('needs-card');
    if (!items || !items.length) { card.hidden = true; return; }
    card.hidden = false;
    $('needs-h').textContent = 'Needs you · ' + items.length;

    fill($('needs-list'), items.map(item => {
      const row = el('li', 'needs__row');
      row.appendChild(el('span', 'dot' + (item.urgent ? '' : ' dot--calm')));

      const text = el('div', 'needs__text');
      text.appendChild(el('p', 'needs__title', item.title));
      text.appendChild(el('p', 'needs__meta', item.meta));
      row.appendChild(text);

      // No action when there is nothing this member may do about it — a child
      // cannot pay, and nobody nudges themselves.
      if (item.action) {
        const button = el('button', 'chip', item.action);
        button.type = 'button';
        button.addEventListener('click', () => act(item, button));
        row.appendChild(button);
      } else if (item.status) {
        // Not a button — you have already nudged. It says whether they know.
        row.appendChild(el('span', 'chip chip--quiet', item.status));
      }
      return row;
    }));
  }

  async function act(item, button) {
    const was = button.textContent;
    button.disabled = true;
    button.textContent = '…';
    try {
      if (item.kind === 'bill') await data.payBill(item.id);
      else await data.sendNudge(item.id);

      flash(item.kind === 'bill' ? 'Paid, and recorded as an expense.' : 'Nudged.', 'good');
      await refreshHome();
    } catch (err) {
      button.disabled = false;
      button.textContent = was;
      flash(err.message || 'That did not work.', 'bad');
    }
  }

  function renderPeople(people) {
    fill($('people'), (people || []).map(p => {
      const li = el('li', 'person');

      const avatar = el('span', 'avatar avatar--sm avatar--' + p.accent, p.initial);
      avatar.setAttribute('aria-hidden', 'true');
      li.appendChild(avatar);

      const track = el('span', 'track');
      track.setAttribute('role', 'progressbar');
      track.setAttribute('aria-label', p.initial);
      track.setAttribute('aria-valuenow', String(p.done));
      track.setAttribute('aria-valuemin', '0');
      track.setAttribute('aria-valuemax', String(p.total));

      const fillBar = el('span', 'track__fill track__fill--' + accentFill(p.accent));
      fillBar.style.width = (p.total ? (p.done / p.total) * 100 : 0) + '%';
      track.appendChild(fillBar);
      li.appendChild(track);

      li.appendChild(el('span', 'person__count', p.done + '/' + p.total));
      return li;
    }));
  }

  function accentFill(accent) {
    return accent === 'clay' ? 'terracotta' : accent === 'gold' ? 'gold' : 'sage';
  }

  function renderTasks(today) {
    fill($('tasks-list'), (today.occurrences || []).map(o => {
      const li = el('li', 'task');

      li.appendChild(taskCheck(o, refreshHome, 'home'));

      const label = el('label', 'task__label', o.title);
      label.setAttribute('for', 'home-occ-' + o.id);
      li.appendChild(label);

      li.appendChild(el('span', 'task__meta', o.meta || ''));
      return li;
    }));

    $('today-count').textContent = today.done + ' of ' + today.total + ' done';

    const seeAll = $('see-all');
    const more = today.remaining || 0;
    seeAll.textContent = more ? 'See all ' + more + ' →' : '';
    seeAll.hidden = !more;
  }

  // The same checkbox serves both screens; only what to redraw afterwards
  // differs.
  function taskCheck(occurrence, after, prefix) {
    const box = document.createElement('input');
    box.className = 'check';
    box.type = 'checkbox';
    box.id = prefix + '-occ-' + occurrence.id;
    box.checked = Boolean(occurrence.completed);
    box.addEventListener('change', () => tick(occurrence, box, after));
    return box;
  }

  async function tick(occurrence, box, after) {
    const wanted = box.checked;
    box.disabled = true;
    try {
      await data.setOccurrenceDone(occurrence.id, wanted, occurrence);
      occurrence.completed = wanted;
      await after();
    } catch (err) {
      // Put the box back where it was; the row never changed.
      box.checked = !wanted;
      flash('Could not save that — ' + (err.message || 'try again'), 'bad');
    } finally {
      box.disabled = false;
    }
  }

  function renderStreak(streak) {
    const card = $('streak-card');
    if (!streak) { card.hidden = true; return; }
    card.hidden = false;

    $('streak-days').textContent = streak.days;
    $('streak-title').textContent = streak.name + ' is on a streak';
    $('streak-note').textContent = streak.note;

    const pips = $('streak-pips');
    pips.setAttribute('aria-valuenow', String(streak.days));
    pips.setAttribute('aria-valuemin', '0');
    pips.setAttribute('aria-valuemax', String(streak.target));
    fill(pips, Array.from({ length: streak.target }, (_, i) =>
      el('i', 'pip' + (i < streak.days ? ' is-on' : ''))));
  }

  function renderUpcoming(event) {
    const card = $('upcoming-card');
    if (!event) { card.hidden = true; return; }
    card.hidden = false;
    $('up-dow').textContent = event.dow;
    $('up-day').textContent = event.day;
    $('up-title').textContent = event.title;
    $('up-meta').textContent = event.meta;
  }

  async function refreshHome() {
    const board = await data.loadBoard();

    $('board-date').textContent = board.date;
    $('board-greeting').textContent = board.greeting;

    const avatar = $('me-avatar');
    avatar.textContent = board.me.initial;
    avatar.className = 'avatar avatar--' + board.me.accent;

    renderNeeds(board.needsYou);
    renderPeople(board.today.people);
    renderTasks(board.today);
    renderStreak(board.streak);
    renderUpcoming(board.nextEvent);

    $('pantry-count').textContent = board.pantry.count;
    $('pantry-items').textContent = board.pantry.items;
    $('week-spent').textContent = board.week.spent;
    setBar('week-track', 'week-bar', board.week.percent);

    // Having looked at the board is what "seen" means. Deliberately not awaited
    // and deliberately quiet: failing to mark a nudge seen is not worth putting
    // an error in front of someone, and it changes nothing on this screen.
    if (data.markNudgesSeen) data.markNudgesSeen().catch(() => {});
  }

  // ── Rendering: tasks ───────────────────────────────────────────────────

  async function refreshTasks() {
    const t = await data.loadTasks();
    $('tasks-date').textContent = t.date;

    const carried = $('carried-card');
    if (!t.slipped.length) {
      carried.hidden = true;
    } else {
      carried.hidden = false;
      $('carried-h').textContent = 'Carried over · ' + t.slipped.length;
      fill($('carried-list'), t.slipped.map(o => {
        const row = el('li', 'needs__row');
        row.appendChild(el('span', 'dot'));
        const text = el('div', 'needs__text');
        text.appendChild(el('p', 'needs__title', o.title));
        text.appendChild(el('p', 'needs__meta', o.meta));
        row.appendChild(text);
        return row;
      }));
    }

    fill($('people-cards'), t.people.map(p => {
      const card = el('section', 'card person-card');

      const head = el('div', 'person-card__head');
      const avatar = el('span', 'avatar avatar--sm avatar--' + p.accent, p.initial);
      avatar.setAttribute('aria-hidden', 'true');
      head.appendChild(avatar);
      head.appendChild(el('span', 'person-card__name', p.name));
      head.appendChild(el('span', 'person-card__count',
        p.done === p.total ? 'all done' : p.done + ' of ' + p.total + ' done'));

      if (p.streak) {
        head.appendChild(el('span', 'streakpill', p.streak.days + ' days'));
      }
      card.appendChild(head);

      const list = el('ul', 'tasks');
      p.occurrences.forEach(o => {
        const li = el('li', 'task' + (o.completed ? ' task--done' : ''));
        li.appendChild(taskCheck(o, refreshTasks, 'task'));

        const label = el('label', 'task__label', o.title);
        label.setAttribute('for', 'task-occ-' + o.id);
        li.appendChild(label);

        if (o.points) li.appendChild(el('span', 'task__points', '+' + o.points));
        if (o.time) li.appendChild(el('span', 'task__meta', o.time));
        list.appendChild(li);
      });
      card.appendChild(list);
      return card;
    }));
  }

  // ── Rendering: kitchen ─────────────────────────────────────────────────

  async function refreshKitchen() {
    const k = await data.loadKitchen();

    $('kitchen-sub').textContent = k.low.length
      ? k.low.length + (k.low.length === 1 ? ' thing' : ' things') + ' running low'
      : 'Everything in stock';

    // Running low
    const lowCard = $('low-card');
    lowCard.hidden = !k.low.length;
    if (k.low.length) {
      $('low-card-h').textContent = 'Running low · ' + k.low.length;
      fill($('low-list'), k.low.map(item => {
        const li = el('li');
        const pill = el('button', 'pill', item.name);
        pill.type = 'button';
        pill.title = 'Put back in stock';
        pill.addEventListener('click', () => guard(pill, async () => {
          await data.setPantryLow(item.id, false);
          await refreshKitchen();
        }));
        li.appendChild(pill);
        return li;
      }));
    }

    // The open list
    const listCard = $('list-card');
    listCard.hidden = !k.list;
    if (k.list) {
      $('list-count').textContent = k.list.got + ' of ' + k.list.items.length + ' got';
      fill($('list-items'), k.list.items.map(item => {
        const li = el('li', 'task' + (item.got ? ' task--done' : ''));

        const box = document.createElement('input');
        box.className = 'check';
        box.type = 'checkbox';
        box.id = 'item-' + item.id;
        box.checked = item.got;
        box.addEventListener('change', () => guard(box, async () => {
          await data.setListItemGot(item.id, box.checked);
          await refreshKitchen();
        }, () => { box.checked = !box.checked; }));
        li.appendChild(box);

        const label = el('label', 'task__label', item.label);
        label.setAttribute('for', box.id);
        li.appendChild(label);
        return li;
      }));

      const finish = $('finish-shop');
      finish.textContent = k.list.got
        ? 'Finish the shop · ' + k.list.got + ' restocked →'
        : 'Finish the shop →';
      finish.onclick = () => guard(finish, async () => {
        const n = await data.completeShoppingList(k.list.id);
        flash(n ? n + (n === 1 ? ' thing' : ' things') + ' back in stock.' : 'List closed.', 'good');
        await refreshKitchen();
      });
    }

    // Everything else
    $('stock-count').textContent = k.stocked.length + ' items';
    fill($('stock-list'), k.stocked.map(item => {
      const li = el('li', 'stockrow');
      li.appendChild(el('span', 'stockrow__name', item.name));

      const mark = el('button', 'chip chip--quiet chip--light', 'Running low');
      mark.type = 'button';
      mark.addEventListener('click', () => guard(mark, async () => {
        await data.setPantryLow(item.id, true);
        await refreshKitchen();
      }));
      li.appendChild(mark);
      return li;
    }));
  }

  // Disables a control while its write is in flight, and puts the message on
  // screen if it fails. `undo` restores anything the click changed optimistically.
  async function guard(control, run, undo) {
    control.disabled = true;
    try {
      await run();
    } catch (err) {
      if (undo) undo();
      flash(err.message || 'That did not work.', 'bad');
    } finally {
      control.disabled = false;
    }
  }

  $('add-to-list').addEventListener('click', () => guard($('add-to-list'), async () => {
    await data.addLowToList();
    flash('Added to the list.', 'good');
    await refreshKitchen();
  }));

  // ── Rendering: money ───────────────────────────────────────────────────

  async function refreshMoney() {
    const m = await data.loadMoney();

    $('money-period').textContent = m.periodLabel;
    $('budget-spent').textContent = m.budget.spent;
    $('budget-ceiling').textContent = m.budget.ceiling;
    $('budget-left').textContent = m.budget.left;
    setBar('budget-track', 'budget-bar', m.budget.percent);

    const card = $('bills-card');
    if (!m.billsDue.length) {
      card.hidden = true;
    } else {
      card.hidden = false;
      $('due-h').textContent = 'Due soon · ' + m.billsDue.length;
      $('bills-total').textContent = m.billsTotal;
      fill($('bills-list'), m.billsDue.map(b => {
        const row = el('li', 'needs__row');
        row.appendChild(el('span', 'dot' + (b.urgent ? '' : ' dot--calm')));
        const text = el('div', 'needs__text');
        text.appendChild(el('p', 'needs__title', b.title));
        text.appendChild(el('p', 'needs__meta', b.dueLabel));
        row.appendChild(text);
        const pay = el('button', 'chip', 'Pay');
        pay.type = 'button';
        pay.addEventListener('click', async () => {
          const was = pay.textContent;
          pay.disabled = true;
          pay.textContent = '…';
          try {
            await data.payBill(b.id);
            flash('Paid, and recorded as an expense.', 'good');
            await refreshMoney();
          } catch (err) {
            pay.disabled = false;
            pay.textContent = was;
            flash(err.message || 'That did not work.', 'bad');
          }
        });
        row.appendChild(pay);
        return row;
      }));
    }

    $('ledger-count').textContent = m.expenses.length + ' this week';
    fill($('ledger-list'), m.expenses.map(e => {
      const li = el('li', 'entry');
      const avatar = el('span', 'avatar avatar--xs avatar--' + e.accent, e.initial);
      avatar.setAttribute('aria-hidden', 'true');
      li.appendChild(avatar);

      const body = el('span', 'entry__body');
      body.appendChild(el('span', 'entry__title', e.label));
      body.appendChild(el('span', 'entry__meta', e.meta));
      li.appendChild(body);

      li.appendChild(el('span', 'entry__amount', e.amount));
      return li;
    }));
  }

  // ── Adding things ──────────────────────────────────────────────────────

  // What the + offers. `adults` marks the kinds the policies in 0001 reserve
  // for adults — the database refuses either way, this just stops offering a
  // child a form that cannot be submitted.
  const KINDS = [
    { key: 'task', label: 'Task', adults: true, screen: 'tasks' },
    { key: 'expense', label: 'Expense', adults: false, screen: 'money' },
    { key: 'pantry', label: 'Pantry item', adults: false, screen: 'kitchen' },
    { key: 'bill', label: 'Bill', adults: true, screen: 'money' }
  ];

  let sheetKind = 'task';
  let roster = null;

  function field(label, control) {
    const wrap = el('label', 'field-row');
    wrap.appendChild(el('span', 'field-row__label', label));
    wrap.appendChild(control);
    return wrap;
  }

  function input(type, name, attrs) {
    const node = document.createElement('input');
    node.className = 'field';
    node.type = type;
    node.name = name;
    Object.keys(attrs || {}).forEach(k => node.setAttribute(k, attrs[k]));
    return node;
  }

  function select(name, options) {
    const node = document.createElement('select');
    node.className = 'field';
    node.name = name;
    options.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      node.appendChild(opt);
    });
    return node;
  }

  function renderFields() {
    const box = $('sheet-fields');
    const people = roster.members.map(m => ({ value: m.key, label: m.name }));

    if (sheetKind === 'task') {
      const who = select('assignee', people);
      const points = input('number', 'points', { min: '0', max: '100', step: '5', value: '0' });
      const pointsRow = field('Points', points);

      // Only a child earns points, so only a child is offered them.
      const syncPoints = () => {
        const member = roster.members.find(m => m.key === who.value);
        pointsRow.hidden = !member || member.role !== 'child';
        if (pointsRow.hidden) points.value = '0';
      };
      who.addEventListener('change', syncPoints);

      fill(box, [
        field('What', input('text', 'title', { placeholder: 'Feed the dog', required: 'required' })),
        field('Who', who),
        field('When', select('recurrence', [
          { value: 'once', label: 'Just today' },
          { value: 'daily', label: 'Every day' },
          { value: 'weekly', label: 'Weekdays' }
        ])),
        field('Time', input('time', 'time', {})),
        pointsRow
      ]);
      syncPoints();

    } else if (sheetKind === 'expense') {
      fill(box, [
        field('What', input('text', 'label', { placeholder: 'Market', required: 'required' })),
        field('How much', input('number', 'amount', { min: '1', step: '1', placeholder: '700', required: 'required' })),
        field('Who paid', select('spentBy', people))
      ]);

    } else if (sheetKind === 'pantry') {
      fill(box, [
        field('What', input('text', 'name', { placeholder: 'Olive oil', required: 'required' })),
        field('Already low', select('low', [
          { value: 'no', label: 'No, just stocked' },
          { value: 'yes', label: 'Yes, add to the list' }
        ]))
      ]);

    } else {
      fill(box, [
        field('What', input('text', 'label', { placeholder: 'Water bill', required: 'required' })),
        field('How much', input('number', 'amount', { min: '1', step: '1', placeholder: '740', required: 'required' })),
        field('Due', input('date', 'dueOn', { value: new Date().toISOString().slice(0, 10), required: 'required' }))
      ]);
    }

    if (sheetKind === 'task' && roster.me.key) {
      const who = box.querySelector('select[name="assignee"]');
      if (who) who.value = roster.me.key;
    }

    const first = box.querySelector('input, select');
    if (first) setTimeout(() => first.focus(), 30);
  }

  function renderKinds() {
    const allowed = KINDS.filter(k => !k.adults || roster.me.role === 'adult');
    if (!allowed.some(k => k.key === sheetKind)) sheetKind = allowed[0].key;

    fill($('sheet-kinds'), allowed.map(k => {
      const li = el('li');
      const b = el('button', 'kind' + (k.key === sheetKind ? ' is-on' : ''), k.label);
      b.type = 'button';
      b.addEventListener('click', () => {
        sheetKind = k.key;
        $('sheet-error').textContent = '';
        renderKinds();
        renderFields();
      });
      li.appendChild(b);
      return li;
    }));
  }

  async function openSheet() {
    try {
      roster = await data.loadMembers();
    } catch (err) {
      flash('Could not load the household — ' + (err.message || 'try again'), 'bad');
      return;
    }

    // Default to whatever the screen you are on is about.
    const here = routeFromHash();
    const match = KINDS.find(k => k.screen === here && (!k.adults || roster.me.role === 'adult'));
    if (match) sheetKind = match.key;

    $('sheet-error').textContent = '';
    renderKinds();
    renderFields();
    $('sheet').hidden = false;
  }

  function closeSheet() {
    $('sheet').hidden = true;
    $('sheet-form').reset();
  }

  async function submitSheet(e) {
    e.preventDefault();
    const form = $('sheet-form');
    const get = name => {
      const node = form.elements[name];
      return node ? String(node.value).trim() : '';
    };
    const err = $('sheet-error');
    err.textContent = '';

    try {
      if (sheetKind === 'task') {
        if (!get('title')) throw new Error('Give it a name.');
        await data.createTask({
          title: get('title'),
          assignee: get('assignee'),
          recurrence: get('recurrence'),
          time: get('time') || null,
          points: Number(get('points') || 0)
        });
      } else if (sheetKind === 'expense') {
        const amount = Number(get('amount'));
        if (!get('label')) throw new Error('Give it a name.');
        if (!(amount > 0)) throw new Error('How much was it?');
        await data.createExpense({ label: get('label'), amount: amount, spentBy: get('spentBy') });
      } else if (sheetKind === 'pantry') {
        if (!get('name')) throw new Error('Give it a name.');
        await data.createPantryItem({ name: get('name'), low: get('low') === 'yes' });
      } else {
        const amount = Number(get('amount'));
        if (!get('label')) throw new Error('Give it a name.');
        if (!(amount > 0)) throw new Error('How much is it?');
        if (!get('dueOn')) throw new Error('When is it due?');
        await data.createBill({ label: get('label'), amount: amount, dueOn: get('dueOn') });
      }
    } catch (ex) {
      err.textContent = ex.message || 'That did not work.';
      return;
    }

    closeSheet();
    flash('Added.', 'good');
    await go(routeFromHash());
  }

  document.querySelector('.fab').addEventListener('click', openSheet);
  $('sheet-close').addEventListener('click', closeSheet);
  $('sheet-scrim').addEventListener('click', closeSheet);
  $('sheet-form').addEventListener('submit', submitSheet);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('sheet').hidden) closeSheet();
  });

  // ── Routing ────────────────────────────────────────────────────────────

  function routeFromHash() {
    const name = (location.hash || '').replace(/^#\/?/, '');
    return Object.prototype.hasOwnProperty.call(TITLES, name) ? name : DEFAULT_VIEW;
  }

  // View elements are id="view-<route>", not id="<route>". If they shared the
  // route's name the browser would treat #money as an in-page anchor as well as
  // a route, and scroll to it — see docs/adr/0003.
  function show(name) {
    views.forEach(v => { v.hidden = v.id !== 'view-' + name; });
    tabs.forEach(t => {
      const active = t.getAttribute('data-tab') === name;
      t.classList.toggle('is-active', active);
      if (active) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    document.title = (TITLES[name] || 'Household') + ' · Household';
    window.scrollTo(0, 0);
  }

  async function go(name) {
    if (!signedIn) return showSignIn();
    show(name);
    try {
      if (name === 'home') await refreshHome();
      if (name === 'tasks') await refreshTasks();
      if (name === 'kitchen') await refreshKitchen();
      if (name === 'money') await refreshMoney();
    } catch (err) {
      banner('Could not load — ' + (err.message || 'unknown error'), 'bad');
    }
  }

  // ── Sign in ────────────────────────────────────────────────────────────

  function showSignIn() {
    views.forEach(v => { v.hidden = v.id !== 'view-signin'; });
    $('tabbar').hidden = true;
    document.title = 'Sign in · Household';
  }

  $('signin-form').addEventListener('submit', async e => {
    e.preventDefault();
    const status = $('signin-status');
    const email = $('signin-email').value.trim();
    if (!email) return;
    status.textContent = 'Sending…';
    try {
      await data.signIn(email);
      status.textContent = 'Check your email for the link.';
    } catch (err) {
      status.textContent = err.message || 'That did not work.';
    }
  });

  // ── Boot ───────────────────────────────────────────────────────────────

  window.addEventListener('hashchange', () => go(routeFromHash()));

  (async function boot() {
    if (data.isLive && !window.supabase) {
      banner('Configured for Supabase, but the client did not load.', 'bad');
      return;
    }

    try {
      signedIn = await data.signedIn();
    } catch (err) {
      signedIn = false;
    }

    if (!signedIn) return showSignIn();

    $('tabbar').hidden = false;
    if (!data.isLive) {
      baseMessage = 'Demo data — nothing is saved. Add your project to config.js to go live.';
      banner(baseMessage);
    }
    await go(routeFromHash());
  })();
})();
