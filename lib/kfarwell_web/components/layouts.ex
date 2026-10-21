defmodule KfarwellWeb.Layouts do
  @moduledoc """
  Holds the HTML skeleton the site is rendered into.
  """
  use KfarwellWeb, :html

  embed_templates "layouts/*"

  attr :title, :string, required: true
  slot :inner_block, required: true

  def page(assigns) do
    ~H"""
    <div id="screen">
      <div class="window" id="page-window">
        <div class="title-bar">
          <div class="title-bar-text">{@title}</div>
        </div>
        <div class="window-body">
          {render_slot(@inner_block)}
        </div>
      </div>
    </div>

    <div id="dock">
      <a id="kyle-app" href={~p"/"} aria-label="kfarwell">
        <img src="/kyle.png" alt="" width="128" height="128" />
      </a>
      <button id="toggle" onclick="toggleMode()">
        <span class="dock-icon">🌚</span>
        <span class="dock-label">Dark Mode</span>
      </button>
    </div>

    <.toasters />
    """
  end
end
