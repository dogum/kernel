/* ===== mobile UI controller (variant only) ===== */
/* ===== KERNEL·A mobile UI controller (variant only) =====
   Injected INSIDE the main IIFE, so it can drive the private
   panel state (ui / applyUI / saveUI) directly. Desktop layout
   is untouched: everything here is gated on the phone breakpoint. */
(function mobileUI() {
  var mq = window.matchMedia("(max-width:760px)");
  var PAN = [
    ["agent", "#agentPanel"],
    ["left", "#leftPanel"],
    ["right", "#rightPanel"],
  ];
  function el(s) {
    return document.querySelector(s);
  }
  function openNow() {
    return PAN.filter(function (p) {
      var e = el(p[1]);
      return e && e.classList.contains("open");
    }).map(function (p) {
      return p[0];
    });
  }

  /* ----- backdrop ----- */
  var scrim = document.createElement("div");
  scrim.id = "mob-scrim";
  document.body.appendChild(scrim);
  scrim.addEventListener("click", closeAll);
  function refreshScrim() {
    scrim.classList.toggle("on", mq.matches && openNow().length > 0);
  }

  function closeAll() {
    ui.agent = false;
    ui.left = false;
    ui.right = false;
    applyUI();
    saveUI();
  }

  /* ----- open one sheet, close the others (toggles if already open) ----- */
  function only(which) {
    var wasOpen = !!ui[which];
    ui.agent = false;
    ui.left = false;
    ui.right = false;
    if (!wasOpen) ui[which] = true;
    applyUI();
    saveUI();
    if (ui.left) {
      try {
        renderLibrary();
      } catch (e) {}
      try {
        renderDataList();
      } catch (e) {}
    }
    if (ui.right) {
      try {
        refreshInspector();
      } catch (e) {}
    }
    if (ui.agent) {
      var a = el("#agIn");
      if (a)
        setTimeout(function () {
          try {
            a.focus();
          } catch (e) {}
        }, 70);
    }
  }

  /* ----- enforce single-open on mobile (covers ⌘J, nbTitle pill, +Data, etc.) ----- */
  var guard = false,
    prev = new Set(openNow());
  var obs = new MutationObserver(function () {
    if (guard) return;
    if (!mq.matches) {
      prev = new Set(openNow());
      refreshScrim();
      syncBar();
      return;
    }
    var now = openNow();
    if (now.length > 1) {
      var newly = null;
      for (var i = 0; i < now.length; i++) {
        if (!prev.has(now[i])) {
          newly = now[i];
          break;
        }
      }
      if (!newly) newly = now[now.length - 1];
      guard = true;
      if (newly !== "agent") ui.agent = false;
      if (newly !== "left") ui.left = false;
      if (newly !== "right") ui.right = false;
      applyUI();
      saveUI();
      guard = false;
    }
    prev = new Set(openNow());
    refreshScrim();
    syncBar();
  });
  PAN.forEach(function (p) {
    var e = el(p[1]);
    if (e) obs.observe(e, { attributes: true, attributeFilter: ["class"] });
  });

  /* ----- grab handle on each sheet: drag down to dismiss ----- */
  PAN.forEach(function (p) {
    var panel = el(p[1]);
    if (!panel) return;
    var g = document.createElement("div");
    g.className = "ms-grab";
    g.setAttribute("aria-hidden", "true");
    panel.insertBefore(g, panel.firstChild);
    var startY = 0,
      dy = 0,
      dragging = false,
      H = 0;
    function down(y) {
      if (!mq.matches) return;
      dragging = true;
      startY = y;
      dy = 0;
      H = panel.getBoundingClientRect().height || 1;
      panel.style.transition = "none";
    }
    function move(y) {
      if (!dragging) return;
      dy = Math.max(0, y - startY);
      panel.style.transform = "translateY(" + dy + "px)";
    }
    function up() {
      if (!dragging) return;
      dragging = false;
      panel.style.transition = "";
      if (dy > H * 0.28) {
        ui[p[0]] = false;
        applyUI();
        saveUI();
      }
      panel.style.transform = "";
    }
    g.addEventListener(
      "touchstart",
      function (e) {
        down(e.touches[0].clientY);
      },
      { passive: true },
    );
    g.addEventListener(
      "touchmove",
      function (e) {
        move(e.touches[0].clientY);
      },
      { passive: true },
    );
    g.addEventListener("touchend", up);
    g.addEventListener("touchcancel", up);
    g.addEventListener("mousedown", function (e) {
      down(e.clientY);
      function mm(ev) {
        move(ev.clientY);
      }
      function mu() {
        up();
        document.removeEventListener("mousemove", mm);
        document.removeEventListener("mouseup", mu);
      }
      document.addEventListener("mousemove", mm);
      document.addEventListener("mouseup", mu);
    });
  });

  /* ----- bottom navigation bar ----- */
  var ICON = {
    files:
      '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    run: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>',
    agent: '<svg viewBox="0 0 24 24"><path d="M12 3l2.1 4.7L19 10l-4.9 2.3L12 17l-2.1-4.7L5 10l4.9-2.3z"/></svg>',
    vars: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h10"/></svg>',
  };
  var bar = document.createElement("nav");
  bar.id = "mob-bar";
  bar.setAttribute("aria-label", "Mobile navigation");
  bar.innerHTML =
    '<button class="mb-btn" data-k="left"><span class="mb-ic">' +
    ICON.files +
    "</span>Files</button>" +
    '<button class="mb-btn" data-k="run"><span class="mb-ic">' +
    ICON.run +
    "</span>Run all</button>" +
    '<button class="mb-btn prime" data-k="agent"><span class="mb-ic">' +
    ICON.agent +
    "</span>Agent</button>" +
    '<button class="mb-btn" data-k="vars"><span class="mb-ic">' +
    ICON.vars +
    "</span>Vars</button>";
  document.body.appendChild(bar);
  bar.addEventListener("click", function (e) {
    var b = e.target.closest(".mb-btn");
    if (!b) return;
    var k = b.dataset.k;
    if (k === "run") {
      // lit while the run lasts, then back to normal
      b.classList.add("active");
      Promise.resolve(runAll()).finally(function () {
        b.classList.remove("active");
      });
      return;
    }
    only(k);
  });
  function syncBar() {
    var o = openNow();
    var btns = bar.querySelectorAll(".mb-btn");
    for (var i = 0; i < btns.length; i++) {
      var k = btns[i].dataset.k;
      if (k === "run") continue;
      btns[i].classList.toggle("active", o.indexOf(k) >= 0);
    }
  }

  /* ----- normalize when entering mobile / on breakpoint change ----- */
  function normalize() {
    if (mq.matches) {
      var o = openNow();
      if (o.length > 1) {
        var keep = o.indexOf("agent") >= 0 ? "agent" : o[0];
        guard = true;
        ui.agent = keep === "agent";
        ui.left = keep === "left";
        ui.right = keep === "right";
        applyUI();
        saveUI();
        guard = false;
      }
    } else {
      PAN.forEach(function (p) {
        var e = el(p[1]);
        if (e) {
          e.style.transform = "";
          e.style.transition = "";
        }
      });
    }
    refreshScrim();
    syncBar();
  }
  if (mq.addEventListener) mq.addEventListener("change", normalize);
  else if (mq.addListener) mq.addListener(normalize);
  normalize();

  /* keyboard hints don't apply on a phone */
  var agIn = el("#agIn");
  if (agIn && mq.matches) agIn.placeholder = agIn.placeholder.replace(/\s*\(⌘J\)$/, "");

  window.__kaMobile = { normalize: normalize, only: only, closeAll: closeAll };
})();
