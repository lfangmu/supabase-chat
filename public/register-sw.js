if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').then(function (registration) {
      // Check for updates every 60 minutes
      setInterval(function () {
        registration.update().catch(function () {
          // Update check failed — non-fatal
        });
      }, 60 * 60 * 1000);

      // Handle new service worker activation
      var refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });

      // Listen for new waiting service workers
      registration.addEventListener('updatefound', function () {
        var newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', function () {
            // New service worker is waiting to activate
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // Force activation (skipWaiting is already called in SW install)
              // The controllerchange event will handle the reload
            }
          });
        }
      });
    }).catch(function () {
      // SW registration failed — app still works without SW
    });
  });
}
