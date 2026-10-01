/* QymLive: one poller for pages that follow data while it changes (C039).

   QymLive.poll(loader, {intervalMs, maxIntervalMs, onError}) calls `loader`
   every intervalMs while the tab is visible:
   - a hidden tab is not polled; it is polled again as soon as it is shown;
   - a failed call backs off (doubling up to maxIntervalMs) and recovers on
     the next success;
   - the loader returns false to stop, or a number of ms for the next delay;
   - in-app navigation (qym:before-navigate) stops it.
   Returns {stop(), now()}: now() polls at once (when not already polling).

   Loaded again by the shell on in-app navigation: it keeps the first copy. */
(function () {
  'use strict';
  if (window.QymLive) return;

  function poll(loader, options) {
    var opts = options || {};
    var intervalMs = Math.max(250, Number(opts.intervalMs) || 3000);
    var maxIntervalMs = Math.max(intervalMs, Number(opts.maxIntervalMs) || 30000);
    var timer = null;
    var running = false;
    var stopped = false;
    var failures = 0;

    function schedule(ms) {
      clearTimeout(timer);
      timer = stopped ? null : setTimeout(tick, ms);
    }

    function tick() {
      timer = null;
      if (stopped || running) return;
      // Hidden: wait for visibilitychange instead of polling in the background.
      if (document.hidden) return;
      running = true;
      var delay = intervalMs;
      Promise.resolve()
        .then(loader)
        .then(function (result) {
          failures = 0;
          if (result === false) stop();
          else if (typeof result === 'number' && result > 0) delay = result;
        }, function (error) {
          failures += 1;
          delay = Math.min(maxIntervalMs, intervalMs * Math.pow(2, failures));
          if (typeof opts.onError === 'function') {
            try { opts.onError(error, failures); } catch (ignored) { /* reporting only */ }
          }
        })
        .then(function () {
          running = false;
          if (!stopped) schedule(delay);
        });
    }

    function onVisibility() {
      if (!document.hidden && !stopped && !running) {
        clearTimeout(timer);
        tick();
      }
    }

    function stop() {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      timer = null;
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('qym:before-navigate', stop);
    }

    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('qym:before-navigate', stop);
    schedule(opts.immediate ? 0 : intervalMs);

    return {
      stop: stop,
      now: function () {
        if (stopped || running) return;
        clearTimeout(timer);
        tick();
      },
      isStopped: function () { return stopped; },
    };
  }

  window.QymLive = { poll: poll };
})();
