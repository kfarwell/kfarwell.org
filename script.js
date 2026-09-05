function toggleMode() {
    var light = document.documentElement.classList.toggle("light");
    document.getElementById("toggle").textContent = light ? "🌞" : "🌚";
}

var desktop = window.matchMedia("(min-width: 656px)");
var toasters = document.getElementById("toasters");
var dock = document.getElementById("tamanotchi");
var buttons = document.getElementById("buttons");
var footerBreak = document.getElementById("footer-break");
var dockTiles = document.getElementById("dock");
var toggle = document.getElementById("toggle");
var music = document.getElementById("music");
var musicBody = document.querySelector("#music-window .window-body");
var theEnd = document.getElementById("the-end");

var minWidth = 240;
var minHeight = 120;
var frontmost = 2;  /* the highest z-index so far */

function drag(event, onMove) {
    var handle = event.currentTarget;
    var startX = event.clientX;
    var startY = event.clientY;

    function move(moveEvent) {
        onMove(moveEvent.clientX - startX, moveEvent.clientY - startY);
    }

    function stop() {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
    }

    handle.setPointerCapture(event.pointerId);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
    event.preventDefault();
}

function manage(win) {
    var titleBar = win.querySelector(".title-bar");
    var maximize = win.querySelector("[aria-label=Maximize]");

    var geometry = null;
    var restore = null;
    var minimized = false;
    var maximized = false;

    function measure() {
        var box = win.getBoundingClientRect();
        return {
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height
        };
    }

    function place(rect) {
        geometry = rect;
        win.classList.add("placed");
        win.style.left = rect.left + "px";
        win.style.top = rect.top + "px";
        win.style.width = rect.width + "px";
        win.style.height = minimized ? "auto" : rect.height + "px";
    }

    function unplace() {
        geometry = null;
        restore = null;
        minimized = false;
        maximized = false;
        win.classList.remove("placed", "minimized");
        win.removeAttribute("style");
        maximize.setAttribute("aria-label", "Maximize");
    }

    win.addEventListener("pointerdown", function () {
        win.style.zIndex = ++frontmost;
    }, true);

    win.querySelector("[aria-label=Minimize]").addEventListener("click", function () {
        if (!minimized && !maximized) {
            place(measure());
        }
        minimized = !minimized;
        win.classList.toggle("minimized", minimized);
        if (geometry) {
            place(geometry);
        }
    });

    maximize.addEventListener("click", function () {
        maximized = !maximized;
        maximize.setAttribute("aria-label", maximized ? "Restore" : "Maximize");

        if (maximized) {
            restore = minimized ? null : measure();
            minimized = false;
            win.classList.remove("minimized");
            place({
                left: 0,
                top: 0,
                width: window.innerWidth,
                height: window.innerHeight
            });
        } else if (restore) {
            place(restore);
        } else {
            unplace();
        }
    });

    win.querySelector("[aria-label=Close]").addEventListener("click", function () {
        win.hidden = true;
    });

    titleBar.addEventListener("pointerdown", function (event) {
        if (!desktop.matches || maximized) return;
        if (event.target.closest(".title-bar-controls")) return;

        var start = measure();
        place(start);
        drag(event, function (dx, dy) {
            var height = minimized ? titleBar.offsetHeight : start.height;
            place({
                /* Keep enough of the title bar on screen to grab. */
                left: Math.min(
                    Math.max(dx + start.left, 80 - start.width),
                    window.innerWidth - 80
                ),
                top: Math.min(
                    Math.max(dy + start.top, 0),
                    window.innerHeight - height
                ),
                width: start.width,
                height: start.height
            });
        });
    });

    ["n", "s", "e", "w", "ne", "nw", "se", "sw"].forEach(function (edge) {
        var resizer = document.createElement("div");
        resizer.className = "resizer resizer-" + edge;

        resizer.addEventListener("pointerdown", function (event) {
            if (!desktop.matches || maximized) return;

            minimized = false;
            win.classList.remove("minimized");
            var start = measure();
            place(start);

            drag(event, function (dx, dy) {
                var rect = {
                    left: start.left,
                    top: start.top,
                    width: start.width,
                    height: start.height
                };
                if (edge.indexOf("e") !== -1) {
                    rect.width = Math.max(minWidth, start.width + dx);
                }
                if (edge.indexOf("s") !== -1) {
                    rect.height = Math.max(minHeight, start.height + dy);
                }
                if (edge.indexOf("w") !== -1) {
                    rect.width = Math.max(minWidth, start.width - dx);
                    rect.left = start.left + start.width - rect.width;
                }
                if (edge.indexOf("n") !== -1) {
                    rect.height = Math.max(minHeight, start.height - dy);
                    rect.top = start.top + start.height - rect.height;
                }
                place(rect);
            });
        });

        win.appendChild(resizer);
    });

    window.addEventListener("resize", function () {
        if (maximized) {
            place({
                left: 0,
                top: 0,
                width: window.innerWidth,
                height: window.innerHeight
            });
        }
    });

    return {element: win, maximize: maximize, reset: unplace};
}

var windows = [].map.call(document.querySelectorAll(".window"), manage);

window.addEventListener("blur", function () {
    var focused = document.activeElement;
    if (focused && focused.tagName === "IFRAME") {
        focused.closest(".window").style.zIndex = ++frontmost;
    }
});

function matchLayout() {
    windows.forEach(function (managed) {
        managed.maximize.disabled = !desktop.matches;
        if (!desktop.matches) {
            managed.reset();
        }
    });

    if (desktop.matches) {
        musicBody.appendChild(music);
        dockTiles.appendChild(toggle);
        dockTiles.appendChild(dock);
        document.body.insertBefore(buttons, toasters);
    } else {
        theEnd.parentNode.insertBefore(music, theEnd);
        footerBreak.parentNode.insertBefore(dock, footerBreak);
        footerBreak.parentNode.insertBefore(buttons, footerBreak);
    }
}

desktop.addEventListener("change", matchLayout);
matchLayout();
