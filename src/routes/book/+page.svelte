<svelte:head>
  <title>book | angel's rest</title>
  <!-- Cal element-click embed code begins -->
  <script type="text/javascript">
    (function (C, A, L) {
      let p = function (a, ar) {
        a.q.push(ar);
      };
      let d = C.document;
      C.Cal =
        C.Cal ||
        function () {
          let cal = C.Cal;
          let ar = arguments;
          if (!cal.loaded) {
            cal.ns = {};
            cal.q = cal.q || [];
            d.head.appendChild(d.createElement("script")).src = A;
            cal.loaded = true;
          }
          if (ar[0] === L) {
            const api = function () {
              p(api, arguments);
            };
            const namespace = ar[1];
            api.q = api.q || [];
            if (typeof namespace === "string") {
              cal.ns[namespace] = cal.ns[namespace] || api;
              p(cal.ns[namespace], ar);
              p(cal, ["initNamespace", namespace]);
            } else p(cal, ar);
            return;
          }
          p(cal, ar);
        };
    })(window, "https://app.cal.com/embed/embed.js", "init");

    Cal("init", "photosession", { origin: "https://app.cal.com" });

    // Your config object
    const calConfig = {
      hideEventTypeDetails: false,
      layout: "month_view",
      useSlotsViewOnSmallScreen: true,
    };

    Cal.ns.photosession("ui", calConfig);
  </script>
  <!-- Cal element-click embed code ends -->
</svelte:head>

<section class="flex flex-col items-center justify-center min-h-[70vh] gap-6">
  <h1 class="text-3xl font-extralight tracking-wider lowercase">
    book a session
  </h1>
  <p class="text-surface-400 text-sm tracking-wider lowercase">
    select a date and time that works for you
  </p>

  <button
    type="button"
    class="px-4 py-2 text-sm tracking-wider lowercase font-light text-surface-50 bg-surface-500 rounded-md"
    data-cal-link="jesse-s1wmio/photosession"
    data-cal-namespace="photosession"
    data-cal-config={JSON.stringify(calConfig)}
  >
    click here
  </button>
</section>
