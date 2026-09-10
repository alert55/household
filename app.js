(function () {
  'use strict';

  // ── Tabs ───────────────────────────────────────────────
  // One page, four views. The hash is the route: #money shows
  // the money view and lights its tab. Anything unrecognised
  // falls back to home rather than leaving a blank screen.

  var DEFAULT_VIEW = 'home';
  var TITLES = {
    home: 'Home',
    tasks: 'Tasks',
    kitchen: 'Kitchen',
    money: 'Money'
  };

  var views = document.querySelectorAll('.view');
  var tabs = document.querySelectorAll('.tab');

  function routeFromHash() {
    var name = (location.hash || '').replace(/^#\/?/, '');
    return Object.prototype.hasOwnProperty.call(TITLES, name) ? name : DEFAULT_VIEW;
  }

  function show(name) {
    Array.prototype.forEach.call(views, function (view) {
      view.hidden = view.id !== name;
    });

    Array.prototype.forEach.call(tabs, function (tab) {
      var active = tab.getAttribute('data-tab') === name;
      tab.classList.toggle('is-active', active);
      if (active) {
        tab.setAttribute('aria-current', 'page');
      } else {
        tab.removeAttribute('aria-current');
      }
    });

    document.title = TITLES[name] + ' · Household';
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', function () {
    show(routeFromHash());
  });

  show(routeFromHash());

  // ── Today's done count ─────────────────────────────────
  // The board ships with 4 of 10 already done; the two rows
  // shown inline are the remaining ones the design surfaces.

  var DONE_ELSEWHERE = 4;
  var TOTAL = 10;

  var readout = document.getElementById('today-count');
  var boxes = document.querySelectorAll('#home .check');

  if (!readout || !boxes.length) return;

  function sync() {
    var checked = 0;
    Array.prototype.forEach.call(boxes, function (box) {
      if (box.checked) checked++;
    });
    readout.textContent = (DONE_ELSEWHERE + checked) + ' of ' + TOTAL + ' done';
  }

  Array.prototype.forEach.call(boxes, function (box) {
    box.addEventListener('change', sync);
  });

  sync();
})();
