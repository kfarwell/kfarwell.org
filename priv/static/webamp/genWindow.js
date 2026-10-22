function div(className, children = []) {
  const node = document.createElement("div");
  if (className != null) {
    node.className = className;
  }
  for (const child of children) {
    node.appendChild(child);
  }
  return node;
}

// Winamp letters a generic window out of GEN.BMP's own alphabet.
export function genTextString(text) {
  const fragment = document.createDocumentFragment();
  for (const char of text.toLowerCase()) {
    const glyph = char === " " ? "space" : char;
    fragment.appendChild(div(`draggable gen-text-letter gen-text-${glyph}`));
  }
  return fragment;
}

// The playlist's font, out of TEXT.BMP, which every skin has. There is no
// letter for a space, so it is left as the gap one takes.
export function skinTextString(text) {
  const fragment = document.createDocumentFragment();
  for (const char of text.toLowerCase()) {
    fragment.appendChild(
      char === " "
        ? div("draggable am-space")
        : div(`draggable character character-${char.charCodeAt(0)}`)
    );
  }
  return fragment;
}

function pressable(el) {
  el.addEventListener("pointerdown", () => {
    el.classList.add("winamp-active");
    document.addEventListener(
      "pointerup",
      () => el.classList.remove("winamp-active"),
      { once: true }
    );
  });
  return el;
}

function fill(node, children) {
  node.textContent = "";
  for (const child of children) {
    node.appendChild(child);
  }
}

export function createGenWindow(title, { onClose } = {}) {
  const content = div(null);
  const closeEl = pressable(div(null));
  const titleEl = div(null);
  const titleBar = div(null);
  const middle = div(null);
  const bottom = div(null);
  const letters = div("am-letters am-letters-selected");
  const lettersIdle = div("am-letters am-letters-idle");

  const window_ = div("window", [titleBar, middle, bottom]);
  window_.tabIndex = -1;

  // The frame Winamp draws for a generic window, out of GEN.BMP.
  function wearGen() {
    window_.className = "gen-window window";
    titleBar.className = "gen-top draggable";
    titleEl.className = "gen-top-title am-gen-title draggable";
    closeEl.className = "gen-close selected";

    fill(titleBar, [
      div("gen-top-left draggable"),
      div("gen-top-left-fill draggable"),
      div("gen-top-left-end draggable"),
      titleEl,
      div("gen-top-right-end draggable"),
      div("gen-top-right-fill draggable"),
      div("gen-top-right draggable", [closeEl]),
    ]);

    content.className = "gen-middle-center";
    middle.className = "gen-middle";
    fill(middle, [
      div("gen-middle-left draggable", [div("gen-middle-left-bottom draggable")]),
      content,
      div("gen-middle-right draggable", [
        div("gen-middle-right-bottom draggable"),
      ]),
    ]);

    bottom.className = "gen-bottom draggable";
    fill(bottom, [
      div("gen-bottom-left draggable"),
      div("gen-bottom-right draggable"),
    ]);
  }

  // A skin without one of its own wears the playlist's frame, out of
  // Webamp's own pieces, so each is lit when the window has the focus. The
  // sides and the foot go in twice over, which is how the scrollbar is cut
  // out of them. Where the playlist has its name written into the art, this
  // window has a plate of the same paper to write its own on.
  function wearPlaylist() {
    window_.className = "am-window window";
    titleBar.className = "playlist-top draggable";
    titleEl.className = "am-title draggable";
    closeEl.className = "am-close";

    fill(titleBar, [
      div("playlist-top-left draggable"),
      div("playlist-top-left-fill draggable"),
      titleEl,
      div("playlist-top-right-fill draggable"),
      div("playlist-top-right draggable", [
        div("playlist-top-right-fill am-corner-fill draggable"),
        div("playlist-top-right am-corner-shift draggable"),
        closeEl,
      ]),
    ]);

    content.className = "am-middle-center";
    middle.className = "playlist-middle draggable";
    fill(middle, [
      div("playlist-middle-left draggable"),
      content,
      div("playlist-middle-right am-middle-right draggable", [
        div("playlist-middle-right am-edge-inner draggable"),
      ]),
    ]);

    bottom.className = "playlist-bottom am-bottom draggable";
    fill(bottom, [
      div("playlist-bottom am-foot-inner draggable"),
      div("playlist-bottom-left am-foot-left-top draggable"),
      div("playlist-bottom-left am-foot-left-bottom draggable"),
      div("playlist-bottom-right am-foot-join-top draggable"),
      div("playlist-bottom-right am-foot-join-bottom draggable"),
      div("playlist-bottom-right am-foot-right-top draggable"),
      div("playlist-bottom-right am-foot-right-bottom draggable"),
    ]);
  }

  closeEl.addEventListener("click", (e) => {
    e.stopPropagation();
    onClose?.();
  });

  const wrapper = div(null, [window_]);
  wrapper.style.position = "absolute";
  wrapper.style.top = "0";
  wrapper.style.left = "0";

  wearGen();
  fill(titleEl, [genTextString(title)]);

  return {
    wrapper,
    content,
    titleBar,
    titleEl,
    closeEl,
    windowEl: window_,
    // One row of letters for the window with the focus, one for without.
    letters,
    lettersIdle,
    // Which frame the window wears, and which alphabet its name is set in.
    dress({ gen, genFont }) {
      if (gen) {
        wearGen();
      } else {
        wearPlaylist();
      }
      if (genFont) {
        fill(titleEl, [genTextString(title)]);
      } else {
        fill(letters, [skinTextString(title)]);
        fill(lettersIdle, [skinTextString(title)]);
        fill(titleEl, [lettersIdle, letters]);
      }
    },
    setPosition(x, y) {
      wrapper.style.transform = `translate(${x}px, ${y}px)`;
    },
    setSize(width, height) {
      window_.style.width = `${width}px`;
      window_.style.height = `${height}px`;
    },
    setVisible(visible) {
      wrapper.style.display = visible ? "" : "none";
    },
    setSelected(selected) {
      window_.classList.toggle("selected", selected);
    },
    focus() {
      window_.focus({ preventScroll: true });
    },
  };
}
