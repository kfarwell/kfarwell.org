/*
 * A theme is one stylesheet: the link in the head is pointed at another file,
 * the name is written onto <html> for themes.css to read, and both are kept
 * in storage. Loaded in the head so a saved theme is in place before paint.
 */

var themes = {
    "98": "/98.css",
    xp: "/themes/xp/XP.css",
    "7": "/themes/7/7.css",
    system: "/themes/system/system.css",
    classic: "/themes/classic/base.css",
    motif: "/themes/motif/motif.css",
    cs16: "/themes/cs16/cs16.css"
};

var THEME_KEY = "kfarwell:theme";

/* Found by what it points at, since live reload swaps the head's links for
   fresh ones and an id would not survive. */
function themeLink() {
    var links = document.getElementsByTagName("link");
    var paths = Object.keys(themes).map(function (name) {
        return themes[name];
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
