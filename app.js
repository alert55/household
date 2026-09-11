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
    const [t, roster] = await Promise.all([data.loadTasks(), data.loadMembers()]);
    const isAdult = roster.me.role === 'adult';
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

        // A separate control, not the row: tapping the name still ticks it, which
        // is what a child and anyone in a hurry wants. Adults only — the database
        // refuses anyone else regardless (ADR 0005).
        if (isAdult) li.appendChild(editButton('Edit ' + o.title, () => editTask(o)));
        list.appendChild(li);
      });
      card.appendChild(list);
      return card;
    }));

    // ADR 0001 said a day view has to render two shapes, not one shape twice.
    // These carry no checkbox on purpose: an event is never ticked off.
    const events = t.events || [];
    $('coming-label').hidden = !events.length;
    $('coming-card').hidden = !events.length;
    if (events.length) {
      fill($('coming-list'), events.map(e => {
        const li = el('li', 'eventrow');
        li.appendChild(el('span', 'eventrow__rail'));

        const body = el('span', 'eventrow__body');
        body.appendChild(el('span', 'eventrow__title', e.title));
        body.appendChild(el('span', 'eventrow__meta', e.meta));
        li.appendChild(body);

        li.appendChild(el('span', 'eventrow__when', e.when));
        if (isAdult) li.appendChild(editButton('Edit ' + e.title, () => editEvent(e)));
        return li;
      }));
    }
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
        const li = el('li', 'pillrow');
        const pill = el('button', 'pill', item.name);
        pill.type = 'button';
        pill.title = 'Put back in stock';
        pill.addEventListener('click', () => guard(pill, async () => {
          await data.setPantryLow(item.id, false);
          await refreshKitchen();
        }));
        li.appendChild(pill);
        // Beside the pill, not on it: tapping the pill already means "got it".
        li.appendChild(editButton('Edit ' + item.name, () => editPantry(item, true)));
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
      li.appendChild(editButton('Edit ' + item.name, () => editPantry(item, false)));
      return li;
    }));
  }

  // Shown to every member: the pantry_touch policy lets anyone in the household
  // change the pantry, and this follows that rule rather than inventing a
  // stricter one here.
  function editPantry(item, isLow) {
    const name = input('text', 'name', { required: 'required' });
    name.value = item.name;
    const low = select('low', [
      { value: 'no', label: 'No, it is stocked' },
      { value: 'yes', label: 'Yes, running low' }
    ]);
    low.value = isLow ? 'yes' : 'no';

    openEditor({
      title: 'Edit pantry item',
      fields: [
        field('What', name),
        field('Running low', low),
        hint('Deleting it keeps it on any shopping list it is already on.')
      ],
      saved: 'Saved.',
      actions: [{
        label: 'Delete from pantry',
        confirm: 'Tap again to delete',
        danger: true,
        run: () => data.deletePantryItem(item.id),
        done: 'Deleted.'
      }],
      save: async get => {
        if (!get('name')) throw new Error('Give it a name.');
        await data.editPantryItem(item.id, {
          name: get('name'),
          low: get('low') === 'yes',
          wasLow: isLow
        });
      }
    });
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
    const [m, roster] = await Promise.all([data.loadMoney(), data.loadMembers()]);
    const isAdult = roster.me.role === 'adult';

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
        if (isAdult) row.appendChild(editButton('Edit ' + b.title, () => editBill(b)));
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
      if (isAdult) li.appendChild(editButton('Edit ' + e.label, () => editExpense(e)));
      return li;
    }));
  }

  // ── Adding things ──────────────────────────────────────────────────────

  // What the + offers. `adults` marks the kinds the policies in 0001 reserve
  // for adults — the database refuses either way, this just stops offering a
  // child a form that cannot be submitted.
  const KINDS = [
    { key: 'task', label: 'Task', adults: true, screen: 'tasks' },
    { key: 'event', label: 'Event', adults: true, screen: null },
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

  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function ordinal(n) {
    const tens = n % 100;
    if (tens >= 11 && tens <= 13) return n + 'th';
    return n + (['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  }

  // Says in words what a repeat will actually do, so "every month" on the 31st
  // does not surprise anyone in February. The clamp is the rule in 0003.
  function repeatHint(repeats, iso) {
    if (!iso || !repeats || repeats === 'none') return '';
    const d = new Date(iso + 'T00:00:00Z');
    if (repeats === 'daily') return 'Every day, starting then.';
    if (repeats === 'weekly') return 'Every ' + WEEKDAYS[d.getUTCDay()] + '.';
    const n = d.getUTCDate();
    return n > 28
      ? 'On the ' + ordinal(n) + ' of every month — or the last day, in months too short to have one.'
      : 'On the ' + ordinal(n) + ' of every month.';
  }

  // A Repeats select and the hint under it, kept in step with a date input.
  function repeatControls(dateInput, options) {
    const repeats = select('repeats', options);
    const hint = el('p', 'field-hint');
    const sync = () => { hint.textContent = repeatHint(repeats.value, dateInput.value); };
    repeats.addEventListener('change', sync);
    dateInput.addEventListener('change', sync);
    dateInput.addEventListener('input', sync);
    return { row: field('Repeats', repeats), hint: hint, sync: sync };
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

    } else if (sheetKind === 'event') {
      // Both people are optional: an event may be about the whole household,
      // and it may be one nobody has to take anyone to (CONTEXT.md).
      const anyone = [{ value: '', label: 'Everyone' }].concat(people);
      const nobody = [{ value: '', label: 'Nobody' }].concat(people);

      const onDate = input('date', 'onDate', { value: new Date().toISOString().slice(0, 10), required: 'required' });
      const rep = repeatControls(onDate, [
        { value: 'none', label: 'Just this once' },
        { value: 'weekly', label: 'Every week' },
        { value: 'daily', label: 'Every day' },
        { value: 'monthly', label: 'Every month' }
      ]);

      fill(box, [
        field('What', input('text', 'title', { placeholder: 'Swim class', required: 'required' })),
        field('Who it is about', select('subject', anyone)),
        field('Who takes them', select('responsible', nobody)),
        field('Date', onDate),
        field('Time', input('time', 'atTime', { value: '17:30', required: 'required' })),
        rep.row,
        rep.hint
      ]);
      rep.sync();

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
      const dueOn = input('date', 'dueOn', { value: new Date().toISOString().slice(0, 10), required: 'required' });
      // Monthly first: that is what almost every household bill is.
      const rep = repeatControls(dueOn, [
        { value: 'none', label: 'Just this once' },
        { value: 'monthly', label: 'Every month' },
        { value: 'weekly', label: 'Every week' }
      ]);

      fill(box, [
        field('What', input('text', 'label', { placeholder: 'Water bill', required: 'required' })),
        field('How much', input('number', 'amount', { min: '1', step: '1', placeholder: '740', required: 'required' })),
        field('Due', dueOn),
        rep.row,
        rep.hint
      ]);
      rep.sync();
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

    editing = null;
    $('sheet-title').textContent = 'Add';
    $('sheet-kinds').hidden = false;
    $('sheet-submit').textContent = 'Add';
    $('sheet-submit').hidden = false;
    fill($('sheet-actions'), []);
    $('sheet-error').textContent = '';
    renderKinds();
    renderFields();
    $('sheet').hidden = false;
  }

  function closeSheet() {
    $('sheet').hidden = true;
    $('sheet-form').reset();
    editing = null;
  }

  // ── Editing ────────────────────────────────────────────────────────────

  // Set while the sheet is editing something rather than adding it.
  let editing = null;

  // Edit reuses the add sheet, so there is one sheet to keep right, not two.
  // The caller supplies the fields, what Save does, and any other actions.
  function openEditor(config) {
    editing = config;
    $('sheet-title').textContent = config.title;
    $('sheet-kinds').hidden = true;
    $('sheet-error').textContent = '';
    $('sheet-submit').textContent = 'Save';
    $('sheet-submit').hidden = !config.save;
    fill($('sheet-fields'), config.fields);
    renderActions(config.actions || []);
    $('sheet').hidden = false;
    const first = $('sheet-fields').querySelector('input, select');
    if (first) setTimeout(() => first.focus(), 30);
  }

  // Destructive actions ask twice, in place: the first tap turns the button into
  // its own confirmation. No dialog, and no stopping a task by brushing it.
  function renderActions(actions) {
    fill($('sheet-actions'), actions.map(a => {
      const b = el('button', 'sheet__action' + (a.danger ? ' is-danger' : ''), a.label);
      b.type = 'button';
      let armed = false;
      b.addEventListener('click', async () => {
        if (a.confirm && !armed) {
          armed = true;
          b.textContent = a.confirm;
          b.classList.add('is-armed');
          return;
        }
        b.disabled = true;
        try {
          await a.run();
        } catch (err) {
          b.disabled = false;
          $('sheet-error').textContent = err.message || 'That did not work.';
          return;
        }
        closeSheet();
        flash(a.done || 'Done.', 'good');
        await go(routeFromHash());
      });
      return b;
    }));
  }

  function hint(text) {
    return el('p', 'field-hint', text);
  }

  function editButton(label, onClick) {
    const b = el('button', 'rowedit', '⋯');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }

  async function editTask(o) {
    const who = await data.loadMembers();
    const people = who.members.map(m => ({ value: m.key, label: m.name }));

    const title = input('text', 'title', { required: 'required' });
    title.value = o.edit.title;
    const assignee = select('assignee', people);
    assignee.value = o.edit.assignee;
    const time = input('time', 'time', {});
    time.value = o.edit.time;

    const fields = [
      field('What', title),
      hint('A new name applies everywhere this task appears, not only today.'),
      field('Who', assignee),
      field('Time', time)
    ];

    // Who and when can differ day to day; the scope says which days change.
    if (o.edit.recurs) {
      fields.push(field('Change who and when', select('scope', [
        { value: 'this', label: 'Just today' },
        { value: 'forward', label: 'Today and every day after' }
      ])));
    }

    const actions = [];
    if (o.edit.recurs) {
      if (!o.completed) {
        actions.push({
          label: 'Skip today',
          confirm: 'Tap again to skip today',
          run: () => data.skipOccurrence(o.id),
          done: 'Skipped for today. Any streak is safe.'
        });
      }
      actions.push({
        label: 'Stop this task',
        confirm: 'Tap again — it will not come back',
        danger: true,
        run: () => data.retireTask(o.id, o.taskId),
        done: 'Stopped. What was already done stays on record.'
      });
    } else if (!o.completed) {
      // A one-off has no days ahead, so skipping it is removing it.
      actions.push({
        label: 'Remove',
        confirm: 'Tap again to remove',
        danger: true,
        run: () => data.skipOccurrence(o.id),
        done: 'Removed.'
      });
    }

    openEditor({
      title: 'Edit task',
      fields: fields,
      actions: actions,
      saved: 'Saved.',
      save: async get => {
        if (!get('title')) throw new Error('Give it a name.');
        await data.editOccurrence(o.id, {
          title: get('title'),
          assignee: get('assignee'),
          time: get('time') || null,
          scope: get('scope') || 'this'
        });
      }
    });
  }

  function editBill(b) {
    const label = input('text', 'label', { required: 'required' });
    label.value = b.edit.label;
    const amount = input('number', 'amount', { min: '1', step: '1', required: 'required' });
    amount.value = String(b.edit.amount);
    const dueOn = input('date', 'dueOn', { required: 'required' });
    dueOn.value = b.edit.dueOn;

    const fields = [field('What', label), field('How much', amount), field('Due', dueOn)];
    const actions = [];

    if (b.edit.repeats) {
      const scope = select('scope', [
        { value: 'this', label: 'Just this one' },
        { value: 'forward', label: 'This one and every one after' }
      ]);
      const note = hint('');
      // A series keeps its own day; only this one bill can be moved.
      const sync = () => {
        const forward = scope.value === 'forward';
        dueOn.disabled = forward;
        note.textContent = forward
          ? 'The date stays with the series. Only the name and amount change from here on.'
          : 'Only this bill changes — the series will leave it as you set it.';
      };
      scope.addEventListener('change', sync);
      fields.push(field('Change', scope), note);
      setTimeout(sync, 0);

      actions.push({
        label: 'Skip this one',
        confirm: 'Tap again — nothing is owed this time',
        run: () => data.removeBill(b.id),
        done: 'Skipped.'
      });
      actions.push({
        label: 'Stop repeating',
        confirm: 'Tap again — no more of these will come',
        danger: true,
        run: () => data.stopBillSeries(b.id, { seriesId: b.seriesId }),
        done: 'It will not repeat. This one is still here.'
      });
    } else {
      actions.push({
        label: 'Remove bill',
        confirm: 'Tap again to remove',
        danger: true,
        run: () => data.removeBill(b.id),
        done: 'Removed.'
      });
    }

    openEditor({
      title: 'Edit bill',
      fields: fields,
      actions: actions,
      saved: 'Saved.',
      save: async get => {
        const value = Number(get('amount'));
        if (!get('label')) throw new Error('Give it a name.');
        if (!(value > 0)) throw new Error('How much is it?');
        await data.editBill(b.id, {
          label: get('label'),
          amount: value,
          // A disabled input is left out of a form, so read it directly.
          dueOn: dueOn.value,
          scope: get('scope') || 'this'
        }, { seriesId: b.seriesId });
      }
    });
  }

  async function editEvent(ev) {
    const roster = await data.loadMembers();
    const people = roster.members.map(m => ({ value: m.key, label: m.name }));

    const title = input('text', 'title', { required: 'required' });
    title.value = ev.edit.title;
    const subject = select('subject', [{ value: '', label: 'Everyone' }].concat(people));
    subject.value = ev.edit.subject;
    const responsible = select('responsible', [{ value: '', label: 'Nobody' }].concat(people));
    responsible.value = ev.edit.responsible;
    const onDate = input('date', 'onDate', { required: 'required' });
    onDate.value = ev.edit.date;
    const atTime = input('time', 'atTime', { required: 'required' });
    atTime.value = ev.edit.time;

    const fields = [
      field('What', title),
      field('Who it is about', subject),
      field('Who takes them', responsible),
      field('Date', onDate),
      field('Time', atTime)
    ];
    const actions = [];

    if (ev.edit.repeats) {
      const scope = select('scope', [
        { value: 'this', label: 'Just this one' },
        { value: 'forward', label: 'This one and every one after' }
      ]);
      const note = hint('');
      const sync = () => {
        const forward = scope.value === 'forward';
        onDate.disabled = forward;
        note.textContent = forward
          ? 'The day stays with the series. The time and the people change from here on.'
          : 'Only this one changes — the series will leave it as you set it.';
      };
      scope.addEventListener('change', sync);
      fields.push(field('Change', scope), note);
      setTimeout(sync, 0);

      actions.push({
        label: 'Skip this one',
        confirm: 'Tap again — it is not on this time',
        run: () => data.removeEvent(ev.id),
        done: 'Skipped.'
      });
      actions.push({
        label: 'Stop repeating',
        confirm: 'Tap again — no more of these will come',
        danger: true,
        run: () => data.stopEventSeries(ev.id, { seriesId: ev.seriesId }),
        done: 'It will not repeat.'
      });
    } else {
      actions.push({
        label: 'Remove event',
        confirm: 'Tap again to remove',
        danger: true,
        run: () => data.removeEvent(ev.id),
        done: 'Removed.'
      });
    }

    openEditor({
      title: 'Edit event',
      fields: fields,
      actions: actions,
      saved: 'Saved.',
      save: async get => {
        if (!get('title')) throw new Error('Give it a name.');
        if (!atTime.value) throw new Error('What time?');
        await data.editEvent(ev.id, {
          title: get('title'),
          subject: get('subject') || null,
          responsible: get('responsible') || null,
          // Disabled inputs drop out of a form; read the date directly.
          onDate: onDate.value,
          atTime: atTime.value,
          scope: get('scope') || 'this'
        }, { seriesId: ev.seriesId });
      }
    });
  }

  function editExpense(e) {
    const label = input('text', 'label', { required: 'required' });
    label.value = e.edit.label;
    const amount = input('number', 'amount', { min: '1', step: '1', required: 'required' });
    amount.value = String(e.edit.amount);

    const fields = [field('What', label), field('How much', amount)];
    if (e.edit.paidBill) {
      fields.push(hint('This is what paid the ' + e.edit.paidBill + '. Deleting it marks that bill unpaid again.'));
    }

    openEditor({
      title: 'Edit expense',
      fields: fields,
      saved: 'Saved.',
      actions: [{
        label: 'Delete expense',
        confirm: e.edit.paidBill ? 'Tap again — the bill will be unpaid' : 'Tap again to delete',
        danger: true,
        run: () => data.deleteExpense(e.id),
        done: e.edit.paidBill ? 'Deleted. The ' + e.edit.paidBill + ' is unpaid again.' : 'Deleted.'
      }],
      save: async get => {
        const value = Number(get('amount'));
        if (!get('label')) throw new Error('Give it a name.');
        if (!(value > 0)) throw new Error('How much was it?');
        await data.editExpense(e.id, { label: get('label'), amount: value });
      }
    });
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

    if (editing) {
      const message = editing.saved || 'Saved.';
      try {
        await editing.save(get);
      } catch (ex) {
        err.textContent = ex.message || 'That did not work.';
        return;
      }
      closeSheet();
      flash(message, 'good');
      await go(routeFromHash());
      return;
    }

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
      } else if (sheetKind === 'event') {
        if (!get('title')) throw new Error('Give it a name.');
        if (!get('onDate')) throw new Error('What day is it?');
        if (!get('atTime')) throw new Error('What time?');
        await data.createEvent({
          title: get('title'),
          subject: get('subject') || null,
          responsible: get('responsible') || null,
          onDate: get('onDate'),
          atTime: get('atTime'),
          repeats: get('repeats') || 'none'
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
        await data.createBill({
          label: get('label'),
          amount: amount,
          dueOn: get('dueOn'),
          repeats: get('repeats') || 'none'
        });
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
