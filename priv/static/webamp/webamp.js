import Webamp from "https://unpkg.com/webamp@^2/butterchurn";
import { makeMusicKitMediaClass } from "./musicKitMedia.js";
import { getPlaylist } from "./playlist.js";
import { createGenWindow, genTextString } from "./genWindow.js";

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

// 98 is absent: Webamp's own skin is already Winamp 2.91's.
const SKINS = {
  xp: "/webamp/skins/Winamp_XP_Lookalike.wsz",
  7: "/webamp/skins/Winamp5_Classified_v5.5.wsz",
  system: "/webamp/skins/classic_mac_v1.wsz",
  classic: "/webamp/skins/MacOS8AmpNrml.wsz",
  motif: "/webamp/skins/solaris-CDE.wsz",
  cs16: "/webamp/skins/SteamAMP_V2.wsz",
};

const currentSkin = () => SKINS[document.documentElement.dataset.theme];

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
    genTextString(music.isAuthorized ? "sign out" : "sign in")
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
    if (e.button !== 0 || e.target.closest(".gen-close") != null) return;
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

function majorColors({ data }, minShare = 0) {
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const total = data.length / 4;
  return [...counts]
    .filter(([, count]) => count / total >= minShare)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key.split(",").map(Number));
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

  authEl.style.setProperty("--button-face", `rgb(${face})`);
  authEl.style.setProperty("--button-light", at(0, 0));
  authEl.style.setProperty("--button-highlight", at(1, 1));
  authEl.style.setProperty("--button-dark", at(1, height - 1));

  const shuffle = await spritePixels(shuffleUrl);
  const [label] = majorColors(shuffle.image, 0.03).sort(
    (a, b) => luminance(a) - luminance(b)
  );
  if (label != null) {
    buttonTextColor = label;
  }
}

async function recolorLabel(labelEl, [r, g, b]) {
  for (const letterEl of labelEl.children) {
    const url = spriteUrl(letterEl);
    if (url == null) continue;
    const { canvas, context, image } = await spritePixels(url);
    const { data } = image;
    const lumAt = (i) => luminance([data[i], data[i + 1], data[i + 2]]);
    let min = 255;
    let max = 0;
    for (let i = 0; i < data.length; i += 4) {
      min = Math.min(min, lumAt(i));
      max = Math.max(max, lumAt(i));
    }
    const range = Math.max(1, max - min);
    for (let i = 0; i < data.length; i += 4) {
      const alpha = (lumAt(i) - min) / range;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = Math.round(255 * Math.min(1, Math.max(0, alpha)));
    }
    context.putImageData(image, 0, 0);
    letterEl.style.backgroundImage = `url(${canvas.toDataURL()})`;
  }
}

function matchSkinColors(webampEl) {
  const playlistEl = webampEl.querySelector("#playlist-window");
  if (playlistEl == null) return;
  const { color, backgroundColor, fontFamily } =
    getComputedStyle(playlistEl);
  Object.assign(inputEl.style, { color, backgroundColor, fontFamily });
  bodyEl.style.backgroundColor = backgroundColor;
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

  const skinUrl = currentSkin();

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
    matchSkinColors(webampEl);
    await matchButtonColors(webampEl).catch((err) => console.error(err));
    renderAuth(music);
  };

  let worn = skinUrl;
  const wearSkin = async () => {
    const url = currentSkin();
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
