// The chat window's client half: local history, the markdown toolbar, the
// emoji picker and KLIPY's GIF search.
//
// KLIPY requires its API be called from the visitor's browser rather than
// proxied, so the search lives here. Its app key is publishable.

import EMOJI from "./emoji"

const STORAGE_KEY = "kfarwell:chat:v2"
const AWAY_AFTER = 60 * 1000
const LONG_PRESS = 450
const KEEP = 200
const KLIPY_BASE = "https://api.klipy.com/api/v1"
// The emoji sheet: 44 columns of 10px cells, drawn at 3x.
const SHEET_COLUMNS = 44
const SPRITE = 30
const GIF_COUNT = 24

function read() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null")
    if (stored && stored.conversations) return stored
  } catch (error) {
    /* private browsing, cleared storage, a half-written value */
  }
  return {conversations: {}, names: {}, nickname: ""}
}

function write(state) {
  const conversations = {}
  Object.entries(state.conversations || {}).forEach(([id, messages]) => {
    conversations[id] = (messages || []).slice(-KEEP)
  })

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      conversations,
      names: state.names || {},
      nickname: state.nickname || ""
    }))
  } catch (error) {
    /* the Discord thread still has everything */
  }
}

const Chat = {
  mounted() {
    this.log = this.el.querySelector(".chat-log")
    this.input = this.el.querySelector(".chat-form [name=body]")

    const stored = read()
    if (Object.keys(stored.conversations).length > 0 || stored.nickname) {
      this.pushEvent("restore", stored)
    }

    this.handleEvent("chat:store", (state) => write(state))

    this.handleEvent("chat:title", ({title}) => {
      const bar = this.el.closest(".window")?.querySelector(".title-bar-text")
      if (bar) bar.textContent = title
    })

    this.el.addEventListener("submit", (event) => {
      if (event.target.matches(".chat-form")) {
        window.requestAnimationFrame(() => { this.input.value = "" })
      }
    })

    // Discord's indicator lasts about eight seconds.
    this.input.addEventListener("input", () => {
      const now = Date.now()
      if (this.input.value !== "" && now - (this.typingSentAt || 0) > 5000) {
        this.typingSentAt = now
        this.pushEvent("typing", {})
      }
    })

    // Enter sends; shift+enter is a line break.
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault()
        this.typingSentAt = 0
        this.input.form.requestSubmit()
      }
    })

    // Spoilers stay covered until they are clicked.
    this.el.addEventListener("click", (event) => {
      const spoiler = event.target.closest(".chat-spoiler")
      if (spoiler) spoiler.classList.add("revealed")
    })

    // Pin to the newest message, again once pictures change the height.
    window.requestAnimationFrame(() => this.scroll())
    this.el.addEventListener("load", (event) => {
      if (event.target.tagName === "IMG") this.scroll()
    }, true)

    this.toolbar()
    this.emoji()
    this.gifs()
    this.tabMenu()
    this.idleTimer()
    this.scroll()
  },

  destroyed() {
    this.stopIdleTimer()
  },

  updated() { this.scroll() },

  scroll() {
    if (this.log) this.log.scrollTop = this.log.scrollHeight
  },

  // --- composing -----------------------------------------------------

  // Wraps the selection, or leaves the cursor between the marks.
  surround(before, after) {
    const input = this.input
    const {selectionStart: start, selectionEnd: end, value} = input
    const selected = value.slice(start, end)
    input.value = value.slice(0, start) + before + selected + after + value.slice(end)
    input.focus()
    if (selected === "") {
      input.selectionStart = input.selectionEnd = start + before.length
    } else {
      input.selectionStart = start + before.length
      input.selectionEnd = end + before.length
    }
  },

  insert(text) {
    this.surround(text, "")
  },

  // Headings and quotes belong at the start of the line, not at the cursor.
  startOfLine(prefix) {
    const input = this.input
    const {selectionStart: start, selectionEnd: end, value} = input
    const from = value.lastIndexOf("\n", start - 1) + 1

    // A selection ending just after a line break does not reach into the line
    // below it.
    const last = end > start && value[end - 1] === "\n" ? end - 1 : end
    const to = value.indexOf("\n", last) === -1 ? value.length : value.indexOf("\n", last)

    const block = value
      .slice(from, to)
      .split("\n")
      .map((line) => prefix + line)
      .join("\n")

    input.value = value.slice(0, from) + block + value.slice(to)
    input.focus()

    if (start === end) {
      input.selectionStart = input.selectionEnd = start + prefix.length
    } else {
      input.selectionStart = from
      input.selectionEnd = from + block.length
    }
  },

  toolbar() {
    this.el.querySelectorAll(".chat-toolbar [data-wrap]").forEach((button) => {
      button.addEventListener("click", () => {
        const mark = button.dataset.wrap
        this.surround(mark, mark)
      })
    })

    const fence = this.el.querySelector(".chat-toolbar [data-fence]")
    if (fence) {
      // A fence needs its own lines.
      fence.addEventListener("click", () => this.surround("```\n", "\n```"))
    }

    this.el.querySelectorAll(".chat-toolbar [data-prefix]").forEach((button) => {
      button.addEventListener("click", () => this.startOfLine(button.dataset.prefix))
    })

    const link = this.el.querySelector(".chat-toolbar [data-link]")
    if (link) {
      link.addEventListener("click", () => {
        const {selectionStart: start, selectionEnd: end, value} = this.input
        const selected = value.slice(start, end)
        // Selected text is the label, unless it is already a URL.
        if (/^https?:\/\//.test(selected)) {
          this.surround("[](", ")")
          this.input.selectionStart = this.input.selectionEnd = start + 1
        } else {
          this.surround("[", "](https://)")
        }
      })
    }

    this.el.querySelectorAll(".chat-toolbar [data-picker]").forEach((button) => {
      button.addEventListener("click", () => this.toggle(button.dataset.picker))
    })
  },

  toggle(name) {
    this.el.querySelectorAll(".chat-picker").forEach((panel) => {
      panel.hidden = panel.dataset.panel === name ? !panel.hidden : true
      // Fill the space above the composer and no more.
      if (!panel.hidden) panel.style.maxHeight = `${this.pickerRoom()}px`
    })

    if (name === "emoji" && this.emojiPanel && !this.emojiPanel.hidden) {
      this.buildEmoji()
    }

    // Opening the GIF panel for the first time shows what's trending.
    if (name === "gif" && this.gifPanel && !this.gifPanel.hidden &&
        this.gifResults.children.length === 0) {
      this.search("")
    }
  },

  pickerRoom() {
    const chat = this.el.getBoundingClientRect()
    const compose = this.el.querySelector(".chat-compose").getBoundingClientRect()

    return Math.max(80, compose.top - chat.top - 8)
  },

  emoji() {
    const panel = this.el.querySelector('[data-panel="emoji"]')
    if (!panel) return

    this.emojiPanel = panel
    this.emojiResults = panel.querySelector("[data-emoji-results]")
    this.emojiNote = panel.querySelector("[data-emoji-note]")

    panel.addEventListener("click", (event) => {
      const button = event.target.closest("[data-emoji]")
      if (!button) return
      this.insert(button.dataset.emoji)
    })

    const search = panel.querySelector("[data-emoji-search]")
    search.addEventListener("submit", (event) => event.preventDefault())
    search.querySelector("input").addEventListener("input", (event) => {
      this.filterEmoji(event.target.value)
    })
  },

  // Built once and filtered in place. Each button is a 10px cell of the sprite
  // sheet at 3x.
  buildEmoji() {
    if (this.emojiButtons) return

    const fragment = document.createDocumentFragment()
    this.emojiButtons = EMOJI.map(([glyph, name, index]) => {
      const button = document.createElement("button")
      button.type = "button"
      button.className = "chat-emoji"
      button.dataset.emoji = glyph
      button.dataset.name = name
      button.title = name
      button.style.backgroundPosition =
        `-${(index % SHEET_COLUMNS) * SPRITE}px -${Math.floor(index / SHEET_COLUMNS) * SPRITE}px`
      fragment.appendChild(button)
      return button
    })

    this.emojiResults.appendChild(fragment)
  },

  filterEmoji(query) {
    const needle = (query || "").trim().toLowerCase()
    let shown = 0

    this.emojiButtons.forEach((button) => {
      const match = needle === "" || button.dataset.name.includes(needle)
      button.hidden = !match
      if (match) shown += 1
    })

    this.emojiNote.textContent = shown === 0 ? "No emoji match that." : ""
    this.emojiNote.hidden = shown !== 0
  },

  // --- tabs ----------------------------------------------------------

  // Right-click a tab to close it.
  tabMenu() {
    const menu = this.el.querySelector("#chat-tab-menu")
    const tabs = this.el.querySelector("#chat-tabs")
    if (!menu || !tabs) return

    const hide = () => { menu.hidden = true; this.menuTab = null }

    const open = (tab, clientX, clientY) => {
      this.menuTab = tab.dataset.tab

      // The menu is a child of the window, so position against it.
      const origin = this.el.getBoundingClientRect()
      menu.hidden = false
      menu.style.left = `${clientX - origin.left}px`
      menu.style.top = `${clientY - origin.top}px`
    }

    tabs.addEventListener("contextmenu", (event) => {
      const tab = event.target.closest("[data-tab]")
      if (!tab) return

      event.preventDefault()
      open(tab, event.clientX, event.clientY)
    })

    // Touch has no right button, so a press held still opens the menu.
    let timer = 0
    let from = null
    const cancel = () => { clearTimeout(timer); timer = 0; from = null }

    tabs.addEventListener("pointerdown", (event) => {
      const tab = event.target.closest("[data-tab]")
      if (!tab || event.pointerType !== "touch") return

      from = {x: event.clientX, y: event.clientY}
      timer = setTimeout(() => { timer = 0; open(tab, from.x, from.y) }, LONG_PRESS)
    })

    tabs.addEventListener("pointermove", (event) => {
      if (from && Math.abs(event.clientX - from.x) + Math.abs(event.clientY - from.y) > 8) cancel()
    })

    tabs.addEventListener("pointerup", cancel)
    tabs.addEventListener("pointercancel", cancel)

    menu.querySelector("[data-close-tab]").addEventListener("click", () => {
      if (this.menuTab) this.pushEvent("close", {peer: this.menuTab})
      hide()
    })

    document.addEventListener("click", (event) => {
      if (!menu.hidden && !menu.contains(event.target)) hide()
    })
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hide()
    })
  },

  // --- away ----------------------------------------------------------

  // A minute without touching the page, or a hidden tab, counts as away.
  idleTimer() {
    this.away = false

    const goActive = () => {
      if (this.away) {
        this.away = false
        this.pushEvent("active", {})
      }
      clearTimeout(this.idle)
      this.idle = setTimeout(goAway, AWAY_AFTER)
    }

    const goAway = () => {
      if (this.away) return
      this.away = true
      this.pushEvent("away", {})
    }

    this.activity = () => (document.hidden ? goAway() : goActive())
    this.events = ["pointerdown", "keydown", "wheel", "focus"]
    this.events.forEach((name) => window.addEventListener(name, this.activity, true))
    document.addEventListener("visibilitychange", this.activity)

    goActive()
  },

  stopIdleTimer() {
    clearTimeout(this.idle)
    this.events.forEach((name) => window.removeEventListener(name, this.activity, true))
    document.removeEventListener("visibilitychange", this.activity)
  },

  // --- KLIPY ---------------------------------------------------------

  gifs() {
    const panel = this.el.querySelector('[data-panel="gif"]')
    if (!panel) return

    this.gifPanel = panel
    this.gifResults = panel.querySelector("[data-gif-results]")
    this.gifNote = panel.querySelector("[data-gif-note]")
    this.klipyKey = panel.dataset.klipyKey
    this.customerId = panel.dataset.customer

    panel.querySelector("[data-gif-search]").addEventListener("submit", (event) => {
      event.preventDefault()
      this.search(new FormData(event.target).get("query"))
    })

    this.gifResults.addEventListener("click", (event) => {
      const button = event.target.closest("[data-url]")
      if (!button) return
      this.pushEvent("send_gif", {url: button.dataset.url})
      this.share(button.dataset.slug)
      panel.hidden = true
    })
  },

  note(text) {
    this.gifNote.textContent = text || ""
    this.gifNote.hidden = !text
  },

  async search(query) {
    if (!this.klipyKey) return this.note("GIF search isn't set up.")

    const endpoint = query ? "search" : "trending"
    const params = new URLSearchParams({per_page: GIF_COUNT, customer_id: this.customerId})
    if (query) params.set("q", query)

    this.note("Searching...")
    this.lastQuery = query || ""

    try {
      const response = await fetch(
        `${KLIPY_BASE}/${this.klipyKey}/gifs/${endpoint}?${params}`
      )
      if (!response.ok) throw new Error(`KLIPY responded ${response.status}`)

      const body = await response.json()
      this.render(body?.data?.data || [])
    } catch (error) {
      console.error(error)
      this.gifResults.textContent = ""
      this.note("GIF search is unavailable.")
    }
  },

  render(gifs) {
    this.gifResults.textContent = ""

    gifs.forEach((gif) => {
      // KLIPY requires its media be loaded from the URLs it returns, as-is.
      const preview = gif.file?.xs?.gif?.url || gif.file?.sm?.gif?.url
      const full = gif.file?.md?.gif?.url || gif.file?.hd?.gif?.url || preview
      if (!preview || !full) return

      const button = document.createElement("button")
      button.type = "button"
      button.className = "chat-gif"
      button.dataset.url = full
      button.dataset.slug = gif.slug || ""

      const image = document.createElement("img")
      image.src = preview
      image.alt = gif.title || "GIF"
      image.loading = "lazy"

      button.appendChild(image)
      this.gifResults.appendChild(button)
    })

    this.note(gifs.length === 0 ? "Nothing found." : "")
  },

  // KLIPY counts shares; it does not affect what the visitor sees.
  share(slug) {
    if (!slug || !this.klipyKey) return

    fetch(`${KLIPY_BASE}/${this.klipyKey}/gifs/share/${slug}`, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({customer_id: this.customerId, q: this.lastQuery || ""})
    }).catch(() => {})
  }
}

export default Chat
