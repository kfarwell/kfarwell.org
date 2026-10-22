defmodule KfarwellWeb.Layouts do
  @moduledoc """
  Holds the HTML skeleton the site is rendered into.
  """
  use KfarwellWeb, :html

  embed_templates "layouts/*"

  attr :title, :string, required: true
  attr :label, :string, required: true, doc: "the desktop icon that opens the window again"
  slot :inner_block, required: true

  def page(assigns) do
    ~H"""
    <div id="screen">
      <div class="window" id="page-window" data-anchored>
        <div class="title-bar">
          <div class="title-bar-text">{@title}</div>
          <div class="title-bar-controls">
            <button aria-label="Minimize"></button>
            <button aria-label="Maximize"></button>
            <button aria-label="Close"></button>
          </div>
        </div>
        <div class="window-body">
          {render_slot(@inner_block)}
        </div>
      </div>

      <.themes_window />
    </div>

    <div id="icons">
      <button class="icon app" data-opens="page-window" hidden>
        <span class="icon-image"><.icon_image kind="document" /></span>
        <span class="icon-label">{@label}</span>
      </button>
    </div>

    <div id="dock">
      <a id="kyle-app" href={~p"/"} aria-label="kfarwell">
        <img src="/kyle.png" alt="" width="128" height="128" />
      </a>
      <button id="toggle" onclick="toggleMode()">
        <span class="dock-icon">🌚</span>
        <span class="dock-label">Dark Mode</span>
      </button>
      <button id="themes-app" aria-label="Appearance">
        <span class="dock-icon">🎨</span>
        <span class="dock-label">Appearance</span>
      </button>
    </div>

    <.toasters />

    <script src={~p"/windows.js"}>
    </script>
    <script src={~p"/page.js"}>
    </script>
    """
  end

  @themes [
    {"98", "98"},
    {"xp", "XP"},
    {"7", "7"},
    {"system", "System"},
    {"classic", "Classic"},
    {"motif", "Motif"},
    {"cs16", "CS16"}
  ]

  def themes_window(assigns) do
    assigns = assign(assigns, :themes, @themes)

    ~H"""
    <div class="window" id="themes-window" hidden>
      <div class="title-bar">
        <div class="title-bar-text">Appearance</div>
        <div class="title-bar-controls">
          <button aria-label="Minimize"></button>
          <button aria-label="Maximize"></button>
          <button aria-label="Close"></button>
        </div>
      </div>
      <div class="window-body">
        <div id="themes-list">
          <div :for={{value, name} <- @themes} class="field-row">
            <input
              type="radio"
              id={"theme-" <> value}
              name="theme"
              value={value}
              checked={value == "98"}
            />
            <label for={"theme-" <> value}>{name}</label>
          </div>
        </div>
      </div>
    </div>
    """
  end

  attr :kind, :string, required: true, values: ~w(document chat)

  def icon_image(%{kind: "chat"} = assigns) do
    ~H"""
    <svg width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges" aria-hidden="true">
      <path d="M4 5h24v16H14l-6 6v-6H4z" fill="#fff" stroke="#000" />
      <path d="M8 11h16M8 15h11" stroke="#808080" />
    </svg>
    """
  end

  def icon_image(%{kind: "document"} = assigns) do
    ~H"""
    <svg width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges" aria-hidden="true">
      <path d="M6 3h13l7 7v19H6z" fill="#fff" stroke="#000" />
      <path d="M19 3v7h7" fill="#c0c0c0" stroke="#000" />
      <path d="M9 14h14M9 17h14M9 20h14M9 23h9" stroke="#808080" />
    </svg>
    """
  end
end
