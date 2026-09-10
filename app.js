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

      const box = document.createElement('input');
      box.className = 'check';
      box.type = 'checkbox';
      box.id = 'occ-' + o.id;
      box.checked = Boolean(o.completed);
      box.addEventListener('change', () => tick(o, box));
      li.appendChild(box);

      const label = el('label', 'task__label', o.title);
      label.setAttribute('for', box.id);
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

  async function tick(occurrence, box) {
    const wanted = box.checked;
    box.disabled = true;
    try {
      await data.setOccurrenceDone(occurrence.id, wanted, occurrence);
      occurrence.completed = wanted;
      await refreshHome();
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
