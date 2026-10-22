import Webamp from "https://unpkg.com/webamp@^2/butterchurn";
import { makeMusicKitMediaClass } from "./musicKitMedia.js";
import { getPlaylist } from "./playlist.js";
import {
  createGenWindow,
  genTextString,
  skinTextString,
} from "./genWindow.js";

async function developerToken() {
  const response = await fetch("/api/apple-music/token");
  if (!response.ok) {
    throw new Error(`Could not fetch Apple Music token: ${response.status}`);
  }
  const { token } = await response.json();
  return token;
}

const PLAYLIST_ID = "pl.u-38oWZlWtPXjj6GZ";
const WINDOW_HEIGHT = 58;

// 98 is absent: Webamp's own skin is already Winamp 2.91's. A skin with no
// GEN.BMP has no generic window, so it wears the playlist's frame instead.
const SKINS = {
  xp: { url: "/webamp/skins/Winamp_XP_Lookalike.wsz", gen: false },
  7: { url: "/webamp/skins/Winamp5_Classified_v5.5.wsz", gen: true },
  system: { url: "/webamp/skins/classic_mac_v1.wsz", gen: false },
  classic: { url: "/webamp/skins/MacOS8AmpNrml.wsz", gen: false },
  motif: { url: "/webamp/skins/solaris-CDE.wsz", gen: false },
  cs16: { url: "/webamp/skins/SteamAMP_V2.wsz", gen: true },
};

// Webamp's own skin has a generic window, so the default is to wear it.
const currentSkin = () =>
  SKINS[document.documentElement.dataset.theme] ?? { url: null, gen: true };

const appEl = document.getElementById("webamp-host");
const desktop = window.matchMedia("(min-width: 656px)");

const appleWindow = createGenWindow("APPLE MUSIC", {
  onClose: () => appleWindowController?.setOpen(false),
});
let appleWindowController = null;
const inputEl = document.createElement("input");
inputEl.id = "am-playlist";
inputEl.spellcheck = false;
inputEl.placeholder = "Enter an Apple Music playlist ID or URL...";
const authEl = document.createElement("div");
authEl.id = "am-auth";
const bodyEl = document.createElement("div");
bodyEl.id = "am-body";
bodyEl.append(inputEl, authEl);
appleWindow.content.appendChild(bodyEl);

let playlistName = "";
inputEl.addEventListener("focus", () => {
  inputEl.value = "";
});
inputEl.addEventListener("blur", () => {
  if (inputEl.value.trim() === "") {
    inputEl.value = playlistName;
  }
});

function setError(message) {
  inputEl.classList.toggle("error", message != null);
  inputEl.title = message ?? "";
  if (message != null) {
    console.error(message);
  }
}

let buttonTextColor = [47, 55, 77];

function renderAuth(music) {
  authEl.textContent = "";
  authEl.appendChild(
    labelFont(music.isAuthorized ? "sign out" : "sign in")
  );
  recolorLabel(authEl, buttonTextColor).catch((err) =>
    console.error(err)
  );
}

authEl.addEventListener("pointerdown", () => {
  authEl.classList.add("winamp-active");
  document.addEventListener(
    "pointerup",
    () => authEl.classList.remove("winamp-active"),
    { once: true }
  );
});

function parsePlaylistId(input) {
  const trimmed = input.trim();
  const match = trimmed.match(/\/playlist\/[^/]+\/((?:pl|p)\.[^/?#]+)/);
  return match ? match[1] : trimmed;
}

async function musicKitReady() {
  if (window.MusicKit != null) return;
  const script = document.createElement("script");
  script.src = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
  script.dataset.webComponents = "";
  script.async = true;
  document.head.appendChild(script);
  await new Promise((resolve) =>
    document.addEventListener("musickitloaded", resolve, { once: true })
  );
}

const SNAP_DISTANCE = 15;

const windowState = { open: true, docked: true, x: 0, y: 0, width: 275 };

function createWindowController(webampEl) {
  const playlistRect = () => {
    const el = webampEl.querySelector(
      "#playlist-window, #playlist-window-shade"
    );
    const rect = el?.getBoundingClientRect();
    return rect == null || rect.width === 0 ? null : rect;
  };

  let painted = "";
  const layout = () => {
    appleWindow.setVisible(windowState.open);
    if (!windowState.open) return;

    const root = webampEl.getBoundingClientRect();
    const playlist = playlistRect();
    if (windowState.docked && playlist != null) {
      windowState.x = playlist.left - root.left;
      windowState.y = playlist.bottom - root.top;
      windowState.width = playlist.width;
    }

    const next = `${windowState.x},${windowState.y},${windowState.width}`;
    if (next === painted) return;
    painted = next;
    appleWindow.setPosition(windowState.x, windowState.y);
    appleWindow.setSize(windowState.width, WINDOW_HEIGHT);
  };

  const setOpen = (open) => {
    windowState.open = open;
    painted = "";
    layout();
  };

  appleWindow.titleBar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(".gen-close, .am-close") != null) return;
    e.preventDefault();
    const origin = { x: e.clientX, y: e.clientY };
    const start = { x: windowState.x, y: windowState.y };
    appleWindow.titleBar.setPointerCapture(e.pointerId);

    const onMove = (ee) => {
      windowState.docked = false;
      windowState.x = start.x + (ee.clientX - origin.x);
      windowState.y = start.y + (ee.clientY - origin.y);
      layout();
    };
    const onUp = () => {
      appleWindow.titleBar.removeEventListener("pointermove", onMove);
      const playlist = playlistRect();
      if (playlist != null) {
        const root = webampEl.getBoundingClientRect();
        const dx = Math.abs(windowState.x - (playlist.left - root.left));
        const dy = Math.abs(windowState.y - (playlist.bottom - root.top));
        if (dx <= SNAP_DISTANCE && dy <= SNAP_DISTANCE) {
          windowState.docked = true;
        }
      }
      layout();
    };
    appleWindow.titleBar.addEventListener("pointermove", onMove);
    appleWindow.titleBar.addEventListener("pointerup", onUp, {
      once: true,
    });
  });

  appleWindow.wrapper.addEventListener("pointerdown", (e) => {
    appleWindow.setSelected(true);
    if (e.target.closest("input") == null) {
      appleWindow.focus();
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!appleWindow.wrapper.contains(e.target)) {
      appleWindow.setSelected(false);
    }
  });

  new MutationObserver(layout).observe(webampEl, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["style", "class"],
  });
  new ResizeObserver(layout).observe(webampEl);
  window.addEventListener("resize", layout);
  layout();

  return { setOpen, layout };
}

function addContextMenuEntry(getOpen, setOpen) {
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        const menu = node.querySelector?.("ul.context-menu");
        if (menu == null) continue;
        const separators = [...menu.children].filter((li) =>
          li.classList.contains("hr")
        );
        if (separators.length < 3) continue;

        const item = document.createElement("li");
        item.textContent = "Apple Music";
        item.className = getOpen() ? "checked" : "";
        item.addEventListener("click", () => setOpen(!getOpen()));
        menu.insertBefore(item, separators[2]);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}

function spriteUrl(el) {
  return getComputedStyle(el).backgroundImage.match(
    /url\("?([^")]+)"?\)/
  )?.[1];
}

async function spritePixels(url) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  return {
    canvas,
    context,
    image: context.getImageData(0, 0, image.width, image.height),
  };
}

const luminance = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;

function colorCounts({ data }) {
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function majorColors(image, minShare = 0) {
  const total = image.data.length / 4;
  return [...colorCounts(image)]
    .filter(([, count]) => count / total >= minShare)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key.split(",").map(Number));
}

// The colour a word is written in: whatever stands out most from the paper,
// by how much of it there is and how far it stands from it.
function inkColor(counts, paper) {
  const paperLight = luminance(paper);
  let best = null;
  let bestScore = 0;
  for (const [key, count] of counts) {
    const color = key.split(",").map(Number);
    const score = count * Math.abs(luminance(color) - paperLight);
    if (score > bestScore) {
      bestScore = score;
      best = color;
    }
  }
  return best;
}

async function matchButtonColors(webampEl) {
  const playEl = webampEl.querySelector("#play");
  const shuffleEl = webampEl.querySelector("#shuffle");
  if (playEl == null || shuffleEl == null) return;
  const playUrl = spriteUrl(playEl);
  const shuffleUrl = spriteUrl(shuffleEl);
  if (playUrl == null || shuffleUrl == null) return;

  const play = await spritePixels(playUrl);
  const { width, height, data } = play.image;
  const at = (x, y) => {
    const i = (y * width + x) * 4;
    return `rgb(${data[i]}, ${data[i + 1]}, ${data[i + 2]})`;
  };
  const [face] = majorColors(play.image);

  bodyEl.style.setProperty("--button-face", `rgb(${face})`);
  bodyEl.style.setProperty("--button-light", at(0, 0));
  bodyEl.style.setProperty("--button-highlight", at(1, 1));
  bodyEl.style.setProperty("--button-dark", at(1, height - 1));

  // The colour this skin writes a button in.
  const shuffle = await spritePixels(shuffleUrl);
  const counts = colorCounts(shuffle.image);
  const [paper] = majorColors(shuffle.image);
  counts.delete(paper.join(","));
  const label = inkColor(counts, paper);
  if (label != null) {
    buttonTextColor = label;
  }
}

async function recolorLabel(labelEl, [r, g, b]) {
  const letters = [];
  for (const letterEl of labelEl.children) {
    // The skin's own letter, not the one left over from the last skin.
    letterEl.style.backgroundImage = "";
    const url = spriteUrl(letterEl);
    if (url == null) continue;
    letters.push([letterEl, await spritePixels(url)]);
  }

  // A letter is ink on paper, and which shade is which the ink can't say:
  // a dense letter is more ink than paper. The ring of pixels around each
  // letter is the paper, since a glyph sits inside its cell.
  const light = (data, i) =>
    luminance([data[i], data[i + 1], data[i + 2]]);

  let low = 255;
  let high = 0;
  for (const [, { image }] of letters) {
    const { data } = image;
    for (let i = 0; i < data.length; i += 4) {
      low = Math.min(low, light(data, i));
      high = Math.max(high, light(data, i));
    }
  }

  const middle = (low + high) / 2;
  let under = 0;
  let over = 0;
  for (const [, { image }] of letters) {
    const { width, height, data } = image;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const edge = y === 0 || y === height - 1 || x === 0 || x === width - 1;
        if (!edge) continue;
        if (light(data, (y * width + x) * 4) <= middle) under += 1;
        else over += 1;
      }
    }
  }

  const darkIsBack = under >= over;
  const back = darkIsBack ? low : high;
  const range = Math.max(1, Math.abs((darkIsBack ? high : low) - back));

  for (const [letterEl, { canvas, context, image }] of letters) {
    const { data } = image;
    for (let i = 0; i < data.length; i += 4) {
      const alpha =
        ((Math.abs(light(data, i) - back) / range) * data[i + 3]) / 255;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = Math.round(255 * Math.min(1, Math.max(0, alpha)));
    }
    context.putImageData(image, 0, 0);
    letterEl.style.backgroundImage = `url(${canvas.toDataURL()})`;
  }
}

// Webamp letters a skin with no gen font out of the default skin's, which
// arrives as one strip of the alphabet; those windows use the playlist's.
let genFontInUse = true;

// The sign-in button's label is painted in the skin's button colour, which
// wants letters in two flat shades; a gen font drawn in more can't be cut.
let labelFont = genTextString;

function genFontWorks(webampEl) {
  const letterOf = (letter) => {
    const probe = document.createElement("div");
    probe.className = `gen-text-${letter}`;
    webampEl.appendChild(probe);
    const { backgroundImage, width } = getComputedStyle(probe);
    probe.remove();
    // A letter the skin hasn't got comes back empty, with no width.
    return width === "0px" ? null : backgroundImage;
  };

  const a = letterOf("a");
  const b = letterOf("b");
  return a != null && b != null && a !== b;
}

// The skin's picture for one part of a window, focused or not.
function skinImage(webampEl, className, selected) {
  const probe = document.createElement("div");
  probe.className = className;
  const host = document.createElement("div");
  host.className = selected ? "gen-window selected" : "gen-window";
  host.appendChild(probe);
  webampEl.appendChild(host);
  const url = spriteUrl(probe);
  host.remove();
  return url;
}

// The title bar's paper with the skin's name scrubbed off it: each row is
// the colour that row is mostly painted in, so a name written on the plate
// breaks a striped bar the way the skin's own name does.
async function titlePlate(url) {
  const { image } = await spritePixels(url);
  const { width, height, data } = image;
  const plate = document.createElement("canvas");
  plate.width = 1;
  plate.height = height;
  const context = plate.getContext("2d");

  // Only the middle, where the skin writes its name; the ends are plain
  // fill, and a plate cut from those would be no plate at all.
  const from = Math.round(width / 4);
  const to = width - from;

  const ink = new Map();
  const paper = [];
  const written = [];
  for (let y = 0; y < height; y++) {
    const counts = new Map();
    for (let x = from; x < to; x++) {
      const i = (y * width + x) * 4;
      const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const [[row, most]] = [...counts].sort((a, b) => b[1] - a[1]);
    for (const [key, count] of counts) {
      if (key !== row) ink.set(key, (ink.get(key) ?? 0) + count);
    }
    // How much of the row isn't its own colour: the skin's name, and the
    // odd stray pixel of a dithered bar.
    written.push(to - from - most);
    paper.push(row);
    context.fillStyle = `rgb(${row})`;
    context.fillRect(0, y, 1, 1);
  }

  // The line the skin's letters stand on: the lowest row with a good part
  // of the writing in it, so strays and descenders don't count.
  const solid = Math.max(3, 0.4 * Math.max(...written));
  let foot = null;
  written.forEach((count, y) => {
    if (count >= solid && count <= (to - from) * 0.6) foot = y;
  });

  const middle = paper[Math.floor(height / 2)].split(",").map(Number);
  return {
    plate: plate.toDataURL(),
    color: inkColor(ink, middle),
    base: foot == null ? null : Math.max(0, height - 1 - foot),
  };
}

// Webamp couldn't read this skin's alphabet, but the picture of it still
// says what colour the skin writes a title bar in.
async function genInkColor(webampEl, selected) {
  const url = skinImage(webampEl, "gen-text-letter gen-text-a", selected);
  if (url == null) return null;
  const { image } = await spritePixels(url);
  const counts = colorCounts(image);
  const [paper] = majorColors(image);
  counts.delete(paper.join(","));
  return inkColor(counts, paper);
}

// The playlist's letters were drawn to sit on the playlist's paper, so each
// one is lifted off it and painted in the colour of the bar it lands on.
async function letterTitle(webampEl, gen) {
  for (const [lettersEl, selected] of [
    [appleWindow.letters, true],
    [appleWindow.lettersIdle, false],
  ]) {
    let color = null;
    if (gen) {
      color = await genInkColor(webampEl, selected);
    } else {
      const url = skinImage(webampEl, "playlist-top-title", selected);
      if (url != null) {
        const { plate, color: ink, base } = await titlePlate(url);
        appleWindow.windowEl.style.setProperty(
          selected ? "--am-plate-selected" : "--am-plate",
          `url(${plate})`
        );
        if (selected && base != null) {
          appleWindow.windowEl.style.setProperty(
            "--am-title-base",
            `${base}px`
          );
        }
        color = ink;
      }
    }
    await recolorLabel(lettersEl, color ?? [255, 255, 255]);
  }
}

async function chooseLabelFont(webampEl) {
  labelFont = skinTextString;
  if (!genFontInUse) return;

  const probe = document.createElement("div");
  probe.className = "gen-text-s";
  webampEl.appendChild(probe);
  const url = spriteUrl(probe);
  probe.remove();
  if (url == null) return;

  // Two flat shades can be cut apart; a letter drawn in more cannot.
  const { image } = await spritePixels(url);
  if (majorColors(image, 0.2).length > 0) {
    labelFont = genTextString;
  }
}

async function dressWindow(webampEl) {
  const { gen } = currentSkin();
  const genFont = gen && genFontWorks(webampEl);

  genFontInUse = genFont;
  appleWindow.dress({ gen, genFont });
  if (!genFont) {
    await letterTitle(webampEl, gen);
  }
}

// A colour the same but for the light on it.
function shade(color, amount) {
  const [r, g, b] = color.match(/\d+/g).map(Number);
  const towards = amount < 0 ? 0 : 255;
  const along = Math.abs(amount);
  const mix = (channel) => Math.round(channel + (towards - channel) * along);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function matchSkinColors(webampEl) {
  const playlistEl = webampEl.querySelector("#playlist-window");
  if (playlistEl == null) return;
  const { color, backgroundColor, fontFamily } =
    getComputedStyle(playlistEl);
  Object.assign(inputEl.style, { color, backgroundColor, fontFamily });
  bodyEl.style.backgroundColor = backgroundColor;

  // The field keeps the bevel it was given in Winamp's own skin; under any
  // other it is sunk into that skin's paper instead.
  if (currentSkin().url == null) {
    bodyEl.style.removeProperty("--field-dark");
    bodyEl.style.removeProperty("--field-light");
  } else {
    bodyEl.style.setProperty("--field-dark", shade(backgroundColor, -0.5));
    bodyEl.style.setProperty("--field-light", shade(backgroundColor, 0.5));
  }
}

async function main() {
  await musicKitReady();
  const music = await MusicKit.configure({
    developerToken: await developerToken(),
    app: { name: "Webamp", build: "1.0.0" },
  });
  renderAuth(music);

  const loadPlaylist = async (input) => {
    const playlistId = parsePlaylistId(input);
    setError(null);
    if (playlistId.startsWith("p.") && !music.isAuthorized) {
      await music.authorize();
      renderAuth(music);
    }
    const { name, tracks } = await getPlaylist(music, playlistId);
    playlistName = name;
    inputEl.value = name;
    return tracks;
  };

  const initialTracks = await loadPlaylist(PLAYLIST_ID);

  const MAIN_HEIGHT = 116;
  const PLAYLIST_EXTRA = 4;
  const PLAYLIST_HEIGHT = MAIN_HEIGHT + PLAYLIST_EXTRA * 29;
  const STACK_HEIGHT = MAIN_HEIGHT + PLAYLIST_HEIGHT + WINDOW_HEIGHT;

  const host = appEl.getBoundingClientRect();
  const left = Math.max(0, Math.round(host.width - 275 - 32));
  const top = Math.max(0, Math.round(host.height - STACK_HEIGHT - 24));

  const skinUrl = currentSkin().url;

  const webamp = new Webamp({
    initialTracks,
    ...(skinUrl == null ? {} : { initialSkin: { url: skinUrl } }),
    __customMediaClass: makeMusicKitMediaClass(music),
    windowLayout: {
      main: { position: { left, top } },
      playlist: {
        position: { left, top: top + MAIN_HEIGHT },
        size: { extraHeight: PLAYLIST_EXTRA, extraWidth: 0 },
      },
      equalizer: {
        position: { left, top: Math.max(0, top - MAIN_HEIGHT) },
        closed: true,
      },
      milkdrop: { position: { left: Math.max(0, left - 275), top }, closed: true },
    },
  });
  await webamp.renderInto(appEl);

  webamp.store.dispatch({
    type: "UPDATE_WINDOW_POSITIONS",
    positions: {
      main: { x: left, y: top },
      playlist: { x: left, y: top + MAIN_HEIGHT },
      equalizer: { x: left, y: Math.max(0, top - MAIN_HEIGHT) },
    },
    absolute: true,
  });

  const webampEl = appEl.querySelector("#webamp");
  webampEl.appendChild(appleWindow.wrapper);

  const matchSkin = async () => {
    await dressWindow(webampEl).catch((err) => console.error(err));
    await chooseLabelFont(webampEl).catch((err) => console.error(err));
    matchSkinColors(webampEl);
    await matchButtonColors(webampEl).catch((err) => console.error(err));
    renderAuth(music);
  };

  let worn = skinUrl;
  const wearSkin = async () => {
    const { url } = currentSkin();
    if (url === worn) return;
    worn = url;
    if (url == null) {
      // Webamp's own skin lives in its store, not in a file.
      webamp.store.dispatch({ type: "LOAD_DEFAULT_SKIN" });
    } else {
      webamp.setSkinFromUrl(url);
    }
    await webamp.skinIsLoaded();
    await matchSkin();
  };

  new MutationObserver(() => {
    wearSkin().catch((err) => console.error(err));
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  await matchSkin();
  // The theme can change while the player is still starting.
  await wearSkin();

  appleWindowController = createWindowController(webampEl);
  addContextMenuEntry(
    () => windowState.open,
    (open) => appleWindowController.setOpen(open)
  );

  inputEl.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    const input = inputEl.value;
    inputEl.blur();
    try {
      webamp.setTracksToPlay(await loadPlaylist(input));
    } catch (err) {
      setError(`Could not load playlist: ${err.message ?? err}`);
    }
  });

  authEl.addEventListener("click", async () => {
    try {
      if (music.isAuthorized) {
        await music.unauthorize();
      } else {
        await music.authorize();
      }
    } catch (err) {
      setError(`Sign in failed: ${err.message ?? err}`);
    }
    renderAuth(music);
  });
}

function launch() {
  main().catch((err) => {
    setError(err.message ?? String(err));
  });
}

if (desktop.matches) {
  launch();
} else {
  document.addEventListener("launch:webamp", launch, { once: true });
}
