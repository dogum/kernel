(function () {
  var SUITE = [
    ["kernel.html", "KERNEL", "The notebook, no agent"],
    ["kernel-agent.html", "KERNEL·A", "Notebook with an AI agent"],
    ["kernel-agent-mobile.html", "KERNEL·M", "The agent, built for phones"],
  ];
  var here = decodeURIComponent(location.pathname.split("/").pop() || "");
  var cur = SUITE.findIndex(function (t) {
    return t[0] === here;
  });
  var mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
  var btn = document.getElementById("suiteBtn"),
    menu = document.getElementById("suiteMenu");
  if (!btn || !menu) return;
  function hint(k) {
    return (mac ? "⌥" : "Alt+") + k;
  }
  function isOpen() {
    return menu.classList.contains("open");
  }
  function flipTheme() {
    var t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    try {
      localStorage.setItem("ut-theme", t);
    } catch (e) {}
    document.documentElement.dataset.theme = t;
    try {
      window.dispatchEvent(new CustomEvent("ut-theme", { detail: t }));
    } catch (e) {}
    if (isOpen()) paint("theme");
  }
  function paint(focusKey) {
    menu.innerHTML =
      '<div class="sm-label">KERNEL apps</div>' +
      SUITE.map(function (t, i) {
        return i === cur
          ? '<button type="button" class="sm-item cur" role="menuitem" aria-current="page" data-sm="close"><b>' +
              t[1] +
              "</b><span>" +
              t[2] +
              '</span><i aria-hidden="true">✓</i></button>'
          : '<a class="sm-item" role="menuitem" href="' + t[0] + '"><b>' + t[1] + "</b><span>" + t[2] + "</span></a>";
      }).join("") +
      '<div class="sm-sep" role="separator"></div>' +
      '<a class="sm-item sm-util" role="menuitem" href="index.html"><span>Project page</span><kbd>' +
      hint("I") +
      "</kbd></a>" +
      '<button type="button" class="sm-item sm-util" role="menuitem" data-sm="theme"><span>' +
      (document.documentElement.dataset.theme === "dark" ? "Light theme" : "Dark theme") +
      "</span><kbd>" +
      hint("T") +
      "</kbd></button>";
    if (focusKey) {
      var f = menu.querySelector('[data-sm="' + focusKey + '"]');
      if (f) f.focus();
    }
  }
  function items() {
    return [].slice.call(menu.querySelectorAll(".sm-item"));
  }
  function place() {
    var r = btn.getBoundingClientRect();
    menu.style.top = Math.round(r.bottom + 8) + "px";
    menu.style.left = Math.round(Math.max(8, Math.min(r.left - 6, innerWidth - menu.offsetWidth - 8))) + "px";
  }
  function open() {
    paint();
    menu.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    place();
    var it = items(),
      f =
        it.filter(function (x) {
          return !x.classList.contains("cur");
        })[0] || it[0];
    if (f) f.focus();
  }
  function close(refocus) {
    if (!isOpen()) return;
    menu.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
    if (refocus) btn.focus();
  }
  function step(d) {
    var i = cur >= 0 ? (cur + d + SUITE.length) % SUITE.length : 0;
    location.href = SUITE[i][0];
  }
  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    isOpen() ? close() : open();
  });
  menu.addEventListener("click", function (e) {
    var it = e.target.closest("[data-sm]");
    if (!it) return;
    if (it.getAttribute("data-sm") === "theme") flipTheme();
    else close(true);
  });
  menu.addEventListener("keydown", function (e) {
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    e.stopPropagation(); /* keep notebook shortcuts (j/k, arrows, Enter, d d…) out of the menu */
    var it = items(),
      i = it.indexOf(document.activeElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      it[(i + 1) % it.length].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      it[(i - 1 + it.length) % it.length].focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      it[0].focus();
    } else if (e.key === "End") {
      e.preventDefault();
      it[it.length - 1].focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") {
      close();
    }
  });
  document.addEventListener(
    "pointerdown",
    function (e) {
      if (isOpen() && !menu.contains(e.target) && !btn.contains(e.target)) close();
    },
    true,
  );
  addEventListener("resize", function () {
    close();
  });
  addEventListener("keydown", function (e) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.code === "KeyK") {
      e.preventDefault();
      isOpen() ? close(true) : open();
    } else if (e.code === "KeyI") {
      e.preventDefault();
      location.href = "index.html";
    } else if (e.code === "KeyT") {
      e.preventDefault();
      flipTheme();
    } else if (e.code === "BracketLeft") {
      e.preventDefault();
      step(-1);
    } else if (e.code === "BracketRight") {
      e.preventDefault();
      step(1);
    }
  });
})();
