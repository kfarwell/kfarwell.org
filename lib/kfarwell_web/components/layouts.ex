defmodule KfarwellWeb.Layouts do
  @moduledoc """
  Holds the HTML skeleton the site is rendered into.
  """
  use KfarwellWeb, :html

  embed_templates "layouts/*"
end
