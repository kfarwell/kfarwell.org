/*
 * A page of its own, on top of windows.js: closing its window leaves an icon
 * on the desktop that opens it again, and the dock's appearance tile opens
 * the theme picker.
 */

var dock = document.getElementById("dock");
var pageWindow = document.querySelector("#screen > .window[data-anchored]");
var themesWindow = document.getElementById("themes-window");

/* Everything left of the dock. */
function workArea() {
    var dockBox = dock.getBoundingClientRect();
    return {
        left: 0,
        top: 0,
        width: Math.max(minWidth, Math.min(dockBox.left, window.innerWidth)),
        height: Math.max(minHeight, window.innerHeight)
    };
}

function raise(win) {
    win.hidden = false;
    win.style.zIndex = ++frontmost;
    focus(win);
}

document.querySelectorAll(".icon").forEach(function (icon) {
    var win = document.getElementById(icon.dataset.opens);

    win.querySelector("[aria-label=Close]").addEventListener("click", function () {
        icon.hidden = false;
    });

    function reopen() {
        icon.hidden = true;
        icon.classList.remove("selected");
        raise(win);
    }

    icon.addEventListener("dblclick", reopen);
    icon.addEventListener("click", function () {
        if (!desktop.matches) reopen();
    });
    icon.addEventListener("keydown", function (event) {
        if (event.key === "Enter") reopen();
    });
});

document.addEventListener("click", function (event) {
    var icon = event.target.closest(".icon");

    document.querySelectorAll(".icon").forEach(function (other) {
        other.classList.toggle("selected", other === icon);
    });
});

document.getElementById("themes-app").addEventListener("click", function () {
    raise(themesWindow);
});

function matchLayout() {
    windows.forEach(function (managed) {
        managed.maximize.disabled =
            !desktop.matches || managed.element === themesWindow;
        if (!desktop.matches) {
            managed.reset();
        }
    });
}

desktop.addEventListener("change", matchLayout);
matchLayout();
focus(pageWindow);
