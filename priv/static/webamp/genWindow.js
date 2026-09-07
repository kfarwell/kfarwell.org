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

export function genTextString(text) {
  const fragment = document.createDocumentFragment();
  for (const char of text.toLowerCase()) {
    const glyph = char === " " ? "space" : char;
    fragment.appendChild(div(`draggable gen-text-letter gen-text-${glyph}`));
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

export function createGenWindow(title, { onClose } = {}) {
  const content = div("gen-middle-center");
  const closeEl = pressable(div("gen-close selected"));
  const titleBar = div("gen-top draggable", [
    div("gen-top-left draggable"),
    div("gen-top-left-fill draggable"),
    div("gen-top-left-end draggable"),
    div("gen-top-title draggable", [genTextString(title)]),
    div("gen-top-right-end draggable"),
    div("gen-top-right-fill draggable"),
    div("gen-top-right draggable", [closeEl]),
  ]);

  const window_ = div("gen-window window", [
    titleBar,
    div("gen-middle", [
      div("gen-middle-left draggable", [
        div("gen-middle-left-bottom draggable"),
      ]),
      content,
      div("gen-middle-right draggable", [
        div("gen-middle-right-bottom draggable"),
      ]),
    ]),
    div("gen-bottom draggable", [
      div("gen-bottom-left draggable"),
      div("gen-bottom-right draggable"),
    ]),
  ]);
  window_.tabIndex = -1;

  closeEl.addEventListener("click", (e) => {
    e.stopPropagation();
    onClose?.();
  });

  const wrapper = div(null, [window_]);
  wrapper.style.position = "absolute";
  wrapper.style.top = "0";
  wrapper.style.left = "0";

  return {
    wrapper,
    content,
    titleBar,
    closeEl,
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
