/*
 * Flying Toasters, across as many windows of the site as are open.
 *
 * toasters.css deals the flock in percentages of the window and starts it
 * flying at load, so every window gets its own. This hangs the same flock on
 * the screen instead -- each start a fraction of the desktop, offset by where
 * the window sits -- and winds each animation to where the wall clock says it
 * should be. Nothing is shared between the windows and nothing needs to be:
 * same clock, same screen, same answer. Without this the CSS still flies them,
 * one flock to a window.
 */
(function () {
    "use strict";

    var SIZE = 64;              /* a toaster, px; toasters.css agrees */
    var WATCH = 500;            /* how often we look to see if the window moved */

    var flock = null;
    var spots = [];             /* where each one starts, as a fraction of the screen */
    var at = null;              /* where the window was when we last placed them */

    /* The viewport in screen px, taking the chrome to be along the top with an
       even border either side. Nothing reports this directly. */
    function myRect() {
        var border = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
        return {
            x: window.screenX + border,
            y: window.screenY + (window.outerHeight - window.innerHeight) - border,
            w: window.innerWidth,
            h: window.innerHeight
        };
    }

    function desk() {
        return {
            x: screen.availLeft || 0,
            y: screen.availTop || 0,
            w: screen.availWidth || screen.width,
            h: screen.availHeight || screen.height
        };
    }

    /* The percentages the stylesheet asked for, read back off the computed
       values, which are already resolved against this window. */
    function measure(el, vp) {
        var css = window.getComputedStyle(el);
        return {
            r: parseFloat(css.right) / vp.w,    /* the edge the flock is dealt from */
            t: parseFloat(css.top) / vp.h
        };
    }

    function place() {
        var vp = myRect();
        var d = desk();
        for (var i = 0; i < flock.length; i++) {
            if (!spots[i]) spots[i] = measure(flock[i], vp);
            var sx = d.x + d.w - spots[i].r * d.w - SIZE;
            var sy = d.y + spots[i].t * d.h;
            flock[i].style.right = "auto";
            flock[i].style.left = Math.round(sx - vp.x) + "px";
            flock[i].style.top = Math.round(sy - vp.y) + "px";
        }
        at = vp;
    }

    /* Where in its cycle an animation should be. The delay is what spaces the
       flock out, so it comes off before the wrapping and goes back on after. */
    function wind(el) {
        var anims = el.getAnimations ? el.getAnimations() : [];
        var wall = Date.now();
        for (var i = 0; i < anims.length; i++) {
            var t = anims[i].effect.getTiming();
            var dur = t.duration;
            var delay = t.delay || 0;
            if (!dur || !isFinite(dur)) continue;
            /* one flap out and back is two runs of an alternating animation */
            var period = String(t.direction).indexOf("alternate") === 0 ? dur * 2 : dur;
            var phase = (wall - delay) % period;
            if (phase < 0) phase += period;
            try { anims[i].currentTime = delay + phase; } catch (err) { /* not running */ }
        }
    }

    function watch() {
        var vp = myRect();
        if (at && vp.x === at.x && vp.y === at.y && vp.w === at.w && vp.h === at.h) {
            return;
        }
        place();
    }

    function start() {
        var box = document.getElementById("toasters");
        if (!box) return;
        flock = [].slice.call(box.children);
        if (!flock.length) return;

        place();
        flock.forEach(wind);

        window.addEventListener("resize", place);
        /* a window can be dragged across the screen without saying so */
        setInterval(watch, WATCH);
        document.addEventListener("visibilitychange", function () {
            if (!document.hidden) flock.forEach(wind);
        });
    }

    if (document.readyState === "complete") start();
    else window.addEventListener("load", start);
}());
