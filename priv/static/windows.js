/*
 * The desktop's windows, on every page that has them: dragged by the title
 * bar, resized from any edge, minimized to the title bar, maximized to the
 * work area, and raised when touched. The page's own script supplies
 * workArea(). A window marked data-anchored is the page itself on a phone,
 * so it stays where the page put it there.
 */

var desktop = window.matchMedia("(min-width: 656px)");

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
        win.style.right = "auto";
        win.style.bottom = "auto";
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
        focus(win);
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
            place(workArea());
        } else if (restore) {
            place(restore);
        } else {
            unplace();
        }
    });

    win.querySelector("[aria-label=Close]").addEventListener("click", function () {
        win.hidden = true;
        focusTop();
    });

    titleBar.addEventListener("pointerdown", function (event) {
        var movable = desktop.matches || !("anchored" in win.dataset);
        if (!movable || maximized) return;
        if (event.target.closest(".title-bar-controls")) return;

        var start = measure();
        place(start);
        drag(event, function (dx, dy) {
            var height = minimized ? titleBar.offsetHeight : start.height;
            place({
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
            place(workArea());
        }
    });

    return {element: win, maximize: maximize, reset: unplace};
}

var windows = [].map.call(document.querySelectorAll("#screen > .window"), manage);

/* Themes mark the front window on the window, the title bar, or both. */
function focus(win) {
    windows.forEach(function (managed) {
        var active = managed.element === win;
        managed.element.classList.toggle("active", active);
        managed.element.querySelector(".title-bar")
            .classList.toggle("inactive", !active);
    });
}

function focusTop() {
    var front = null;
    var height = -1;

    windows.forEach(function (managed) {
        var el = managed.element;
        if (el.hidden) return;

        var z = parseInt(getComputedStyle(el).zIndex, 10) || 0;
        if (z >= height) {
            front = el;
            height = z;
        }
    });

    focus(front);
}
