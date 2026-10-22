var toasters = document.getElementById("toasters");
var dock = document.getElementById("tamanotchi");
var buttons = document.getElementById("buttons");
var footerBreak = document.getElementById("footer-break");
var dockTiles = document.getElementById("dock");
var toggle = document.getElementById("toggle");
var music = document.getElementById("music");
var testimonials = document.getElementById("testimonials");
var friends = document.getElementById("friends");
var webampHost = document.getElementById("webamp-host");
var catclockWindow = document.getElementById("catclock-window");
var kfarwellWindow = document.getElementById("kfarwell-window");
var iconArea = document.getElementById("icons");
var kyleApp = document.getElementById("kyle-app");
var themesApp = document.getElementById("themes-app");
var themesWindow = document.getElementById("themes-window");

document.getElementById("credits-window")
    .querySelector(".window-body")
    .appendChild(document.getElementById("credits"));

var files = [
    {section: testimonials, window: document.getElementById("testimonials-window")},
    {section: friends, window: document.getElementById("friends-window")}
];
var theEnd = document.getElementById("the-end");
var chatWindow = document.getElementById("chat-window");

function workArea() {
    var dockBox = dockTiles.getBoundingClientRect();
    var badgeBox = buttons.getBoundingClientRect();
    return {
        left: 0,
        top: 0,
        width: Math.max(minWidth, Math.min(dockBox.left, window.innerWidth)),
        height: Math.max(minHeight, Math.min(badgeBox.top, window.innerHeight))
    };
}

window.addEventListener("blur", function () {
    var focused = document.activeElement;
    if (focused && focused.tagName === "IFRAME") {
        focused.closest(".window").style.zIndex = ++frontmost;
    }
});

var chatClosed = false;

chatWindow.querySelector("[aria-label=Close]").addEventListener("click", function () {
    chatClosed = true;
});

webampHost.addEventListener("pointerdown", function () {
    webampHost.style.zIndex = ++frontmost;
}, true);

document.addEventListener("click", function (event) {
    var icon = event.target.closest(".icon");

    document.querySelectorAll(".icon").forEach(function (other) {
        other.classList.toggle("selected", other === icon);
    });
});

var gridX = 76;
var gridY = 64;
var gridOrigin = null;

function grid() {
    if (!gridOrigin) {
        var box = document.querySelector(".icon").getBoundingClientRect();
        gridOrigin = {x: box.left, y: box.top};
    }
    return gridOrigin;
}

function snap(value, origin, step, limit) {
    var snapped = origin + Math.round((value - origin) / step) * step;

    if (limit < step) return Math.min(Math.max(value, 0), limit);
    while (snapped > limit) snapped -= step;
    while (snapped < 0) snapped += step;
    return snapped;
}

function dropIcons() {
    grid();
    document.querySelectorAll(".icon").forEach(function (icon) {
        if (icon.classList.contains("dropped")) return;

        var box = icon.getBoundingClientRect();
        icon.style.left = box.left + "px";
        icon.style.top = box.top + "px";
        icon.classList.add("dropped");
    });
}

document.querySelectorAll(".icon").forEach(function (icon) {
    var win = document.getElementById(icon.dataset.opens);

    function open() {
        if (icon.dataset.launch) {
            document.dispatchEvent(new CustomEvent("launch:" + icon.dataset.launch));
            return;
        }
        win.hidden = false;
        win.style.zIndex = ++frontmost;
        focus(win);
    }

    icon.addEventListener("dblclick", open);
    icon.addEventListener("click", function () {
        if (!desktop.matches) open();
    });
    icon.addEventListener("keydown", function (event) {
        if (event.key === "Enter") open();
    });

    icon.addEventListener("pointerdown", function (event) {
        if (!desktop.matches || event.button !== 0) return;

        var startX = event.clientX;
        var startY = event.clientY;
        var origin = null;

        function move(moveEvent) {
            var dx = moveEvent.clientX - startX;
            var dy = moveEvent.clientY - startY;

            if (!origin) {
                if (Math.abs(dx) + Math.abs(dy) < 4) return;
                dropIcons();
                origin = {
                    left: parseFloat(icon.style.left),
                    top: parseFloat(icon.style.top)
                };
                icon.setPointerCapture(moveEvent.pointerId);
            }

            icon.style.left = Math.min(
                Math.max(origin.left + dx, 0),
                window.innerWidth - icon.offsetWidth
            ) + "px";
            icon.style.top = Math.min(
                Math.max(origin.top + dy, 0),
                window.innerHeight - icon.offsetHeight
            ) + "px";
        }

        function stop() {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
            window.removeEventListener("pointercancel", stop);

            if (!origin) return;
            icon.style.left = snap(parseFloat(icon.style.left), grid().x,
                gridX, window.innerWidth - icon.offsetWidth) + "px";
            icon.style.top = snap(parseFloat(icon.style.top), grid().y,
                gridY, window.innerHeight - icon.offsetHeight) + "px";
        }

        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
        window.addEventListener("pointercancel", stop);
    });
});

function updateIcons() {
    var bare = kfarwellWindow.hidden
        || kfarwellWindow.classList.contains("minimized");
    iconArea.style.display = (desktop.matches || bare) ? "" : "none";
    kyleApp.hidden = !kfarwellWindow.hidden;
}

kyleApp.addEventListener("click", function () {
    kfarwellWindow.hidden = false;
    kfarwellWindow.style.zIndex = ++frontmost;
    focus(kfarwellWindow);
});

themesApp.addEventListener("click", function () {
    themesWindow.hidden = false;
    themesWindow.style.zIndex = ++frontmost;
    focus(themesWindow);
});

new MutationObserver(updateIcons).observe(kfarwellWindow, {
    attributes: true,
    attributeFilter: ["class", "hidden"]
});

var fixedSize = ["catclock-window", "themes-window"];

function matchLayout() {
    windows.forEach(function (managed) {
        managed.maximize.disabled =
            !desktop.matches || fixedSize.indexOf(managed.element.id) !== -1;
        if (!desktop.matches) {
            managed.reset();
        }
    });

    catclockWindow.hidden = !desktop.matches;
    if (!chatClosed) {
        chatWindow.hidden = !desktop.matches;
    }
    updateIcons();

    if (desktop.matches) {
        files.forEach(function (file) {
            file.window.querySelector(".window-body").appendChild(file.section);
        });
        dockTiles.appendChild(toggle);
        dockTiles.appendChild(themesApp);
        dockTiles.appendChild(dock);
        dockTiles.appendChild(kyleApp);
        document.body.insertBefore(buttons, toasters);
    } else {
        gridOrigin = null;
        document.querySelectorAll(".icon.dropped").forEach(function (icon) {
            icon.classList.remove("dropped");
            icon.removeAttribute("style");
        });
        music.parentNode.insertBefore(testimonials, music);
        music.parentNode.insertBefore(friends, music);
        footerBreak.parentNode.insertBefore(dock, footerBreak);
        footerBreak.parentNode.insertBefore(buttons, footerBreak);
    }
}

desktop.addEventListener("change", matchLayout);
matchLayout();
focus(kfarwellWindow);
