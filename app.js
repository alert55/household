// Keeps the "N of M done" line in step with the checkboxes on the Today card.
// The board ships with 4 of 10 already done; the two rows shown here are the
// remaining ones the design surfaces inline.

(function () {
  'use strict';

  var DONE_ELSEWHERE = 4;
  var TOTAL = 10;

  var readout = document.getElementById('today-count');
  var boxes = document.querySelectorAll('.today .check');

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
