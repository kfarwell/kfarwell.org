/*
 * A theme is one stylesheet: the link in the head is pointed at another file,
 * the name is written onto <html> for themes.css to read, and both are kept
 * in storage. Loaded in the head so a saved theme is in place before paint.
 * The page hands over the paths, which carry a digest in production.
 */

var themes = JSON.parse(
    document.getElementById("theme-styles").textContent
);

var THEME_KEY = "kfarwell:theme";

/* The dock's light switch, on every page the dock is on. */
function toggleMode() {
    var light = document.documentElement.classList.toggle("light");
    var button = document.getElementById("toggle");
    button.querySelector(".dock-icon").textContent = light ? "🌞" : "🌚";
    button.querySelector(".dock-label").textContent = light ? "Light Mode" : "Dark Mode";
}

/* Found by what it points at, since live reload swaps the head's links for
   fresh ones and an id would not survive. */
function themeLink() {
    var links = document.getElementsByTagName("link");
    var paths = Object.keys(themes).map(function (name) {
        return new URL(themes[name], location.href).pathname;
    });

    for (var i = 0; i < links.length; i += 1) {
        if (links[i].href
                && paths.indexOf(new URL(links[i].href).pathname) !== -1) {
            return links[i];
        }
    }
}

function setTheme(name) {
    var link = themeLink();
    if (!themes[name] || !link) return;

    link.href = themes[name];
    document.documentElement.dataset.theme = name;

    try {
        localStorage.setItem(THEME_KEY, name);
    } catch (error) {
        /* private browsing */
    }
}

function savedTheme() {
    try {
        return localStorage.getItem(THEME_KEY);
    } catch (error) {
        return null;
    }
}

setTheme(savedTheme() || "98");

document.addEventListener("DOMContentLoaded", function () {
    var radio = document.querySelector(
        "#themes-window input[value=\"" + document.documentElement.dataset.theme + "\"]"
    );
    if (radio) radio.checked = true;
});

document.addEventListener("change", function (event) {
    if (event.target.name === "theme") setTheme(event.target.value);
});
