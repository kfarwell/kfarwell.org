/**
 * Plan 9 catclock, based on sys/src/games/catclock.c
 * Copyright 1985 Massachusetts Institute of Technology
 */
(function () {
    var CATWID = 150;      /* width of body bitmap */
    var CATHGT = 300;      /* height of body bitmap */
    var TAILWID = 150;     /* width of tail bitmap */
    var TAILHGT = 89;      /* height of tail bitmap */
    var MINULEN = 27;      /* length of minute hand */
    var HOURLEN = 15;      /* length of hour hand */
    var HANDWID = 4;       /* width of clock hands */
    var NTAIL = 16;
    var UPDATE = 1000 / NTAIL;   /* tail waves at roughly 1/2 hz */

    var tp = [             /* tail polygon */
        [0, 0], [0, 76], [3, 82], [10, 84], [18, 82], [21, 76], [21, 70]
    ];
    var toffs = [74, -15];      /* tail polygon offset */
    var tailoffs = [0, 211];    /* tail bitmap offset, relative to body */
    var eyeoffs = [49, 30];     /* eye bitmap offset, relative to body */
    var catoffs = [0, 0];       /* body, relative to canvas */

    var canvas = document.getElementById("catclock");
    if (!canvas) return;
    var win = document.getElementById("catclock-window");
    var timer = 0;

    canvas.width = CATWID;
    canvas.height = CATHGT;

    var ctx = canvas.getContext("2d", {willReadFrequently: true});
    var body = new Image();
    var eyes = new Image();
    var loaded = 0;
    var t = 0;
    var dt = 1;

    function polygon(points) {
        ctx.beginPath();
        ctx.moveTo(points[0][0], points[0][1]);
        for (var i = 1; i < points.length; i++) {
            ctx.lineTo(points[i][0], points[i][1]);
        }
        ctx.closePath();
    }

    function round(x) {
        return x >= 0 ? Math.round(x) : -Math.round(-x);
    }

    /* Draw a clock hand, theta is clockwise angle from noon. */
    function drawhand(length, width, theta) {
        var c = Math.cos(theta), s = Math.sin(theta);
        var ws = width * s, wc = width * c;

        polygon([
            [catoffs[0] + CATWID / 2 + round(length * s),
             catoffs[1] + CATHGT / 2 - round(length * c)],
            [catoffs[0] + CATWID / 2 - round(ws + wc),
             catoffs[1] + CATHGT / 2 + round(wc - ws)],
            [catoffs[0] + CATWID / 2 - round(ws - wc),
             catoffs[1] + CATHGT / 2 + round(wc + ws)]
        ]);
        ctx.fillStyle = "#fff";
        ctx.fill("evenodd");
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 1;
        ctx.stroke();
    }

    /* Draw the cat's tail, t is time (mod 1 second). */
    function drawtail(time) {
        /* an assymetric tail leans to one side */
        var theta = 0.4 * Math.sin(time + 3 * Math.PI / 2) - 0.08;
        var s = Math.sin(theta), c = Math.cos(theta);
        var origin = [catoffs[0] + tailoffs[0], catoffs[1] + tailoffs[1]];

        /* The tail's bitmap is opaque: it blanks the panel it sits on. */
        ctx.clearRect(origin[0], origin[1], TAILWID, TAILHGT);

        polygon(tp.map(function (p) {
            return [origin[0] + p[0] * c + p[1] * s + toffs[0],
                    origin[1] - p[0] * s + p[1] * c + toffs[1]];
        }));
        ctx.fillStyle = "#000";
        ctx.fill("evenodd");
    }

    /* Draw the cat's eyes, t is time (mod 1 second). */
    function draweye(time) {
        /* direction eyes point */
        var angle = 0.7 * Math.sin(time + 3 * Math.PI / 2) + Math.PI / 2;
        var origin = [catoffs[0] + eyeoffs[0], catoffs[1] + eyeoffs[1]];
        var pupil = [];
        var u, x, y, z;

        ctx.drawImage(eyes, origin[0], origin[1]);

        for (u = -Math.PI / 2; u < Math.PI / 2; u += 0.25) {
            x = Math.cos(u) * Math.cos(angle + Math.PI / 7);
            y = Math.sin(u);
            z = 2 + Math.cos(u) * Math.sin(angle + Math.PI / 7);
            pupil.push([(z === 0 ? x : x / z) * 23 + 12,
                        (z === 0 ? y : y / z) * 23 + 11]);
        }
        for (u = Math.PI / 2; u > -Math.PI / 2; u -= 0.25) {
            x = Math.cos(u) * Math.cos(angle - Math.PI / 7);
            y = Math.sin(u);
            z = 2 + Math.cos(u) * Math.sin(angle - Math.PI / 7);
            pupil.push([(z === 0 ? x : x / z) * 23 + 12,
                        (z === 0 ? y : y / z) * 23 + 11]);
        }

        ctx.fillStyle = "#000";
        [0, 31].forEach(function (dx) {
            polygon(pupil.map(function (p) {
                return [origin[0] + p[0] + dx, origin[1] + p[1]];
            }));
            ctx.fill("evenodd");
        });
    }

    /* Plan 9 draws into a 1-bit image, which has no antialiasing to it.
       Rounding every pixel back to black or white -- or, where the cat
       isn't, to nothing at all -- gets the same edges. */
    function flatten() {
        var image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        var px = image.data;

        for (var i = 0; i < px.length; i += 4) {
            if (px[i + 3] < 128) {
                px[i + 3] = 0;
                continue;
            }
            var v = px[i] + px[i + 1] + px[i + 2] < 3 * 128 ? 0 : 255;
            px[i] = px[i + 1] = px[i + 2] = v;
            px[i + 3] = 255;
        }
        ctx.putImageData(image, 0, 0);
    }

    function drawclock() {
        var now = new Date();
        var hour = now.getHours() % 12;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(body, catoffs[0], catoffs[1]);
        drawhand(MINULEN, HANDWID, 2 * Math.PI * now.getMinutes() / 60);
        drawhand(HOURLEN, HANDWID,
                 2 * Math.PI * (hour + now.getMinutes() / 60) / 12);
        drawtail(t * Math.PI / NTAIL);
        draweye(t * Math.PI / NTAIL);
        flatten();

        t += dt;
        if (t < 0 || t > NTAIL) {
            t -= 2 * dt;
            dt = -dt;
        }
    }

    function sync() {
        var up = !win || !win.hidden;
        if (up && !timer && loaded === 2) {
            drawclock();
            timer = setInterval(drawclock, UPDATE);
        } else if (!up && timer) {
            clearInterval(timer);
            timer = 0;
        }
    }

    function start() {
        loaded++;
        sync();
    }

    if (win) {
        new MutationObserver(sync).observe(win, {
            attributes: true,
            attributeFilter: ["hidden"]
        });
    }

    body.onload = start;
    eyes.onload = start;
    body.src = "catclock-body.png";
    eyes.src = "catclock-eyes.png";
})();
