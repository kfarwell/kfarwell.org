/*
 * Karin, the desktop pet.
 *
 * karin/app.js is the avatar viewer: it renders the rig into a canvas and
 * exposes window.KarinSlime. It has no idea where it sits on a page, so this
 * file owns the rest -- the small fixed box she is drawn in, where that box is,
 * the walk cycle, the look-at, and the drag physics.
 *
 * She stands on the row of 88x31 badges, or on the top edge of a window she
 * has been dropped onto. When the pointer has been still for a moment she walks
 * towards it until she is under it or has run out of floor, then stands and
 * watches it; left alone for long enough she goes and sits against Winamp. Grab
 * her and she follows the cursor on a spring; let go and she falls.
 *
 * One Karin per device, not per window: the windows elect an owner over a
 * BroadcastChannel, and she is handed between them in mid-air.
 */
(function () {
    "use strict";

    /* How big she is. Everything measured in px scales with her, so the gait and
       the fall keep their timing instead of turning into slow motion: lengths go
       up by SCALE, and so do the accelerations that move her over them. */
    var SCALE = 2;

    var BOX_W = 260 * SCALE;    /* wide enough that swinging does not clip her */
    var BOX_H = 280 * SCALE;

    var LONG_PRESS = 450;       /* touch held this long opens her menu */

    var SIT_AFTER = 20000;      /* idle this long and she goes and sits down */
    var SIT_ARRIVE = 4;         /* she has to be this close before she can sit */
    var SIT_BLEND = 0.9;        /* seconds to stand up or settle down */
    var SIT_CROUCH = 0.35;      /* where the crouch key sits along that blend */
    var SIT_TUCK = 0.72;        /* ...and where she is down with her knees up */
    var SIT_REACH = 0.87;       /* ...and where her knees have straightened out */
    var SIT_YAW = -68;          /* turned side-on, back to the window */
    var SIT_OFFSET = 288;       /* ...and how far left of it she sits. A fixed
                                   px offset, not her measured width, which
                                   changes between standing and sitting and
                                   would move the spot out from under her */
    var SIT_BACK = 0.25;        /* a window has to reach this much of her height
                                   above the floor to be worth leaning on */

    var IDLE_DELAY = 2000;      /* pointer must be still this long before she sets off */
    var WAKE_DELAY = 2000;      /* she ignores the pointer for this long after loading */
    var SPEED = 105 * SCALE;    /* walking, px/s */
    var ARRIVE = 16 * SCALE;    /* close enough to the cursor, px */
    var STRIDE = 58 * SCALE;    /* px covered per full step cycle */
    var REACH = 320 * SCALE;    /* cursor distance at which she looks as far as she can */
    var HEAD_REACH = 44 * SCALE;/* ...and the same, for a cursor right on her face */

    var GRAVITY = 2800 * SCALE; /* px/s^2 */
    var BOUNCE = 0.3;           /* kept on hitting the floor or a wall */
    var RUB = 0.7;              /* horizontal speed kept per floor bounce */
    var SETTLE = 120 * SCALE;   /* below this landing speed she stops bouncing */
    var STIFF = 190;            /* spring pulling her to the cursor while held; a
                                   rate, not a length, so it does not scale */
    var DAMP = 19;
    var THROW = 2400 * SCALE;   /* px/s cap on the release velocity */

    var GRIP_X = -3 * SCALE;    /* the cursor holds her hand a touch in from */
    var GRIP_Y = 7 * SCALE;     /* the bone itself, so she hangs right under it */
    var MAX_SWING = 0.6;        /* radians; beyond this she swings out of frame */
    /* Radians the front panels swing when she sits; negative about her
       right-hand axis carries a panel's tip forward rather than merely up. */
    var SKIRT_SWING = -1.2;
    var SKIRT_STIFF = 0.75;     /* the skirt is held closer while she is carried */
    var SKIRT_DRAG = 0.6;       /* -- loose, it swings sideways through her legs */
    var SWING_DAMP = 2.2;       /* how fast the hanging swing settles */
    var LIMB_DAMP = 2.6;        /* ...and how fast a loose arm or leg does */
    var HANG_L = 0.45;          /* hand to centre of mass, as a fraction of BOX_H */

    var FACE = "Neutral";       /* her resting face */
    var REACT = "Shiitake";     /* ...when the cursor is over her head */
    var HELD_FACE = "Joy";      /* ...and being carried around is a treat */
    var DIZZY = "Guruguru";     /* ...and she is dazed for a moment after a drop */
    var DIZZY_MS = 1000;
    var DIZZY_DROP = 20;        /* px she has to fall before it counts as one */

    var WALK_YAW = 52;          /* degrees she turns to face the way she walks */
    var IDLE_YAW = 18;          /* ...and to face the cursor while standing */
    var THIGH = 26;             /* walk cycle amplitudes, degrees */
    var KNEE = 30;
    var ARM = 0.16;             /* arm swing, as an aim-vector offset */

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    var desktop = window.matchMedia("(min-width: 656px)");

    var box = null;
    var stage = null;
    var av = null;
    var owner = false;          /* this window is the one she lives in */
    var raf = 0;
    var destroyed = false;      /* she has been blown up and is not coming back
                                   until the page is reloaded */

    /* where she is: x/y are the box's top-left, in page px */
    var x = 0;
    var y = 0;
    var vx = 0;
    var vy = 0;
    var mode = "idle";          /* idle | walk | sit | held | fall */
    var phase = 0;              /* walk cycle, radians */
    var yaw = SIT_YAW;          /* which way her feet point, degrees; she starts sat */
    var twist = 0;              /* ...and how far her upper body turns past it */
    var footGap = 0;            /* empty px between her feet and the box bottom */
    var swing = 0;              /* hanging angle, radians */
    var swingV = 0;
    /* the limbs that are not holding on swing on their own, each a shorter
       pendulum than the body so they lag and overshoot it */
    var limbs = {
        arm: { a: 0, v: 0, len: 0.20, damp: LIMB_DAMP * 2.4, max: 0.42 },
        legL: { a: 0, v: 0, len: 0.30, damp: LIMB_DAMP * 1.15, max: 1.1 },
        legR: { a: 0, v: 0, len: 0.28, damp: LIMB_DAMP * 1.05, max: 1.1 }
    };
    var handX = 0;              /* her left hand's place in the box, measured */
    var handY = 0;
    var hit = null;             /* the one bit of her that takes pointer events */
    var arLink = null;          /* the USDZ, for Quick Look to open in AR */
    var tapX = 0;               /* where a press started, to tell a tap from a drag */
    var tapY = 0;
    var face = "";              /* what she is wearing, so we only set it on change */
    var dropFrom = 0;           /* where she was let go, to tell a drop from a set-down */
    var dizzyUntil = 0;
    var dazed = false;          /* seeing stars: not tracking anything just yet */
    var platform = null;        /* the window she is stood on, or the page floor */
    var platformX = null;       /* where that window's left edge was last frame */
    var grip = 0;               /* 1 while she is hanging by her hand */
    var airT = 0;               /* 1 while her feet are off the ground */
    var wasAir = 0;
    var landFrom = null;        /* where her legs were the moment she landed */
    var LEG_BONES = ["LeftUpperLeg", "LeftLowerLeg", "RightUpperLeg", "RightLowerLeg"];
    var sitT = 1;               /* 1 sitting, 0 standing, in between mid-animation */
    var sitting = true;         /* what she is heading towards */
    var everMoved = false;      /* has the pointer moved since the page loaded */
    var dazeT = 0;              /* 1 at the moment she lands, 0 as it wears off */
    var held = 0;               /* pointerId, REMOTE, or 0 */
    var localPtr = 0;           /* the pointer we have capture of, held or not */
    var driving = null;         /* peer carrying her on the end of our pointer */
    var remote = false;         /* ...and the other end of that */
    var carrySX = 0;            /* where that pointer is, screen px */
    var carrySY = 0;
    var carriedAt = 0;
    var REMOTE = -1;            /* stands in for a pointer in another window */
    var CARRY_LOST = 1500;      /* silence this long and she is put down */
    var mirror = false;         /* she is another window's; we draw our half */
    var mirrorAt = 0;
    var pose = null;
    var MIRROR_LOST = 250;      /* ...and this long after the poses stop, we do not */

    var ptrX = window.innerWidth / 2;
    var ptrY = window.innerHeight / 2;
    var ptrStill = 0;           /* timestamp of the last pointer move */
    var woke = 0;               /* when she appeared; she sleeps through WAKE_DELAY */

    var THREE = null;
    var AXIS_Y = null;
    var AXIS_Z = null;
    var qRoll = null;
    var qYaw = null;
    var pivot = null;           /* her hand, in her own space, to swing about */
    var _v1 = null;
    var _v2 = null;
    var _v3 = null;
    var _v4 = null;
    var _q1 = null;
    var _q2 = null;
    var skirt = [];             /* the skirt's spring chains, and how they rest */

    function clamp(v, lo, hi) {
        return v < lo ? lo : v > hi ? hi : v;
    }

    /* Aim directions are world-space, so everything has to turn with her. */
    function turn(d, deg) {
        var a = deg * Math.PI / 180;
        var c = Math.cos(a);
        var s = Math.sin(a);
        return [d[0] * c + d[2] * s, d[1], d[2] * c - d[0] * s];
    }

    function aim(name, d, deg) {
        av.rig.setAim(name, turn(d, deg));
    }

    /* Aim, but easing out of `from` (a world-space direction) as t falls to 0.
       Blending from a fixed nominal pose is not enough to hide a transition --
       the limb has to carry on from wherever it actually was. */
    function aimFrom(name, d, deg, from, t) {
        var w = turn(d, deg);
        if (from && t > 0) {
            w = [w[0] + (from[0] - w[0]) * t,
                w[1] + (from[1] - w[1]) * t,
                w[2] + (from[2] - w[2]) * t];
        }
        av.rig.setAim(name, w);
    }

    function captureAim(names) {
        var m = {};
        for (var i = 0; i < names.length; i++) {
            var v = av.rig.aim[names[i]];
            if (v) m[names[i]] = [v.x, v.y, v.z];
        }
        return m;
    }

    /* Winamp's open windows, top to bottom. */
    function winampRects() {
        var wins = document.querySelectorAll("#webamp .window");
        var rects = [];
        for (var i = 0; i < wins.length; i++) {
            var r = wins[i].getBoundingClientRect();
            if (r.width && r.height) rects.push(r);
        }
        return rects.sort(function (a, b) { return a.top - b.top; });
    }

    /* One wall to lean on: every window flush under the one above it, down a
       single left edge. Pulled apart, there is no such wall. */
    function winampStacked(rects) {
        for (var i = 1; i < rects.length; i++) {
            if (Math.abs(rects[i].left - rects[0].left) > 1) return false;
            if (Math.abs(rects[i].top - rects[i - 1].bottom) > 1) return false;
        }
        return true;
    }

    /* Her spot on the floor with her back to Winamp. With no wall to lean on --
       it has not loaded yet, or it is held too high, crowded up against the
       left edge, or pulled apart -- she leans on the right-hand edge of the
       screen instead. */
    function sitX() {
        var rects = winampRects();
        var backAt = window.innerWidth;

        if (rects.length) {
            var floorGap = pageFloor() - rects[rects.length - 1].bottom;
            var wall = winampStacked(rects)
                && floorGap <= (BOX_H - footGap) * SIT_BACK
                && rects[0].left >= SIT_OFFSET;
            if (wall) backAt = rects[0].left;
        }

        /* On a narrow screen Winamp lands on top of the main window, and the
           spot against it is inside that window. She takes the edge. */
        var main = document.getElementById("kfarwell-window");
        var mainRect = main && main.getBoundingClientRect();
        if (mainRect && mainRect.width && mainRect.right > backAt) {
            backAt = window.innerWidth;
        }
        return clamp(backAt - SIT_OFFSET, minX(), maxX());
    }

    /* How much of the page is actually on screen. iOS counts the strip behind
       its toolbars in innerHeight, which would stand her below the fold until
       an overscroll collapses them. */
    function viewportHeight() {
        var vv = window.visualViewport;
        return vv ? vv.height : window.innerHeight;
    }

    /* The ground: the top of the row of 88x31 badges, so she stands on them
       rather than disappearing behind them. */
    function pageFloor() {
        var b = document.getElementById("buttons");
        var r = b && b.getBoundingClientRect();
        return (r && r.height) ? r.top : viewportHeight();
    }

    /* The surface under her: the top of the window she is standing on, or the
       ground. Windows move and close, so it is re-read each time. */
    function surfaceY() {
        if (platform) {
            var r = platform.getBoundingClientRect();
            if (r.width && r.height) return r.top;
            platform = null;
            platformX = null;
        }
        return pageFloor();
    }

    /* She is stood *on* a window, so dragging that window sideways has to take
       her with it. surfaceY() already keeps her on top of it as it moves up and
       down; this carries the sideways movement across too. */
    function followPlatform() {
        if (!platform) return;
        var r = platform.getBoundingClientRect();
        if (!r.width || !r.height) { platform = null; platformX = null; return; }
        if (platformX !== null) x += r.left - platformX;
        platformX = r.left;
    }

    function floorY() {
        return surfaceY() - BOX_H + footGap;
    }

    function footY() {
        return y + BOX_H - footGap;
    }

    /* Winamp's windows sit flush against each other in a stack, so only the
       one on top of it has a top edge she could land on. */
    function winampTop(cx) {
        var wins = document.querySelectorAll("#webamp .window");
        var best = null;
        for (var i = 0; i < wins.length; i++) {
            var r = wins[i].getBoundingClientRect();
            if (!r.width || !r.height) continue;
            if (cx < r.left || cx > r.right) continue;
            if (!best || r.top < best.top) best = { el: wins[i], top: r.top };
        }
        return best ? best.el : null;
    }

    /* A window whose top edge her feet cross on the way down, and which she is
       over -- that is what she lands on. */
    function landingBetween(fromFoot, toFoot, cx) {
        var wins = [].slice.call(document.querySelectorAll("#screen > .window"));
        var winamp = winampTop(cx);
        var best = null;
        if (winamp) {
            wins.push(winamp);
        }
        for (var i = 0; i < wins.length; i++) {
            var r = wins[i].getBoundingClientRect();
            if (!r.width || !r.height) continue;
            if (cx < r.left || cx > r.right) continue;
            if (r.top < fromFoot || r.top > toFoot) continue;
            if (!best || r.top < best.top) best = { el: wins[i], top: r.top };
        }
        return best;
    }

    function centerX() {
        return x + BOX_W / 2;
    }

    function overPlatform(cx) {
        if (!platform) return false;
        var r = platform.getBoundingClientRect();
        return !!(r.width && r.height) && cx >= r.left && cx <= r.right;
    }

    /* She fills this much of the box's height. Framing her by height alone --
       rather than letting the viewer's fitView take the larger of the width and
       height fits -- keeps her the same size no matter how wide the canvas is,
       and the canvas has to be wide enough for her to swing without clipping. */
    var FILL = 0.557;

    /* The canvas is far wider than she is, so clamping the canvas to the
       viewport stops her a couple of hundred pixels short of each edge and
       reads as an invisible wall. These bound her silhouette instead. */
    var bodyHalf = 0;           /* half her standing width, px -- sizes the hit box */
    /* Her left and right edges within the box, px. Seeded with roughly where
       they land sitting, since her first frame is placed before there is
       anything to measure and a zero span would sit her a body's width right
       of where she belongs. */
    var spanL = BOX_W * 0.24;
    var spanR = BOX_W * 0.57;
    var restL = 0;              /* ...as they are when she is stood up straight */
    var restR = 0;
    var haveWidth = false;
    var widthPosture = -1;      /* she is a different width sitting than stood */
    var frames = 0;

    /* The skirt is a set of spring-bone chains. Swinging her about drives them
       hard enough to pass through her legs, so they are pulled in while she is
       being carried and let go again once she is standing. */
    function findSkirt() {
        skirt = [];
        av.rig.chains.forEach(function (c) {
            var b = c.parts[0] && c.parts[0].bone;
            if (!b || b.name.indexOf("skirt") !== 0) return;
            /* How far round the front this panel hangs: the front ones ride up
               over her thighs when she sits, the back ones stay put. Bone-local
               z runs the other way to hers, hence the sign, and the 0.03 is
               short of the panels' full 0.07 reach so the second pair round
               from the front lifts nearly as far as the first. */
            var front = clamp(-b.position.z / 0.03, -1, 1);
            skirt.push({ cfg: c.cfg, stiff: c.cfg.stiff, drag: c.cfg.drag,
                parts: c.parts, front: Math.max(0, front) });
        });
    }

    /* Her legs should push the skirt up when she sits. The spring bones have no
       colliders, so nothing stops the panels hanging straight through her
       thighs -- this folds the front ones up out of the way afterwards. */
    function liftSkirt(t) {
        if (!skirt.length) return;
        /* Swing the front panels forward so they lie over her thighs. Only the
           root of each chain is turned -- the rest of the panel hangs off it as
           the spring solve left it. Aiming every segment instead collapses the
           panel into a straight spar and reads as garbage. */
        _v1.set(1, 0, 0).applyQuaternion(av.rigRoot.quaternion);
        for (var i = 0; i < skirt.length; i++) {
            var turnBy = SKIRT_SWING * t * skirt[i].front;
            if (Math.abs(turnBy) < 0.01) continue;
            var b = skirt[i].parts[0].bone;
            b.updateWorldMatrix(true, false);
            _q1.copy(b.getWorldQuaternion(_q2)).invert();
            _v2.copy(_v1).applyQuaternion(_q1).normalize();
            b.quaternion.multiply(_q2.setFromAxisAngle(_v2, turnBy));
            b.updateWorldMatrix(false, true);
        }
    }

    /* Sitting, her hands are meant to be planted flat on the badges. An aim
       alone cannot do it: setAim takes the shortest arc onto the finger
       direction and leaves the roll about that direction wherever it landed, so
       the palms come out facing inward. This measures the palm normal and rolls
       the wrist about the fingers until it points at the floor. */
    function flattenHands(t) {
        var rig = av.rig;
        ["Left", "Right"].forEach(function (side) {
            var hand = rig.bones[side + "Hand"];
            var mid = rig.bones[side + "MiddleProximal"];
            var idx = rig.bones[side + "IndexProximal"];
            var lit = rig.bones[side + "LittleProximal"];
            if (!hand || !mid || !idx || !lit) return;
            hand.updateWorldMatrix(true, true);
            var w = hand.getWorldPosition(_v1);
            var axis = mid.getWorldPosition(_v2).sub(w).normalize();
            /* palm normal: across the knuckles, crossed with the fingers */
            var across = idx.getWorldPosition(new THREE.Vector3())
                .sub(lit.getWorldPosition(new THREE.Vector3())).normalize();
            /* index-to-little crossed with the fingers comes out the *back* of
               the left hand and the palm of the right, so the left is the one
               that gets flipped to make both point out of the palm. */
            var n = across.cross(axis).normalize();
            if (side === "Left") n.negate();
            /* The roll that swings n down onto -Y, measured in the plane the
               fingers are the normal of. Fingers pointing straight down make
               that plane horizontal, where "palm downwards" means nothing and
               the projection collapses to an arbitrary angle -- so the roll
               fades out with them: full weight held out flat, none hanging. */
            var flat = Math.sqrt(Math.max(0, 1 - axis.y * axis.y));
            var want = new THREE.Vector3(0, -1, 0);
            want.addScaledVector(axis, -want.dot(axis)).normalize();
            var cur = n.clone().addScaledVector(axis, -n.dot(axis)).normalize();
            if (!isFinite(cur.x) || !isFinite(want.x)) return;
            var ang = Math.acos(clamp(cur.dot(want), -1, 1));
            if (cur.clone().cross(want).dot(axis) < 0) ang = -ang;
            ang *= t * clamp(flat / 0.45, 0, 1);
            if (Math.abs(ang) < 0.01) return;
            _q1.copy(hand.getWorldQuaternion(_q2)).invert();
            var local = axis.clone().applyQuaternion(_q1).normalize();
            hand.quaternion.multiply(_q2.setFromAxisAngle(local, ang));
            hand.updateWorldMatrix(false, true);
        });
    }

    /* The model carries "kisekae" (dress-up) shapes: shrunk versions of the
       body for wearing clothes over. Skinning pinches at a deeply folded knee
       and pushes her leg through the legging, so the knee one is dialled in by
       how far the knees are actually bent -- nothing while she is stood or
       walking, all of it at the bottom of the crouch. */
    var KNEE_SHRINK = "kisekae_Knee";
    var KNEE_FLAT = 25;         /* degrees of bend the leggings cope with */
    var KNEE_FOLD = 80;         /* ...and where the shape is needed in full */
    var shrinkMeshes = [];

    function findShrink() {
        shrinkMeshes = [];
        av.scene.traverse(function (o) {
            if (!o.isMesh || !o.morphTargetDictionary) return;
            var i = o.morphTargetDictionary[KNEE_SHRINK];
            if (i !== undefined) shrinkMeshes.push({ mesh: o, index: i });
        });
    }

    function shrinkKnees() {
        if (!shrinkMeshes.length) return;
        var worst = 0;
        for (var i = 0; i < 2; i++) {
            var side = i ? "Right" : "Left";
            var hip = av.rig.bones[side + "UpperLeg"];
            var knee = av.rig.bones[side + "LowerLeg"];
            var foot = av.rig.bones[side + "Foot"];
            if (!hip || !knee || !foot) continue;
            hip.updateWorldMatrix(true, false);
            var a = knee.getWorldPosition(_v1).sub(hip.getWorldPosition(_v2)).normalize();
            var b = foot.getWorldPosition(_v3).sub(knee.getWorldPosition(_v4)).normalize();
            var deg = Math.acos(clamp(a.dot(b), -1, 1)) * 180 / Math.PI;
            if (deg > worst) worst = deg;
        }
        var w = clamp((worst - KNEE_FLAT) / (KNEE_FOLD - KNEE_FLAT), 0, 1);
        for (var j = 0; j < shrinkMeshes.length; j++) {
            shrinkMeshes[j].mesh.morphTargetInfluences[shrinkMeshes[j].index] = w;
        }
    }

    function holdSkirt(carried) {
        for (var i = 0; i < skirt.length; i++) {
            skirt[i].cfg.stiff = carried ? SKIRT_STIFF : skirt[i].stiff;
            skirt[i].cfg.drag = carried ? SKIRT_DRAG : skirt[i].drag;
        }
    }

    /* How wide she stands. Not Box3.setFromObject: a skinned mesh reports the
       bounding box of its bind pose, which for this rig is a T-pose, twice her
       real width. Taken from the posed bones instead, and latched rather than
       re-taken every frame -- a width that breathes with her arm swing drags the
       walk limits about under her. */
    var WIDE_BONES = ["LeftHand", "RightHand", "LeftLowerArm", "RightLowerArm",
        "LeftUpperArm", "RightUpperArm", "LeftFoot", "RightFoot", "Head"];

    /* Where her silhouette actually falls inside the box, in px. Not a width
       either side of the box's centre: swinging rotates the rig about her hand,
       which carries her body a long way off centre, and a limit that assumes
       she is centred then stops her while she is still short of the edge. */
    function projectSpan() {
        var lo = Infinity;
        var hi = -Infinity;
        var p = new THREE.Vector3();
        for (var i = 0; i < WIDE_BONES.length; i++) {
            var b = av.rig.bones[WIDE_BONES[i]];
            if (!b) continue;
            b.updateWorldMatrix(true, false);
            p.setFromMatrixPosition(b.matrixWorld).project(av.camera);
            var px = (p.x * 0.5 + 0.5) * BOX_W;
            if (px < lo) lo = px;
            if (px > hi) hi = px;
        }
        if (lo > hi) return null;
        var m = 0.05 * BOX_H * FILL / av.height;   /* hair, skirt, fingers */
        return [lo - m, hi + m];
    }

    /* How far she sinks so that whatever she is resting on -- her feet through
       the crouch, her seat once she is down -- meets the floor. The drop moves
       the canvas, not the rig, so it cannot feed back.

       Two probes, and the smaller drop wins, since sinking past either would
       bury it. Her feet move about under her as she folds up, so those are
       measured live; her pelvis never moves in the canvas at all, which makes
       the seated drop a fixed depth beneath it. Both depths are in world units
       and calibrated by eye, and they agree at the settled pose, so the
       handover partway through the move does not step. */
    var FOOT_BONES = ["LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase"];
    var FOOT_DEEP = 0.014;      /* ankle and toe joints to the sole */
    var HIP_DEEP = 0.151;       /* pelvis joint to the seat under it */
    var sitDrop = 0;

    function measureDrop() {
        var scale = BOX_H * FILL / av.height;    /* page pixels per world unit */
        var p = new THREE.Vector3();
        function depth(name, deep) {
            var b = av.rig.bones[name];
            if (!b) return -Infinity;
            b.updateWorldMatrix(true, false);
            p.setFromMatrixPosition(b.matrixWorld).project(av.camera);
            return (1 - (p.y * 0.5 + 0.5)) * BOX_H + deep * scale;
        }
        var floor = BOX_H - footGap;
        var seat = floor - depth("Hips", HIP_DEEP);
        var feet = Infinity;
        for (var i = 0; i < FOOT_BONES.length; i++) {
            feet = Math.min(feet, floor - depth(FOOT_BONES[i], FOOT_DEEP));
        }
        if (!isFinite(seat) && !isFinite(feet)) return;
        /* Her feet only hold her up while her weight is still on them. Once she
           is down -- past the tuck -- her seat carries her and her heels slide
           out along the floor; kept as a constraint through that, the ankles
           swinging out from under her knees would jack her whole body up and
           drop it again. The handover is eased over the last stretch before the
           tuck rather than switched, since her heels are already a little off
           the floor by the time she is sat on them. */
        var hand = clamp((sitT - (SIT_TUCK - 0.12)) / 0.12, 0, 1);
        hand = hand * hand * (3 - 2 * hand);
        sitDrop = Math.max(0, Math.min(seat, feet + (seat - feet) * hand));
    }

    function measureWidth() {
        var s = projectSpan();
        if (!s) return;
        restL = s[0];
        restR = s[1];
        spanL = restL;
        spanR = restR;
        bodyHalf = (restR - restL) / 2;
        haveWidth = true;
    }

    function onFoot() {
        return mode === "idle" || mode === "walk" || mode === "sit";
    }

    function minX() {
        var lo = 0;
        if (platform && onFoot()) lo = platform.getBoundingClientRect().left;
        return lo - spanL;
    }

    function maxX() {
        var hi = window.innerWidth;
        if (platform && onFoot()) hi = platform.getBoundingClientRect().right;
        return hi - spanR;
    }

    function frameCamera() {
        var vFov = av.camera.fov * Math.PI / 180;
        var d = (av.height / FILL * 0.5) / Math.tan(vFov / 2);
        av.controls.target.set(0, av.center.y, 0);
        av.camera.position.set(0, av.center.y + d * 0.045, d);
        av.controls.update();
    }

    /* The camera frames the whole body with some slack, so her feet are not at
       the bottom of the canvas. Project them to find out by how much. The viewer
       frames the shot before it knows the canvas aspect, so re-fit first, and
       bring the camera matrices up to date -- project() reads
       matrixWorldInverse, which is otherwise only refreshed on render.

       The frame count is not reset here: it gates the very first measurement,
       and restarting it on every resize can starve that entirely while the
       window is being dragged. */
    function measureFeet() {
        av.resize();
        frameCamera();
        haveWidth = false;
        widthPosture = -1;
        av.camera.updateMatrixWorld();
        var feet = new THREE.Vector3(0, av.center.y - av.height / 2, 0);
        feet.project(av.camera);
        footGap = (feet.y * 0.5 + 0.5) * BOX_H;
    }

    function place() {
        box.style.transform = "translate3d(" + Math.round(x) + "px, "
            + Math.round(y) + "px, 0)";
    }

    /* Her facing and her hanging angle, as one rotation of the rig itself. The
       hair and skirt are spring bones simulated in world space, so a rotation
       of the canvas in CSS leaves them hanging dead straight -- only moving her
       inside the scene makes them swing. The yaw turns her on the spot; the
       roll pivots about the hand she is hanging from, so that hand stays under
       the cursor while the rest of her swings below it. */
    function orient() {
        var root = av.rigRoot;
        qYaw.setFromAxisAngle(AXIS_Y, yaw * Math.PI / 180);
        qRoll.setFromAxisAngle(AXIS_Z, swing);
        root.quaternion.copy(qRoll).multiply(qYaw);
        if (Math.abs(swing) < 1e-4) {
            root.position.set(0, 0, 0);
            return;
        }
        var p = pivot.clone().applyQuaternion(qYaw);
        root.position.copy(p).sub(p.clone().applyQuaternion(qRoll));
    }

    /* One frame of the walk cycle, or the resting pose when amount is 0. */
    function poseBody(amount) {
        var rig = av.rig;
        var swing = Math.sin(phase) * amount;
        var lift = Math.cos(phase) * amount;

        var thighL = THIGH * swing;
        var thighR = -THIGH * swing;
        /* the trailing leg folds; the leading one reaches */
        var kneeL = KNEE * Math.max(0, -swing);
        var kneeR = KNEE * Math.max(0, swing);

        leg("Left", thighL, kneeL);
        leg("Right", thighR, kneeR);

        var s = rig.leftSign;
        /* arms hang close to the body, elbows a little forward, wrists broken
           inwards -- straight down through shoulder, elbow and hand is the
           A-pose the model ships in, not a person standing */
        arm("LeftUpperArm", [0.20 * s, -0.97, 0.10 - ARM * swing]);
        arm("LeftLowerArm", [0.13 * s, -0.94, 0.31 - ARM * swing]);
        arm("RightUpperArm", [-0.20 * s, -0.97, 0.10 + ARM * swing]);
        arm("RightLowerArm", [-0.13 * s, -0.94, 0.31 + ARM * swing]);
        /* The hands are not aimed: a shortest-arc aim leaves the
           roll about the direction wherever it lands, and the two hands have
           mirrored rest orientations, so one palm ends up facing out. Unaimed,
           each keeps the roll it was built with and follows its forearm. The
           aim table persists, so the seated pose's aims are cleared here. */
        unaim("LeftHand");
        unaim("RightHand");
        curl("Left", LOOSE);
        curl("Right", LOOSE);

        /* a little bounce and counter-rotation through the spine */
        rig.setBone("Spine", 1.5 + 2.2 * amount, -3.5 * swing + twist * 0.45, 0);
        rig.setBone("Chest", -1.5, 2.5 * swing + twist * 0.55, 0);
        rig.setBone("Hips", 1.5 * lift * amount, 0, 0);
    }

    function leg(side, thigh, knee) {
        var a = thigh * Math.PI / 180;
        var b = (thigh - knee) * Math.PI / 180;
        var up = side + "UpperLeg";
        var lo = side + "LowerLeg";
        aimFrom(up, [0.06, -Math.cos(a), Math.sin(a)], yaw, landFrom && landFrom[up], airT);
        aimFrom(lo, [0.02, -Math.cos(b), Math.sin(b)], yaw, landFrom && landFrom[lo], airT);
    }

    function arm(name, d) {
        aim(name, d, yaw);
    }

    function unaim(name) {
        if (av.rig.aim[name]) delete av.rig.aim[name];
    }

    /* Fingers left straight read as a mannequin, so every pose sets a curl:
       thumb, index, middle, ring, little, in degrees. */
    var FINGERS = ["Thumb", "Index", "Middle", "Ring", "Little"];
    var SEGS = ["Proximal", "Intermediate", "Distal"];
    var LOOSE = [10, 20, 25, 30, 34];   /* hanging by her side */
    var GRIP = [34, 62, 68, 68, 62];    /* holding on */
    var FLAT = [12, 8, 6, 7, 10];       /* palm down on the floor */

    /* How far the hands are into their flat, palm-down, pointing-right posture.
       They hang off the wrist while she is still up on her feet -- held out
       backwards from a standing arm they read as broken -- and turn out flat
       over the descent, so they are planted by the time she is down. */
    function handT(t) {
        var u = clamp((t - 0.40) / 0.32, 0, 1);
        return u * u * (3 - 2 * u);
    }

    function blendCurl(a, b, t) {
        var out = [];
        for (var i = 0; i < a.length; i++) out.push(a[i] + (b[i] - a[i]) * t);
        return out;
    }

    function curl(side, deg) {
        for (var i = 0; i < FINGERS.length; i++) {
            for (var j = 0; j < SEGS.length; j++) {
                av.rig.setCurl(side + FINGERS[i] + SEGS[j],
                    deg[i] * (j === 2 ? 0.7 : 1));
            }
        }
    }

    /* She hangs by her left hand: that arm reaches straight up to the cursor and
       everything else dangles off it. The rest of the hang -- the body swinging
       under the hand -- is the box rotating about the hand, see place(). */
    function poseHeld(t) {
        var rig = av.rig;
        var s = rig.leftSign;
        var sway = Math.sin(t * 4) * 0.05;
        var drift = Math.sin(t * 2.6) * 0.04;

        /* the wrist folds over what she is holding rather than carrying on in a
           straight line from the forearm */
        function held(up, down) { return down + (up - down) * grip; }
        aim("LeftUpperArm", [held(0.16, 0.30) * s, held(0.98, -0.93), held(0.04, 0.20)], yaw);
        aim("LeftLowerArm", [held(0.09, 0.22) * s, held(0.99, -0.92), held(0.06, 0.32)], yaw);
        if (grip > 0.15) aim("LeftHand", [-0.10 * s, 0.90, 0.42], yaw);
        else unaim("LeftHand");
        curl("Left", grip > 0.5 ? GRIP : LOOSE);
        unaim("RightHand");

        /* the free arm and both legs hang off their own pendulums, the lower
           segments swinging a little further than the upper ones */
        hangAim("RightUpperArm", [-0.30 * s, -0.93, 0.20 + drift], limbs.arm.a, 1);
        hangAim("RightLowerArm", [-0.22 * s, -0.92, 0.32 + drift], limbs.arm.a, 1.2);
        curl("Right", LOOSE);

        /* knees fold backwards -- negative z, the way leg() bends them */
        hangAim("LeftUpperLeg", [0.12, -0.97, 0.16 + sway], limbs.legL.a, 1);
        hangAim("LeftLowerLeg", [0.08, -0.90, -0.42 + sway], limbs.legL.a, 1.25);
        hangAim("RightUpperLeg", [-0.16, -0.97, 0.06 - sway], limbs.legR.a, 1);
        hangAim("RightLowerLeg", [-0.10, -0.92, -0.32 - sway], limbs.legR.a, 1.25);

        /* The shoulder she is hanging from rides up and she curls a little --
           but the whole torso also trails the swing, bending through hips,
           spine, chest and neck rather than staying in one rigid shape. */
        var lag = clamp(swingV * 0.22, -1, 1);
        var arc = clamp(swing * 0.8, -1, 1);
        rig.setBone("Hips", 3 + 5 * lag, -3 * arc, -2 - 11 * lag);
        rig.setBone("Spine", -5 - 4 * lag, 2 * arc, 4 + 9 * lag);
        rig.setBone("Chest", -4 - 3 * lag, 3 * arc, 3 + 7 * lag);
        rig.setBone("Neck", -2 - 2 * lag, 2 * arc, 2 + 5 * lag);
    }

    /* One pendulum step. `push` is how hard the pivot is being yanked
       sideways; gravity pulls the limb back to hanging straight down. */
    function swingStep(o, dt, push) {
        var len = BOX_H * o.len;
        o.v += (-(GRAVITY / len) * Math.sin(o.a)
            - o.damp * o.v - (push / len) * Math.cos(o.a)) * dt;
        o.a = clamp(o.a + o.v * dt, -o.max, o.max);
    }

    /* Aim a limb that is hanging: `base` is where it sits at rest, rotated by
       its pendulum. The angle is relative to her body, which the rig's own roll
       has already swung. */
    function hangAim(name, base, a, scale) {
        var ang = a * (scale || 1);
        var c = Math.cos(ang);
        var n = Math.sin(ang);
        aim(name, [base[0] * c - base[1] * n, base[0] * n + base[1] * c, base[2]], yaw);
    }

    /* Where her left hand ends up on screen, in box pixels, and where it sits
       in her own space for the swing to pivot about. Measured rather than
       assumed: it moves with the pose, the yaw and her size. */
    function measureHand() {
        var b = av.rig.bones.LeftHand;
        if (!b) return;
        b.updateWorldMatrix(true, false);
        var p = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
        pivot.copy(p);
        av.rigRoot.worldToLocal(pivot);
        p.project(av.camera);
        handX = (p.x * 0.5 + 0.5) * BOX_W - GRIP_X;
        handY = (1 - (p.y * 0.5 + 0.5)) * BOX_H - GRIP_Y;
    }

    /* Sitting on the floor, legs out in front, leaning back on the window.
       `t` blends it against however she is stood, so standing up and sitting
       down are the same animation run in opposite directions. */
    function poseSit(t) {
        if (t <= 0) return;
        var rig = av.rig;
        var s = rig.leftSign;
        /* Straight from standing to sitting is a lever swinging on a hinge: her
           legs sweep out in front while the rest of her stays rigid, and nobody
           gets up like that either -- you draw your knees in under you first.
           So every joint follows a path over five keys rather than a line:

               0           stood
               SIT_CROUCH  knees bent, folded forward, still on her feet
               SIT_TUCK    down, knees drawn up, feet in under her
               SIT_REACH   knees straightening, thighs still raised
               1           sat, legs out along the floor

           Run backwards -- which is what standing up is -- that reads as knees
           in, feet under her, then up. */
        function seg(a, b, u) {
            u = u * u * (3 - 2 * u);        /* ease each leg of the path */
            return a + (b - a) * u;
        }
        function via(stand, crouch, tuck, reach, sit) {
            var k = [0, SIT_CROUCH, SIT_TUCK, SIT_REACH, 1];
            var v = [stand, crouch, tuck, reach, sit];
            for (var i = 1; i < k.length; i++) {
                if (t <= k[i] || i === k.length - 1) {
                    return seg(v[i - 1], v[i], (t - k[i - 1]) / (k[i] - k[i - 1]));
                }
            }
            return sit;
        }

        /* Thighs: down (stood), down and forward (crouch), knees up over her
           seat (tuck), still raised while the knee straightens (reach), then
           flat along the floor (sat). Straightening the knee before dropping
           the thigh is what keeps her heels on the floor as she stretches out;
           doing both at once swings her ankles down through it. */
        aim("LeftUpperLeg", [via(0.06, 0.09, 0.10, 0.10, 0.10) * s, via(-1, -0.84, 0.85, 0.78, 0.07), via(0, 0.54, 0.53, 0.63, 0.99)], yaw);
        /* Shins: tucked back under the knee until she is down, then swung out
           in front -- that is her feet coming in under her, then sliding away */
        aim("LeftLowerLeg", [via(0.02, 0.04, 0.06, 0.06, 0.06) * s, via(-1, -0.97, -0.97, -0.93, -0.12), via(0, -0.24, 0.24, 0.37, 0.99)], yaw);
        aim("RightUpperLeg", [via(-0.06, -0.09, -0.10, -0.10, -0.10) * s, via(-1, -0.84, 0.85, 0.78, 0.07), via(0, 0.54, 0.53, 0.63, 0.99)], yaw);
        aim("RightLowerLeg", [via(-0.02, -0.04, -0.06, -0.06, -0.06) * s, via(-1, -0.97, -0.97, -0.93, -0.12), via(0, -0.24, 0.24, 0.37, 0.99)], yaw);

        /* Arms: straight down her sides the whole way, reaching for the floor
           beside her. */
        var loL = [via(0.13, 0.20, 0.26, 0.26, 0.26) * s, via(-0.94, -0.95, -0.96, -0.955, -0.95), via(0.31, 0.22, 0.14, 0.10, 0.06)];
        var loR = [-loL[0], loL[1], loL[2]];
        aim("LeftUpperArm", [via(0.20, 0.26, 0.34, 0.34, 0.34) * s, via(-0.97, -0.96, -0.95, -0.94, -0.93), via(0.10, 0.14, 0.16, 0.12, 0.08)], yaw);
        aim("LeftLowerArm", loL, yaw);
        aim("RightUpperArm", [via(-0.20, -0.26, -0.34, -0.34, -0.34) * s, via(-0.97, -0.96, -0.95, -0.94, -0.93), via(0.10, 0.14, 0.16, 0.12, 0.08)], yaw);
        aim("RightLowerArm", loR, yaw);

        /* Fingers end up flat along the badges, pointing screen-right -- a
           world direction, not one of hers, so it is set straight rather than
           through aim(), which turns its argument by her yaw. They start from
           wherever the forearm points rather than from straight down, which
           would cock the wrist back wherever the arm was not vertical.
           flattenHands() then rolls the palms down. */
        var h = handT(t);
        var fL = turn(loL, yaw);
        var fR = turn(loR, yaw);
        function reach(f) {
            return [f[0] + (1 - f[0]) * h, f[1] * (1 - h), f[2] * (1 - h)];
        }
        av.rig.setAim("LeftHand", reach(fL));
        av.rig.setAim("RightHand", reach(fR));
        /* splayed almost straight: curled fingers hold the palm off the floor */
        curl("Left", blendCurl(LOOSE, FLAT, h));
        curl("Right", blendCurl(LOOSE, FLAT, h));

        /* She folds at the waist over the crouch, comes most of the way back up
           over the tuck, and finishes leaning against the window; the neck
           holds her head level through all of it. Negative pitch folds her
           forward -- poseHeld uses it to curl her up -- so the lean back
           against the window is positive. */
        rig.setBone("Hips", via(0, -7, 3, 7, 10), 0, 0);
        rig.setBone("Spine", via(0, -15, -4, -1, 1.4), twist * 0.3, 0);
        rig.setBone("Chest", via(0, -5, -2, 0, 0.56), twist * 0.4, 0);
        rig.setBone("Neck", via(0, 13, 4, 1, -2), 0, 0);
    }

    /* Her head tracks the cursor. Two conversions: lookTarget's y points up
       while clientY points down, and the look is applied in her own space, so
       the yaw she is already turned by has to come back out of it. */
    function lookAtPointer(now) {
        /* While she is seeing stars she does not follow the cursor. Her head
           wanders in a slow figure of eight instead, winding down as the daze
           wears off -- and her eyes go with it, since they follow the same
           target. */
        if (dazed) {
            var w = dazeT * 0.85;
            av.rig.lookTarget.set(Math.sin(now / 95) * w, Math.cos(now / 71) * w * 0.6);
            return;
        }
        /* Measured from her eyes, not the middle of her body: with the cursor
           right on her face the difference between the two is the whole of the
           look, and taken from her belly she stared off past it. */
        var hx = x + headX;
        var hy = y + headY - BOX_H * 0.04;
        /* A cursor sat on her face is only a few dozen pixels from her eyes,
           which against the full reach is a look of about a tenth -- so she
           stared straight ahead exactly when she is most obviously being
           looked at (the same patch that puts her in Shiitake). Close in, the
           reach shrinks to the size of her head so her eyes track properly,
           easing back out to the full one over the next head's width. */
        var n = Math.max(Math.abs(ptrX - hx) / (BOX_W * 0.15),
            Math.abs(ptrY - hy) / (BOX_H * 0.075));
        var u = clamp((n - 1) / 1.5, 0, 1);
        u = u * u * (3 - 2 * u);
        var r = HEAD_REACH + (REACH - HEAD_REACH) * u;
        /* The body-turn correction is uncapped: sat against the window she is
           yawed most of the way round, and it takes all of it to bring her face
           back to the screen. */
        var lx = clamp((ptrX - hx) / r, -1, 1) - (yaw + twist) / 46;
        var ly = clamp((hy - ptrY) / (r * 0.81), -1, 1);
        av.rig.lookTarget.set(clamp(lx, -1, 1), ly);
    }

    /* Her head, in page pixels. Projected from the bone rather than guessed at
       as a slice off the top of the box -- there is a good deal of empty canvas
       above her, and the guess sat on her forehead and the air over it. */
    var headX = BOX_W * 0.5;
    var headY = BOX_H * 0.18;

    function measureHead() {
        var b = av.rig.bones.Head;
        if (!b) return;
        fitHit();
        b.updateWorldMatrix(true, false);
        var p = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
        p.project(av.camera);
        headX = (p.x * 0.5 + 0.5) * BOX_W;
        headY = (1 - (p.y * 0.5 + 0.5)) * BOX_H;
    }

    /* The canvas has a good deal of empty space over her head; the hit box
       starts just above her hair rather than at the top of it. */
    var hitTop = -1;
    var hitHalf = -1;

    function fitHit() {
        var t = Math.max(0, Math.round(headY - BOX_H * 0.085));
        if (Math.abs(t - hitTop) >= 2) {
            hitTop = t;
            hit.style.top = t + "px";
        }
        /* as wide as she is -- the same silhouette the walk limits use, rather
           than a fraction of a canvas that is mostly empty air */
        var w = Math.round(bodyHalf);
        if (w > 0 && Math.abs(w - hitHalf) >= 2) {
            hitHalf = w;
            hit.style.left = (BOX_W / 2 - w) + "px";
            hit.style.width = (2 * w) + "px";
            hit.style.right = "auto";
        }
    }

    function overHead(cx, cy) {
        /* The Head bone sits at the base of the skull, so the box is lifted off
           it by rather more than half its own height to centre on her eyes. */
        return Math.abs(cx - (x + headX)) < BOX_W * 0.15
            && Math.abs(cy - (y + headY) + BOX_H * 0.04) < BOX_H * 0.075;
    }

    function setFace(name) {
        if (face === name) return;
        face = name;
        av.setExpression(name);
    }

    /* Returns true if she has gone to another window, leaving nothing to draw. */
    function move(dt, now) {
        var ground = floorY();

        if (mode === "held") {
            /* the cursor holds her hand, not the spot she was grabbed by */
            measureHand();
            var was = vx;
            vx += ((ptrX - handX - x) * STIFF - vx * DAMP) * dt;
            vy += ((ptrY - handY - y) * STIFF - vy * DAMP) * dt;
            x = hold(x + vx * dt);
            y += vy * dt;

            /* and she swings under it: a pendulum driven by the hand moving */
            var len = BOX_H * HANG_L;
            var push = dt > 0 ? (vx - was) / dt : 0;
            swingV += (-(GRAVITY / len) * Math.sin(swing)
                - SWING_DAMP * swingV - (push / len) * Math.cos(swing)) * dt;
            swing = clamp(swing + swingV * dt, -MAX_SWING, MAX_SWING);
            swingStep(limbs.arm, dt, push);
            swingStep(limbs.legL, dt, push);
            swingStep(limbs.legR, dt, push);

            if (carryOut()) return true;
            if (remote && now - carriedAt > CARRY_LOST) drop();
        } else if (mode === "fall") {
            vy += GRAVITY * dt;
            x += vx * dt;
            var wasFoot = footY();
            y += vy * dt;

            if (tossOut()) return true;

            if (x < minX() && !openEdge(-1)) { x = minX(); vx = -vx * BOUNCE; }
            if (x > maxX() && !openEdge(1)) { x = maxX(); vx = -vx * BOUNCE; }

            /* a bounce can carry her off the side of what she landed on */
            if (platform && !overPlatform(centerX())) {
                platform = null;
                platformX = null;
                ground = floorY();
            }

            /* landing on a window she was falling over */
            if (vy > 0) {
                var landed = landingBetween(wasFoot, footY(), centerX());
                if (landed) {
                    platform = landed.el;
                    platformX = null;   /* pick the edge up on the next frame */
                    ground = floorY();
                }
            }
            if (y >= ground) {
                y = ground;
                if (Math.abs(vy) > SETTLE) {
                    vy = -vy * BOUNCE;
                    vx *= RUB;
                } else {
                    vy = 0;
                    vx = 0;
                    mode = "idle";
                    if (ground - dropFrom > DIZZY_DROP) dizzyUntil = now + DIZZY_MS;
                    dropFrom = ground;
                }
            }
        } else {
            y = ground;
            vy = 0;
            followPlatform();

            /* long enough untouched and she goes to sit against the music
               window; the moment the pointer stirs, she gets back up */
            if (everMoved && !sitting && now - ptrStill > SIT_AFTER) sitting = true;

            var goal = sitting ? sitX() + BOX_W / 2 : ptrX;
            var dx = goal - centerX();
            var edge = (x <= minX() && dx < 0) || (x >= maxX() && dx > 0);
            /* the walk has to take her closer than the usual slack, or she
               stops a stride short of the wall and never settles */
            var arrive = sitting ? SIT_ARRIVE : ARRIVE;
            var settled = sitting ? (Math.abs(dx) <= arrive || edge) : false;

            if (mode === "sit" && !sitting && sitT < 0.02) mode = "idle";
            if (mode !== "sit" && sitting && settled) mode = "sit";
            /* once she is down she stays against the window, even if it moves */
            if (mode === "sit" && sitT > 0.99) x = sitX();

            /* she cannot walk while she is down, or getting up */
            var canWalk = sitT < 0.05 && mode !== "sit";
            if (canWalk && mode === "idle"
                && (sitting || now - ptrStill > IDLE_DELAY)
                && Math.abs(dx) > arrive && !edge) {
                mode = "walk";
            }
            if (mode === "walk") {
                if (!canWalk || Math.abs(dx) <= arrive || edge) {
                    mode = "idle";
                    vx = 0;
                } else {
                    var dir = dx < 0 ? -1 : 1;
                    x = clamp(x + dir * SPEED * dt, minX(), maxX());
                    phase += (SPEED * dt / STRIDE) * Math.PI * 2;
                    vx = dir * SPEED;
                }
            }
        }

        /* stand up / settle down */
        var wantSit = (sitting && mode === "sit") ? 1 : 0;
        sitT += clamp(wantSit - sitT, -dt / SIT_BLEND, dt / SIT_BLEND);
        /* let go and the arm she was hanging by comes down, rather than
           staying up over her head until she hits the ground */
        grip += clamp((mode === "held" ? 1 : 0) - grip, -dt / 0.4, dt / 0.4);
        /* ...and her legs draw back under her once she is down, instead of
           snapping from dangling to standing the instant she lands */
        var inAir = (mode === "held" || mode === "fall") ? 1 : 0;
        if (wasAir && !inAir) {
            landFrom = captureAim(LEG_BONES);
            airT = 1;
        }
        wasAir = inAir;
        airT += clamp(inAir - airT, -dt / 0.45, dt / 0.45);

        /* measureDrop() already tracks whatever she is lowest on, so the drop
           is followed exactly rather than ramped in over the move. */
        if (sitT > 0.01) measureDrop();
        else sitDrop = 0;
        y += sitDrop;

        if (mode !== "held") {
            /* still falling, so the limbs keep swinging, just with nothing
               driving them; on the ground everything eases back to rest */
            var settle = Math.min(1, dt * (mode === "fall" ? 3 : 8));
            swing += (0 - swing) * settle;
            swingV = 0;
            for (var k in limbs) {
                if (mode === "fall") swingStep(limbs[k], dt, 0);
                else { limbs[k].a += (0 - limbs[k].a) * settle; limbs[k].v = 0; }
            }
        }

        /* Which way she is pointed. Walking turns her whole body, feet and all;
           glancing at the cursor only twists the spine, because a standing
           person does not shuffle round to look at something. */
        var want = 0;
        var wantTwist = 0;
        if (mode === "walk") want = (vx < 0 ? -1 : 1) * WALK_YAW;
        else if (mode === "held" || mode === "fall") want = clamp(vx / (30 * SCALE), -1, 1) * IDLE_YAW;
        else if (!dazed) wantTwist = clamp((ptrX - centerX()) / (340 * SCALE), -1, 1) * IDLE_YAW;
        /* stay turned to the wall until she is actually on her feet, then let
           the yaw easing bring her round -- turning while still on the floor
           looks like she is swivelling on her backside */
        if (sitT > 0.05) want = SIT_YAW;
        yaw += (want - yaw) * Math.min(1, dt * 6);
        twist += (wantTwist - twist) * Math.min(1, dt * 5);
        return false;
    }

    function step(dt, now) {
        dazed = now < dizzyUntil;
        dazeT = dazed ? (dizzyUntil - now) / DIZZY_MS : 0;

        if (mirror) adoptPose();
        else if (move(dt, now)) return;

        measureHead();
        /* Re-taken when she sits or stands, since that changes her outline, and
           latched in between. The first measurement happens on frame one, so
           she is placed before she is ever shown, and again a few frames later
           once the viewer has applied her pose over the one it starts in. */
        var posture = sitT > 0.5 ? 1 : 0;
        if (!mirror && (mode === "idle" || mode === "sit")
            && (!haveWidth || widthPosture !== posture || frames === 6)) {
            measureWidth();
            widthPosture = posture;
            /* only now is she the right size and in the right place */
            if (mode === "sit") x = sitX();
            box.classList.add("ready");
        }
        if (mirror) {
            box.classList.add("ready");
        } else if (mode === "held" || mode === "fall") {
            var sp = projectSpan();
            if (sp) { spanL = sp[0]; spanR = sp[1]; }
        } else if (haveWidth) {
            spanL = restL;
            spanR = restR;
        }
        holdSkirt(mode === "held" || mode === "fall");
        if (mirror) setFace(pose.face);
        else if (mode === "held") setFace(HELD_FACE);
        else if (now < dizzyUntil) setFace(DIZZY);
        else if (overHead(ptrX, ptrY)) setFace(REACT);
        else setFace(FACE);

        if (mode === "held" || mode === "fall") poseHeld(now / 1000);
        else {
            poseBody(mode === "walk" ? 1 : 0);
            poseSit(sitT);
        }

        /* ...and her head lolls with it */
        av.rig.setBone("Head", 0, 0, dazed ? Math.sin(now / 115) * 14 * dazeT : 0);

        orient();
        lookAtPointer(now);
        place();

        if (!mirror && straddles()) send({ t: "pose", pose: poseState() });
    }

    var last = 0;

    function frame(now) {
        if (destroyed) { raf = 0; return; }
        /* A dormant window runs its first frames hidden: they measure her and
           frame the camera, so a catch is drawn straight away. */
        if (!owner && !mirror && frames > WARM_FRAMES) { raf = 0; return; }
        if (mirror && now - mirrorAt > MIRROR_LOST) { setMirror(false); return; }
        raf = requestAnimationFrame(frame);
        frames++;
        var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
        last = now;
        step(dt, now);
    }

    /* Mobile is one window filling the screen, with no desk to stand on. She
       turns up once it is out of the way, and sleeps while it is not. */
    function hasRoom() {
        if (desktop.matches) return true;
        var w = document.getElementById("kfarwell-window");
        return !w || w.hidden || w.classList.contains("minimized");
    }

    function relayout() {
        measureFeet();
        x = clamp(x, minX(), maxX());
        if (mode !== "held" && mode !== "fall") y = floorY();
    }

    function updatePresence() {
        var show = (owner || mirror) && hasRoom();
        /* Hidden by visibility rather than display: a canvas laid out at no
           size renders at no size, and stays blank when she is let back in
           until something makes the viewer measure itself again. */
        if (destroyed) return;
        if (box) {
            /* Carrying her into another window, the box stays: taking it out
               of the layout would drop the pointer capture. Only she goes. */
            box.style.visibility = (show || driving) ? "" : "hidden";
            if (stage) stage.style.visibility = show ? "" : "hidden";
            /* a mirrored Karin is a picture; she is grabbed where she lives */
            if (hit) hit.style.pointerEvents = (mirror && !driving) ? "none" : "";
        }
        if (!av) return;
        if ((show || frames <= WARM_FRAMES) && !raf) {
            last = 0;
            relayout();
            raf = requestAnimationFrame(frame);
        } else if (!show && raf) {
            cancelAnimationFrame(raf);
            raf = 0;
        }
    }

    function watchRoom() {
        var w = document.getElementById("kfarwell-window");
        if (w) {
            new MutationObserver(updatePresence).observe(w, {
                attributes: true,
                attributeFilter: ["class", "hidden"]
            });
        }
        desktop.addEventListener("change", updatePresence);
    }

    function onPointerMove(e) {
        /* another window's pointer has her; it says where, not this one */
        if (remote) return;
        if (driving) {
            var vp = myRect();
            send({ t: "carry", to: driving, sx: vp.x + e.clientX, sy: vp.y + e.clientY });
        }
        ptrX = e.clientX;
        ptrY = e.clientY;
        /* released somewhere we never heard about, off-window or over an iframe */
        if (held && e.buttons === 0) onRelease(e);
        /* A cursor that happens to be moving as the page comes up should not
           haul her to her feet the instant she appears -- she keeps watching it,
           but stays sat down until it moves again. */
        if (performance.now() - woke < WAKE_DELAY) return;
        ptrStill = performance.now();
        everMoved = true;
        sitting = false;
    }

    /* She sits on top of the page, so a scroll over her would otherwise go
       nowhere. Find whatever is underneath and scroll that instead. */
    function onWheel(e) {
        hit.style.pointerEvents = "none";
        var el = document.elementFromPoint(e.clientX, e.clientY);
        hit.style.pointerEvents = "";
        while (el && el !== document.documentElement) {
            var flow = window.getComputedStyle(el).overflowY;
            if (el.scrollHeight > el.clientHeight && (flow === "auto" || flow === "scroll")) {
                el.scrollTop += e.deltaY;
                e.preventDefault();
                return;
            }
            el = el.parentElement;
        }
    }

    /* Tapping her hands the USDZ to AR Quick Look. Only built where the browser
       says it understands rel="ar" -- anywhere else the anchor would just
       navigate to the file and download 7 MB of it. */
    function openImmersive() {
        if (arLink) arLink.click();
    }

    function onGrab(e) {
        /* only the primary button picks her up; the right one is for her menu */
        if (e.button !== 0 && e.button !== undefined) return;
        if (held) return;
        held = localPtr = e.pointerId || 1;
        tapX = e.clientX;
        tapY = e.clientY;
        mode = "held";
        /* she is off the window the moment she is lifted, or she would still be
           standing on it however far away she is carried */
        platform = null;
        platformX = null;
        vx = 0;
        vy = 0;
        swingV = 0;
        /* capture keeps the drag alive over iframes and off-window */
        try { hit.setPointerCapture(held); } catch (err) { /* pointer already gone */ }
        /* carrying her across a window is not a text drag */
        var selection = window.getSelection();
        if (selection) selection.removeAllRanges();
        document.body.style.userSelect = "none";
        e.preventDefault();
    }

    function onRelease(e) {
        if (driving) {
            if (e && e.pointerId && e.pointerId !== localPtr) return;
            document.body.style.userSelect = "";
            send({ t: "drop", to: driving });
            driving = null;
            localPtr = 0;
            updatePresence();
            return;
        }
        if (!held) return;
        if (e && e.pointerId && e.pointerId !== held) return;
        document.body.style.userSelect = "";
        held = 0;
        localPtr = 0;
        mode = "fall";
        dropFrom = y;
        vx = clamp(vx, -THROW, THROW);
        vy = clamp(vy, -THROW, THROW);
    }

    /* Pointer position stops arriving while the cursor is inside a cross-origin
       iframe -- the music player swallows it and will not say where it went. We
       do at least get told when it crosses in and out, so she watches the middle
       of whatever the cursor disappeared into rather than freezing mid-glance. */
    function onFrameEnter(e) {
        var r = e.currentTarget.getBoundingClientRect();
        ptrX = r.left + r.width / 2;
        ptrY = r.top + r.height / 2;
        if (performance.now() - woke < WAKE_DELAY) return;
        ptrStill = performance.now();
        everMoved = true;
        sitting = false;
    }

    function start(avatar) {
        av = avatar;
        woke = performance.now();
        THREE = av.THREE;
        AXIS_Y = new THREE.Vector3(0, 1, 0);
        AXIS_Z = new THREE.Vector3(0, 0, 1);
        qRoll = new THREE.Quaternion();
        qYaw = new THREE.Quaternion();
        pivot = new THREE.Vector3();
        _v1 = new THREE.Vector3();
        _v2 = new THREE.Vector3();
        _v3 = new THREE.Vector3();
        _v4 = new THREE.Vector3();
        _q1 = new THREE.Quaternion();
        _q2 = new THREE.Quaternion();

        /* the skirt lift has to happen after the spring solve, which the viewer
           owns, so borrow its call */
        var springs = av.rig.springs.bind(av.rig);
        av.rig.springs = function (dt, wind) {
            springs(dt, wind);
            shrinkKnees();
            if (sitT > 0.02) liftSkirt(sitT);
            if (sitT > 0.02) flattenHands(handT(sitT));
        };

        av.setBackdrop(null);       /* transparent canvas: the page shows through */
        av.controls.enabled = false;
        av.opts.autoRotate = false;
        measureFeet();
        findSkirt();
        findShrink();

        mode = "sit";
        x = sitX();
        y = floorY();
        place();

        window.addEventListener("pointermove", onPointerMove);
        hit.addEventListener("wheel", onWheel, { passive: false });
        hit.addEventListener("pointerdown", onGrab);
        hit.addEventListener("contextmenu", menu);
        watchLongPress(hit, function (x, y) {
            /* she is being held by the same press; put her down first */
            if (held) {
                held = 0;
                mode = "fall";
                vx = 0;
                vy = 0;
            }

            openMenuAt(x, y);
        });
        /* on the window, not the hit box: a pointer that leaves the page or
           slips into an iframe still has to be able to put her down */
        window.addEventListener("pointerup", onRelease);
        window.addEventListener("pointercancel", onRelease);
        window.addEventListener("mouseup", onRelease);
        Array.prototype.forEach.call(document.querySelectorAll("iframe"), function (f) {
            f.addEventListener("pointerover", onFrameEnter);
        });
        window.addEventListener("resize", relayout);
        /* iOS moves the ground without a resize event when its toolbars slide
           in and out, and reports the strip behind them as page either way. */
        if (window.visualViewport) {
            window.visualViewport.addEventListener("resize", relayout);
            window.visualViewport.addEventListener("scroll", relayout);
        }

        ptrStill = performance.now();
        watchRoom();
        updatePresence();
    }

    /* Right-clicking her offers the one thing you can do to a desktop pet that
       she cannot undo. */
    function menu(event) {
        event.preventDefault();
        openMenuAt(event.clientX, event.clientY);
    }

    function openMenuAt(clientX, clientY) {
        closeMenu();

        var items = [
            ["AR Quick Look (iOS/visionOS)", openImmersive, arLink !== null],
            ["Destroy", destroy, true]
        ];

        var el = document.createElement("div");
        el.id = "karin-menu";
        items.forEach(function (item) {
            var button = document.createElement("button");
            button.type = "button";
            button.textContent = item[0];
            button.disabled = !item[2];
            /* pointerdown, not click: the dismissal below runs on pointerdown
               too, and a button already out of the document sees no click */
            if (item[2]) {
                button.addEventListener("pointerdown", function (e) {
                    e.preventDefault();
                    closeMenu();
                    item[1]();
                });
            }
            el.appendChild(button);
        });
        document.body.appendChild(el);

        var right = clientX + el.offsetWidth > window.innerWidth;
        var below = clientY + el.offsetHeight > window.innerHeight;
        el.style.left = (right ? clientX - el.offsetWidth : clientX) + "px";
        el.style.top = (below ? clientY - el.offsetHeight : clientY) + "px";

        document.addEventListener("pointerdown", dismissMenu, true);
        document.addEventListener("keydown", dismissMenu, true);
    }

    function dismissMenu(event) {
        var el = document.getElementById("karin-menu");
        if (!el) return;
        if (event.type === "pointerdown" && el.contains(event.target)) return;
        if (event.type === "keydown" && event.key !== "Escape") return;
        closeMenu();
    }

    /* Touch has no right button, so a press held still opens the menu. */
    function watchLongPress(el, open) {
        var timer = 0;
        var from = null;

        function cancel() {
            clearTimeout(timer);
            timer = 0;
            from = null;
        }

        el.addEventListener("pointerdown", function (e) {
            if (e.pointerType !== "touch") return;
            from = { x: e.clientX, y: e.clientY };
            timer = setTimeout(function () {
                timer = 0;
                open(from.x, from.y);
            }, LONG_PRESS);
        });

        el.addEventListener("pointermove", function (e) {
            if (!from) return;
            if (Math.abs(e.clientX - from.x) + Math.abs(e.clientY - from.y) > 8) cancel();
        });

        el.addEventListener("pointerup", cancel);
        el.addEventListener("pointercancel", cancel);
    }

    function closeMenu() {
        var el = document.getElementById("karin-menu");
        if (el) el.remove();
        document.removeEventListener("pointerdown", dismissMenu, true);
        document.removeEventListener("keydown", dismissMenu, true);
    }

    var BOOM_FRAMES = 16;
    var BOOM_W = 71;
    var BOOM_H = 100;
    var BOOM_SCALE = 3;
    var BOOM_RISE = 0.32;

    function burst() {
        var rect = hit.getBoundingClientRect();
        var boom = document.createElement("div");

        boom.className = "karin-explosion";
        boom.style.left = (rect.left + rect.width / 2 - BOOM_W / 2) + "px";
        boom.style.top = (rect.top + rect.height * BOOM_RISE - BOOM_H / 2) + "px";
        boom.style.transform = "scale(" + BOOM_SCALE + ")";
        document.body.appendChild(boom);

        boom.addEventListener("animationend", function () { boom.remove(); });
    }

    function destroy() {
        if (destroyed) return;
        send({ t: "boom" });
        blowUp();
    }

    function blowUp() {
        if (destroyed) return;
        destroyed = true;

        if (owner) burst();

        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        if (box) {
            box.classList.add("destroyed");
            setTimeout(function () { box.remove(); box = null; }, 400);
        }
    }

    /* --------------------------------------------------------------------
       One Karin per device. Every window joins a BroadcastChannel and says
       where it is on the screen; one of them owns her and the rest sit
       dormant, warm enough to take her at a moment's notice.

       Screen px are the only frame the windows share. Nothing reports where a
       viewport sits on the screen, so it comes out of the window's outer and
       inner boxes, taking the chrome to be along the top with an even border
       either side. */

    var CHANNEL = "karin";
    var BEAT = 700;             /* the owner says she is still here this often */
    var LOST = 2400;            /* ...and is given up on this long after it stops */
    var STALE = 4000;           /* a window quiet this long is not on screen */
    var LISTEN = 400;           /* wait this long at boot before claiming her */
    var PROBE = 6;              /* px past our edge the neighbours are asked about */
    var WARM = 4000;            /* a dormant window loads the viewer this late */
    var WARM_FRAMES = 8;        /* ...and runs this many hidden frames */

    var chan = null;
    var me = Math.random().toString(36).slice(2);
    var claimedAt = 0;          /* when we took her; the older claim wins a tie */
    var heardAt = 0;            /* when the owner last said anything */
    var peers = {};             /* id -> { at, rect } for every other window */
    var seen = false;           /* another window has spoken for her */
    var pending = null;         /* a throw that landed before the viewer loaded */
    var handover = null;        /* where the last owner left her as it closed */
    var loading = false;

    /* The viewport, in screen px. */
    function myRect() {
        var border = Math.max(0, (window.outerWidth - window.innerWidth) / 2);
        return {
            x: window.screenX + border,
            y: window.screenY + (window.outerHeight - window.innerHeight) - border,
            w: window.innerWidth,
            h: viewportHeight()
        };
    }

    function inRect(r, sx, sy) {
        return sx >= r.x && sx < r.x + r.w && sy >= r.y && sy < r.y + r.h;
    }

    function peerCount() {
        var n = 0;
        var now = Date.now();
        for (var id in peers) {
            if (now - peers[id].at > STALE) delete peers[id];
            else n++;
        }
        return n;
    }

    /* Which window covers a point. Overlapping windows are a coin toss: the
       stacking order is not visible from in here. */
    function peerAt(sx, sy) {
        var now = Date.now();
        for (var id in peers) {
            if (now - peers[id].at > STALE) { delete peers[id]; continue; }
            if (peers[id].room && inRect(peers[id].rect, sx, sy)) return id;
        }
        return null;
    }

    /* Thrown over the top of a window she is in the strip that belongs to the
       browser, where no page contains her, so the window she is coming down
       into is picked by column instead. She crosses that gap undrawn. */
    function peerUnder(sx, sy) {
        var now = Date.now();
        var best = null;
        for (var id in peers) {
            var p = peers[id];
            if (now - p.at > STALE) { delete peers[id]; continue; }
            if (!p.room) continue;
            if (sx < p.rect.x || sx >= p.rect.x + p.rect.w) continue;
            if (sy > p.rect.y + p.rect.h) continue;
            if (!best || p.rect.y < peers[best].rect.y) best = id;
        }
        return best;
    }

    /* Whose she is about to be. Over our own column she stays ours, however
       high: what goes up over this window comes back down into it. */
    function catcher(sx, sy) {
        var to = peerAt(sx, sy);
        if (to) return to;
        var vp = myRect();
        if (sx >= vp.x && sx < vp.x + vp.w) return null;
        return peerUnder(sx, sy);
    }

    /* Every message doubles as this window saying where it is. */
    function send(msg) {
        if (!chan) return;
        msg.from = me;
        msg.rect = myRect();
        msg.room = hasRoom();
        try { chan.postMessage(msg); } catch (err) { /* channel closed */ }
    }

    /* Screen px; carry is the pointer she is hanging from, if any. */
    function snapshot(carry) {
        var vp = myRect();
        return {
            carry: carry || null,
            x: vp.x + x,
            y: vp.y + y,
            vx: vx,
            vy: vy,
            swing: swing,
            swingV: swingV,
            yaw: yaw,
            limbs: {
                arm: limbs.arm.a, legL: limbs.legL.a, legR: limbs.legR.a
            }
        };
    }

    function applyState(s) {
        if (!av) { pending = s; return; }
        var vp = myRect();
        platform = null;
        platformX = null;
        mode = "fall";
        sitT = 0;
        sitting = false;
        everMoved = true;
        /* Not clamped to our own walls: she comes in hanging over the edge
           she crossed, and squaring her up with them makes her jump. */
        x = s.x - vp.x;
        y = s.y - vp.y;
        vx = s.vx;
        vy = s.vy;
        swing = s.swing;
        swingV = s.swingV;
        yaw = s.yaw;
        limbs.arm.a = s.limbs.arm;
        limbs.legL.a = s.limbs.legL;
        limbs.legR.a = s.limbs.legR;
        dropFrom = y;
        ptrStill = performance.now();
        woke = performance.now() - WAKE_DELAY;
        everMoved = true;

        /* Still on the end of another window's pointer, which keeps saying
           where it is until it lets go -- unless the pointer is ours. */
        if (s.carry) {
            carrySX = s.carry.sx;
            carrySY = s.carry.sy;
            carriedAt = performance.now();
            ptrX = carrySX - vp.x;
            ptrY = carrySY - vp.y;
            mode = "held";
            remote = !localPtr;
            held = localPtr || REMOTE;
            driving = null;
            document.body.style.userSelect = "none";
        } else {
            remote = false;
            held = 0;
            document.body.style.userSelect = "";
        }
        box.classList.add("ready");
        place();
        updatePresence();
    }

    function drop() {
        remote = false;
        held = 0;
        document.body.style.userSelect = "";
        mode = "fall";
        dropFrom = y;
        vx = clamp(vx, -THROW, THROW);
        vy = clamp(vy, -THROW, THROW);
    }

    /* The pointer carrying her has left this window. She goes with it: the
       window it went to carries on the drag from the positions we send, and
       this one is left holding nothing but the press. */
    function carryOut() {
        if (!chan || !owner || mode !== "held") return false;
        var vp = myRect();
        var sx = remote ? carrySX : vp.x + ptrX;
        var sy = remote ? carrySY : vp.y + ptrY;
        if (inRect(vp, sx, sy)) return false;

        var to = catcher(sx, sy);
        if (!to) return false;
        send({ t: "toss", to: to, state: snapshot({ sx: sx, sy: sy }) });
        /* keep drawing our half until the new owner starts saying how she is */
        setMirror(true, poseState());
        if (localPtr) driving = to;
        else document.body.style.userSelect = "";
        remote = false;
        held = 0;
        release();
        return true;
    }

    function tossOut() {
        if (!chan || !owner || mode !== "fall") return false;
        var vp = myRect();
        var sx = vp.x + x + (spanL + spanR) / 2;
        var sy = vp.y + y + BOX_H / 2;
        /* pinned to a wall, ask about the strip beyond it rather than where
           she has been allowed to get to */
        if (vx < 0 && x <= minX()) sx = vp.x - PROBE;
        else if (vx > 0 && x >= maxX()) sx = vp.x + vp.w + PROBE;
        if (inRect(vp, sx, sy)) return false;

        var to = catcher(sx, sy);
        if (!to) return false;
        send({ t: "toss", to: to, state: snapshot() });
        setMirror(true, poseState());
        release();
        return true;
    }


    /* Her silhouette, screen px. */
    function bounds() {
        var vp = myRect();
        return {
            l: vp.x + x + spanL,
            r: vp.x + x + spanR,
            t: vp.y + y,
            b: vp.y + y + BOX_H
        };
    }

    function overlaps(r, b) {
        return b.r > r.x && b.l < r.x + r.w && b.b > r.y && b.t < r.y + r.h;
    }

    /* Over one of our edges with a window behind it, so someone else is
       drawing part of her and needs to be told how she is. */
    function straddles() {
        if (!chan || !owner) return false;
        var vp = myRect();
        var b = bounds();
        if (b.l >= vp.x && b.r <= vp.x + vp.w && b.t >= vp.y && b.b <= vp.y + vp.h) {
            return false;
        }
        var now = Date.now();
        for (var id in peers) {
            if (now - peers[id].at > STALE) { delete peers[id]; continue; }
            if (peers[id].room && overlaps(peers[id].rect, b)) return true;
        }
        return false;
    }

    /* A wall with a window behind it is not a wall. */
    function openEdge(dir) {
        if (!chan || !owner) return false;
        var vp = myRect();
        return !!catcher(dir < 0 ? vp.x - PROBE : vp.x + vp.w + PROBE,
            vp.y + y + BOX_H / 2);
    }

    function hold(nx) {
        if (nx < minX() && !openEdge(-1)) return minX();
        if (nx > maxX() && !openEdge(1)) return maxX();
        return nx;
    }

    /* Everything the pose depends on, for the window next door to copy rather
       than simulate: two windows stepping the same physics on their own clocks
       drift apart within a second and she tears in half down the join. */
    function poseState() {
        var vp = myRect();
        return {
            x: vp.x + x, y: vp.y + y,
            l: spanL, r: spanR,
            mode: mode,
            yaw: yaw, twist: twist, swing: swing, phase: phase,
            sitT: sitT, grip: grip, airT: airT, daze: dazeT,
            arm: limbs.arm.a, legL: limbs.legL.a, legR: limbs.legR.a,
            face: face,
            px: vp.x + ptrX, py: vp.y + ptrY
        };
    }

    function adoptPose() {
        var vp = myRect();
        x = pose.x - vp.x;
        y = pose.y - vp.y;
        spanL = pose.l;
        spanR = pose.r;
        mode = pose.mode;
        yaw = pose.yaw;
        twist = pose.twist;
        swing = pose.swing;
        phase = pose.phase;
        sitT = pose.sitT;
        grip = pose.grip;
        airT = pose.airT;
        dazeT = pose.daze;
        dazed = pose.daze > 0;
        limbs.arm.a = pose.arm;
        limbs.legL.a = pose.legL;
        limbs.legR.a = pose.legR;
        ptrX = pose.px - vp.x;
        ptrY = pose.py - vp.y;
    }

    function setMirror(on, state) {
        if (on) {
            pose = state;
            mirrorAt = performance.now();
        }
        if (mirror === on) return;
        mirror = on;
        if (on && !loading && !av) load();
        else updatePresence();
    }

    function take(state) {
        if (destroyed) return;
        mirror = false;
        /* two windows can briefly both think they own her; a state that came
           with a toss is newer than whatever we had either way */
        if (!owner) {
            owner = true;
            claimedAt = Date.now();
            send({ t: "own", at: claimedAt });
        }
        if (!loading && !av) load();
        else updatePresence();
        if (state) applyState(state);
    }

    /* Handing her on, or standing aside for an older claim. The viewer stays
       loaded and merely stops: she may well be thrown straight back. */
    function release() {
        if (!owner) return;
        owner = false;
        held = 0;
        /* a press of ours that is still down must not start selecting text */
        if (!driving) document.body.style.userSelect = "";
        closeMenu();
        updatePresence();
    }

    function onMessage(e) {
        var m = e.data;
        if (!m || m.from === me) return;
        /* blown up here, so not to be answered for to a window opening later */
        if (destroyed) return;
        if (m.rect) peers[m.from] = { at: Date.now(), rect: m.rect, room: m.room };

        if (m.t === "hello") {
            if (owner) send({ t: "own", at: claimedAt });
            else send({ t: "here" });
        } else if (m.t === "own") {
            heardAt = Date.now();
            seen = true;
            handover = null;
            /* claimed at once: older wins, ties split on the ids */
            if (owner && (m.at < claimedAt || (m.at === claimedAt && m.from < me))) {
                release();
            }
        } else if (m.t === "toss") {
            if (m.to === me) take(m.state);
        } else if (m.t === "pose") {
            /* draw her if any of her reaches into this window */
            if (owner) return;
            var vp = myRect();
            var b = {
                l: m.pose.x + m.pose.l, r: m.pose.x + m.pose.r,
                t: m.pose.y, b: m.pose.y + BOX_H
            };
            if (overlaps(vp, b)) setMirror(true, m.pose);
            else setMirror(false);
        } else if (m.t === "carry") {
            if (m.to !== me || !remote) return;
            var vp = myRect();
            carrySX = m.sx;
            carrySY = m.sy;
            carriedAt = performance.now();
            ptrX = m.sx - vp.x;
            ptrY = m.sy - vp.y;
            ptrStill = performance.now();
            sitting = false;
        } else if (m.t === "drop") {
            if (m.to === me && remote) drop();
        } else if (m.t === "bye") {
            delete peers[m.from];
            if (!m.own) return;
            heardAt = 0;
            /* whichever of us sits under where she was puts her back there */
            handover = m.state && inRect(myRect(), m.state.x, m.state.y)
                ? m.state : null;
        } else if (m.t === "boom") {
            blowUp();
        }
    }

    function beat() {
        if (destroyed) return;
        /* a hand holding her still sends no pointermove, and silence is how
           the window she is in decides the carry has died */
        if (driving) {
            var vp = myRect();
            send({ t: "carry", to: driving, sx: vp.x + ptrX, sy: vp.y + ptrY });
            return;
        }
        if (owner) { send({ t: "own", at: claimedAt }); return; }
        send({ t: "here" });
        /* Timers in a hidden tab are throttled, so a backgrounded owner looks
           dead from here. Waiting also keeps her out of unwatched tabs. */
        if (document.hidden && peerCount()) return;
        if (Date.now() - heardAt > LOST) take(handover);
    }

    /* Assume she is somewhere already; claim her only if nobody answers. */
    function join() {
        if (!window.BroadcastChannel) { take(null); return; }
        chan = new BroadcastChannel(CHANNEL);
        chan.onmessage = onMessage;
        heardAt = Date.now();
        send({ t: "hello" });
        setTimeout(function () {
            if (!seen) take(null);
        }, LISTEN);
        setInterval(beat, BEAT);
        /* A dormant window loads the viewer anyway: fetching six megabytes at
           the moment she is thrown here would leave her nowhere at all. */
        setTimeout(function () {
            if (!owner && !destroyed && hasRoom()) load();
        }, WARM);
        /* a closing window says where she was, so the next one can put her back */
        window.addEventListener("pagehide", function () {
            if (!chan) return;
            send({
                t: "bye",
                own: owner,
                state: owner && av ? snapshot() : null
            });
        });
        document.addEventListener("visibilitychange", function () {
            if (document.hidden) return;
            send({ t: "here" });
            if (!owner && Date.now() - heardAt > LOST) take(handover);
        });
        window.addEventListener("resize", function () { send({ t: "here" }); });
    }

    function load() {
        if (loading) return;
        loading = true;
        box = document.createElement("div");
        box.id = "karin";
        box.style.width = BOX_W + "px";
        box.style.height = BOX_H + "px";
        stage = document.createElement("div");
        stage.id = "stage";
        box.appendChild(stage);
        hit = document.createElement("div");
        hit.className = "hit";
        box.appendChild(hit);

        var probe = document.createElement("a");
        if (probe.relList && probe.relList.supports && probe.relList.supports("ar")) {
            arLink = probe;
            arLink.rel = "ar";
            arLink.href = "karin/avatar.usdz";
            /* Quick Look ignores the anchor unless it has an image inside it */
            var thumb = document.createElement("img");
            thumb.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
            thumb.alt = "";
            arLink.appendChild(thumb);
            box.appendChild(arLink);
        }
        document.body.appendChild(box);
        updatePresence();

        document.addEventListener("karinslime:ready", function (e) {
            start(e.detail);
            if (pending) { applyState(pending); pending = null; }
        });

        window.KS_MODEL = "karin/avatar.glb";
        var s = document.createElement("script");
        s.type = "module";
        s.src = "karin/app.js";
        document.body.appendChild(s);
    }

    /* she is a 6 MB download -- let the page finish first */
    if (document.readyState === "complete") join();
    else window.addEventListener("load", join);
}());
